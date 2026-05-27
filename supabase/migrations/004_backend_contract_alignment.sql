-- Align Supabase tables with the current backend persistence contract.
-- This migration is idempotent so existing local/hosted databases can be patched safely.

-- routers/trips.py persists denormalized place snapshots for trip reconstruction.
alter table trip_places
  add column if not exists place_name text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists dwell_minutes integer;

-- The backend currently writes a flat place list without day/position.
-- Keep legacy columns for compatibility, but do not require them for new inserts.
alter table trip_places
  alter column day drop not null,
  alter column position drop not null;

-- routers/trips.py and agents/adaptation_agent.py write/read day_number.
alter table route_legs
  add column if not exists day_number integer;

update route_legs
set day_number = day
where day_number is null
  and day is not null;

alter table route_legs
  alter column day_number set not null,
  alter column day drop not null,
  alter column position drop not null;

-- Adaptation agent deduplicates unresolved alerts by line and later resolves them.
alter table lta_alerts
  add column if not exists affected_line text,
  add column if not exists resolved_at timestamptz;

-- Memory agent stores explicit and implicit feedback. Some current flows are guest-mode
-- or system-generated, so user_id must stay nullable until JWT auth is wired.
alter table trip_feedback
  add column if not exists feedback_type text not null default 'explicit';

alter table trip_feedback
  alter column user_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'trip_feedback_feedback_type_check'
  ) then
    alter table trip_feedback
      add constraint trip_feedback_feedback_type_check
      check (feedback_type in ('explicit', 'implicit'));
  end if;
end $$;

create index if not exists trip_places_trip_id_place_id_idx
  on trip_places(trip_id, place_id);

create index if not exists route_legs_trip_id_day_number_idx
  on route_legs(trip_id, day_number);

create index if not exists lta_alerts_open_idx
  on lta_alerts(trip_id, alert_type, affected_line, created_at)
  where resolved_at is null;

create index if not exists trip_feedback_user_type_idx
  on trip_feedback(user_id, feedback_type);
