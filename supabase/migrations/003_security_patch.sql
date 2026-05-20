-- Security patch (idempotent):
-- 1. Add WITH CHECK to route_legs + trip_places (write-side enforcement)
-- 2. Remove session_id from all RLS policies (IDOR fix — guest access via service_role only)
-- 3. Use DROP POLICY IF EXISTS before each CREATE for safe re-runs

-- trips: drop 001 policy, recreate without session_id
drop policy if exists "trips: owner access" on trips;
create policy "trips: owner access" on trips
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- route_legs: drop 002 policy, recreate with WITH CHECK + no session_id
drop policy if exists "route_legs: owner access" on route_legs;
create policy "route_legs: owner access" on route_legs
  using (
    trip_id in (select id from trips where user_id = auth.uid())
  )
  with check (
    trip_id in (select id from trips where user_id = auth.uid())
  );

-- trip_places: drop 002 policy, recreate with WITH CHECK + no session_id
drop policy if exists "trip_places: owner access" on trip_places;
create policy "trip_places: owner access" on trip_places
  using (
    trip_id in (select id from trips where user_id = auth.uid())
  )
  with check (
    trip_id in (select id from trips where user_id = auth.uid())
  );

-- trip_feedback: drop 002 policy, recreate with WITH CHECK
drop policy if exists "trip_feedback: owner only" on trip_feedback;
create policy "trip_feedback: owner only" on trip_feedback
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
