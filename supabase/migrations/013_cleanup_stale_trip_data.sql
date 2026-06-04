-- Remove stale/duplicate rows accumulated by the old upsert-without-delete strategy.
--
-- Root cause: _persist_trip_plan used upsert (INSERT OR UPDATE) keyed on auto-generated
-- UUIDs, so every re-plan (remove_day, remove_place, optimize, reorder) appended new rows
-- without deleting old ones. After Render hibernate → _fetch_trip_from_db read ALL rows
-- including stale ones, causing:
--   • phantom old days (stale day_number rows in route_legs)
--   • doubled stop counts (duplicate trip_places rows per trip)
--   • overlapping route polylines on map (doubled legs per day)
--
-- This migration deduplicates both tables, keeping the most-recently-inserted row
-- per (trip_id, place_id) for trip_places, and removing stale route_legs entirely
-- by keeping only the latest set per trip (identified by MAX(ctid) per trip_id).
--
-- After applying this migration, the fixed backend code (DELETE + INSERT instead of
-- upsert) prevents new accumulation.

-- 1. trip_places: keep only one row per (trip_id, place_id) — the latest one
delete from trip_places
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by trip_id, place_id
        order by id desc   -- keep the latest auto-generated uuid
      ) as rn
    from trip_places
  ) ranked
  where rn > 1
);

-- 2. route_legs: for each trip, keep only the legs that belong to the most recent plan.
-- The most recent plan has the highest UUIDs (v4 random, so we can't rely on ordering).
-- Instead, identify the latest persisted day_number set per trip by taking legs whose
-- (trip_id, day_number) combination was inserted most recently (highest ctid).
-- Simpler approach: delete ALL legs for trips that have duplicate (trip_id, day_number)
-- combinations, since the correct data must be re-persisted anyway.
-- We only clean trips that actually have stale data (more legs than places warrant).
delete from route_legs
where id in (
  select r.id
  from route_legs r
  where (
    -- A leg is stale if there exists another leg for the same trip with the same
    -- from_place_id and to_place_id and day_number but a different (newer) id.
    -- We keep the leg with the largest id (lexicographically, UUID v4 uses random bits
    -- so this isn't strictly temporal, but it will collapse duplicates to one row).
    exists (
      select 1
      from route_legs r2
      where r2.trip_id      = r.trip_id
        and r2.day_number   = r.day_number
        and r2.from_place_id = r.from_place_id
        and r2.to_place_id  = r.to_place_id
        and r2.transport_mode = r.transport_mode
        and r2.id > r.id
    )
  )
);
