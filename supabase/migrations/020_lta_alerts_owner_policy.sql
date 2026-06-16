-- Alerts may contain private itinerary details. Only the owner of the parent
-- trip may read them through the client-side Supabase API.

drop policy if exists "alerts: read only for clients" on lta_alerts;
drop policy if exists "alerts: owner read" on lta_alerts;

create policy "alerts: owner read" on lta_alerts
  for select
  using (
    exists (
      select 1
      from trips
      where trips.id = lta_alerts.trip_id
        and trips.user_id = auth.uid()
    )
  );
