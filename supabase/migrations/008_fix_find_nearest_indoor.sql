-- Migration 008: fix find_nearest_indoor query plan
--
-- Problem: 007 used ST_DWithin + <-> simultaneously. The planner chose
-- Bitmap Heap Scan (radius filter via GIST) → in-memory Sort (<->).
-- Result is correct but not optimal — no KNN Index Scan.
--
-- Fix: remove ST_DWithin from WHERE. Wrap the KNN query in a subquery so the
-- planner drives with ORDER BY coords <-> target LIMIT 1 (KNN Index Scan),
-- then apply the 5 km radius check on the single row returned.
-- ST_Distance is computed once (on 1 row), not on every candidate.

CREATE OR REPLACE FUNCTION find_nearest_indoor(
    input_lat   FLOAT8,
    input_lng   FLOAT8,
    exclude_ids TEXT[]  DEFAULT '{}',
    radius_m    FLOAT8  DEFAULT 5000.0
)
RETURNS TABLE (
    id                  TEXT,
    name                TEXT,
    lat                 FLOAT8,
    lng                 FLOAT8,
    category            TEXT,
    is_outdoor          BOOLEAN,
    dwell_minutes       INT,
    best_time_start     TEXT,
    best_time_end       TEXT,
    opening_hours       TEXT[],
    close_days          TEXT[],
    description         TEXT,
    formatted_address   TEXT,
    search_keywords     TEXT[],
    is_audited          BOOLEAN,
    offset_over_1km     BOOLEAN,
    distance_m          FLOAT8
)
LANGUAGE sql
STABLE
AS $$
    -- Inner query: ORDER BY <-> LIMIT 1 triggers KNN Index Scan on places_coords_gist.
    -- No ST_DWithin here — the planner can use the index purely for KNN ordering.
    -- ST_Distance is computed only once on the single row that survives LIMIT 1.
    SELECT *
    FROM (
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
          AND (
              exclude_ids IS NULL
              OR array_length(exclude_ids, 1) IS NULL
              OR p.id != ALL(exclude_ids)
          )
          AND is_place_open_now(p.opening_hours, p.close_days)
        ORDER BY p.coords <-> ST_MakePoint(input_lng, input_lat)::geography
        LIMIT 1
    ) nearest
    -- Post-filter: discard the single result if it falls outside radius_m.
    -- Runs on exactly 1 row — no index needed, essentially free.
    WHERE nearest.distance_m <= radius_m;
$$;
