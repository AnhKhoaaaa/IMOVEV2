-- Migration 007: places table with PostGIS spatial index + RPC functions
-- Replaces local JSON-based haversine lookups with DB-side KNN queries.
--
-- Run order: after 006_lta_alerts_index.sql
-- Requires: Supabase project with PostGIS enabled (available on all Supabase tiers)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enable PostGIS extension
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS postgis;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Places table
--
-- lat/lng are kept as plain numerics for backward-compat (Python reads them
-- directly from the row). coords is the spatial column used for all distance
-- queries; it is populated by the seed script as ST_MakePoint(lng, lat).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS places (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    lat                     FLOAT8 NOT NULL,
    lng                     FLOAT8 NOT NULL,
    -- GEOGRAPHY type uses metres for distance calculations (ST_Distance, ST_DWithin)
    -- and is the correct type for real-world lat/lng data (not a local plane).
    -- Note: ST_MakePoint(x, y) = ST_MakePoint(lng, lat) — X axis is longitude.
    coords                  GEOGRAPHY(Point, 4326) NOT NULL,
    category                TEXT NOT NULL,
    is_outdoor              BOOLEAN NOT NULL,
    dwell_minutes           INT NOT NULL,
    best_time_start         TEXT NOT NULL DEFAULT '00:00',
    best_time_end           TEXT NOT NULL DEFAULT '23:59',
    opening_hours           TEXT[],          -- e.g. ["09:00-18:00", "19:00-22:00"]
    close_days              TEXT[],          -- e.g. ["Monday", "Tuesday"]
    description             TEXT,
    formatted_address       TEXT,
    search_keywords         TEXT[],
    suggested_duration_minutes INT,
    is_audited              BOOLEAN,
    offset_over_1km         BOOLEAN,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Spatial index (GIST on coords)
--
-- Enables KNN order-by (coords <-> target) and ST_DWithin radius scans to use
-- the index instead of a full sequential scan. Without this, both operators
-- fall back to O(n) brute force across all 500 rows on every weather swap call.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS places_coords_gist
    ON places USING GIST (coords);

-- Supporting indexes for the common WHERE filters in find_nearest_indoor
CREATE INDEX IF NOT EXISTS places_is_outdoor_idx
    ON places (is_outdoor);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Helper: is_place_open_now(opening_hours, close_days)
--
-- Replicates the Python _is_open_now() logic inside the DB so the RPC function
-- can filter closed places without a Python round-trip.
-- Timezone: Asia/Singapore (SGT = UTC+8, no DST).
-- Fails open: returns TRUE on unparseable slots (same as Python version).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_place_open_now(
    p_opening_hours TEXT[],
    p_close_days    TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE   -- reads current time; never modifies data; safe to cache within a query
AS $$
DECLARE
    v_day_name  TEXT;
    v_time_now  TEXT;
    v_slot      TEXT;
    v_start     TEXT;
    v_end       TEXT;
BEGIN
    v_day_name := TRIM(TO_CHAR(NOW() AT TIME ZONE 'Asia/Singapore', 'Day'));
    v_time_now := TO_CHAR(NOW() AT TIME ZONE 'Asia/Singapore', 'HH24:MI');

    -- Closed today
    IF p_close_days IS NOT NULL AND v_day_name = ANY(p_close_days) THEN
        RETURN FALSE;
    END IF;

    -- No hours defined → fail open (assume 24h)
    IF p_opening_hours IS NULL OR array_length(p_opening_hours, 1) IS NULL THEN
        RETURN TRUE;
    END IF;

    FOREACH v_slot IN ARRAY p_opening_hours LOOP
        -- Unparseable slot → fail open
        IF v_slot NOT LIKE '%-%' THEN
            RETURN TRUE;
        END IF;

        v_start := LEFT(v_slot, 5);
        v_end   := RIGHT(v_slot, 5);

        -- 24-hour place
        IF v_start = '00:00' AND v_end IN ('23:59', '24:00') THEN
            RETURN TRUE;
        END IF;

        -- Midnight-crossing slot (e.g. "22:00-02:00")
        IF v_end < v_start THEN
            IF v_time_now >= v_start OR v_time_now <= v_end THEN
                RETURN TRUE;
            END IF;
        ELSE
            IF v_time_now >= v_start AND v_time_now <= v_end THEN
                RETURN TRUE;
            END IF;
        END IF;
    END LOOP;

    RETURN FALSE;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RPC: find_nearest_indoor(input_lat, input_lng, exclude_ids, radius_m)
--
-- Replaces the Python _nearest_indoor() haversine loop entirely.
-- The query uses two index-accelerated operations:
--   • ST_DWithin  → GIST index prunes to the 5 km radius first
--   • coords <->  → KNN index scan sorts the pruned set by distance
-- Returns exactly 1 row (the nearest open indoor place) or 0 rows.
--
-- Called from Python via:
--   supabase.rpc("find_nearest_indoor", {
--       "input_lat": lat, "input_lng": lng,
--       "exclude_ids": list(already_used), "radius_m": 5000
--   }).execute()
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION find_nearest_indoor(
    input_lat   FLOAT8,
    input_lng   FLOAT8,
    exclude_ids TEXT[]  DEFAULT '{}',
    radius_m    FLOAT8  DEFAULT 5000.0   -- metres; matches the 5 km Python filter
)
RETURNS TABLE (
    id                      TEXT,
    name                    TEXT,
    lat                     FLOAT8,
    lng                     FLOAT8,
    category                TEXT,
    is_outdoor              BOOLEAN,
    dwell_minutes           INT,
    best_time_start         TEXT,
    best_time_end           TEXT,
    opening_hours           TEXT[],
    close_days              TEXT[],
    description             TEXT,
    formatted_address       TEXT,
    search_keywords         TEXT[],
    is_audited              BOOLEAN,
    offset_over_1km         BOOLEAN,
    distance_m              FLOAT8
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        p.id,
        p.name,
        p.lat,
        p.lng,
        p.category,
        p.is_outdoor,
        p.dwell_minutes,
        p.best_time_start,
        p.best_time_end,
        p.opening_hours,
        p.close_days,
        p.description,
        p.formatted_address,
        p.search_keywords,
        p.is_audited,
        p.offset_over_1km,
        ST_Distance(
            p.coords,
            ST_MakePoint(input_lng, input_lat)::geography
        ) AS distance_m
    FROM places p
    WHERE p.is_outdoor = false
      -- Exclude places already in the plan or already chosen as a swap target.
      -- array_length guard: avoid ANY(NULL) which is always NULL (never true).
      AND (
          exclude_ids IS NULL
          OR array_length(exclude_ids, 1) IS NULL
          OR p.id != ALL(exclude_ids)
      )
      -- Radius pre-filter: uses GIST index, eliminates distant rows before sort
      AND ST_DWithin(
          p.coords,
          ST_MakePoint(input_lng, input_lat)::geography,
          radius_m
      )
      -- Opening-hours check runs after spatial pre-filter (cheaper per-row cost)
      AND is_place_open_now(p.opening_hours, p.close_days)
    -- KNN index scan: returns rows in ascending distance order
    ORDER BY p.coords <-> ST_MakePoint(input_lng, input_lat)::geography
    LIMIT 1;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Row Level Security
--
-- places is a public read-only curated dataset — no auth needed to query it.
-- Mutations (INSERT/UPDATE/DELETE) are blocked from the client; only the
-- seed script using the service_role key can write.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE places ENABLE ROW LEVEL SECURITY;

CREATE POLICY "places: public read"
    ON places FOR SELECT
    USING (true);
