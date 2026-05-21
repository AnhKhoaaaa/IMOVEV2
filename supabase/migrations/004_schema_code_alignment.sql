-- Align Supabase schema with backend persist/fetch and adaptation_agent inserts.
-- Idempotent: safe to re-run on projects that already applied 001–003.

-- trip_places: columns expected by trips._persist_trip_plan
alter table trip_places add column if not exists place_name text;
alter table trip_places add column if not exists lat numeric;
alter table trip_places add column if not exists lng numeric;
alter table trip_places add column if not exists dwell_minutes integer;
alter table trip_places add column if not exists day_number integer;
alter table trip_places add column if not exists order_in_day integer;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trip_places' and column_name = 'day'
  ) then
    update trip_places set day_number = day where day_number is null;
    update trip_places set order_in_day = position where order_in_day is null;
  end if;
end $$;

alter table trip_places drop column if exists day;
alter table trip_places drop column if exists position;

-- route_legs: day_number + order_in_day (replaces day/position)
alter table route_legs add column if not exists day_number integer;
alter table route_legs add column if not exists order_in_day integer;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'route_legs' and column_name = 'day'
  ) then
    update route_legs set day_number = day where day_number is null;
    update route_legs set order_in_day = position where order_in_day is null;
  end if;
end $$;

alter table route_legs drop column if exists day;
alter table route_legs drop column if exists position;

create index if not exists route_legs_trip_day_order_idx
  on route_legs (trip_id, day_number, order_in_day);

-- lta_alerts: adaptation_agent inserts
alter table lta_alerts add column if not exists affected_line text;
alter table lta_alerts add column if not exists resolved_at timestamptz;

-- trip_feedback: implicit leg edits + Memory Agent
alter table trip_feedback add column if not exists feedback_type text default 'explicit';
alter table trip_feedback alter column user_id drop not null;
