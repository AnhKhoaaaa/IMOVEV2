-- Patch: add missing RLS policies + created_at on route_legs

alter table route_legs add column if not exists created_at timestamptz default now();

-- route_legs: accessible if caller owns the parent trip
alter table route_legs enable row level security;
create policy "route_legs: owner access" on route_legs
  using (
    trip_id in (
      select id from trips
      where user_id = auth.uid()
         or session_id = current_setting('app.session_id', true)
    )
  );

-- trip_places: accessible if caller owns the parent trip
alter table trip_places enable row level security;
create policy "trip_places: owner access" on trip_places
  using (
    trip_id in (
      select id from trips
      where user_id = auth.uid()
         or session_id = current_setting('app.session_id', true)
    )
  );

-- trip_feedback: only the submitting user can read/write their own feedback
alter table trip_feedback enable row level security;
create policy "trip_feedback: owner only" on trip_feedback
  using (user_id = auth.uid());
