-- Trip lifecycle: rename status values to match business_rules.md §2
-- Old: planning | active | completed
-- New: DRAFT | UPCOMING | HAPPENING_TODAY | PAST
--
-- Also adds start_date and end_date columns required for state machine transitions.

-- 1. Add lifecycle columns (nullable for existing rows)
alter table trips
  add column if not exists start_date date,
  add column if not exists end_date date;

-- 2. Rename existing status values
update trips set status = 'HAPPENING_TODAY' where status = 'planning';
update trips set status = 'PAST'            where status = 'completed';
update trips set status = 'UPCOMING'        where status = 'active';

-- 3. Add a CHECK constraint to enforce valid values going forward
alter table trips
  drop constraint if exists trips_status_check;
alter table trips
  add constraint trips_status_check
    check (status in ('DRAFT', 'UPCOMING', 'HAPPENING_TODAY', 'PAST'));

-- 4. Index on (status, start_date) — used by the scheduler queries
create index if not exists trips_status_start_date on trips(status, start_date);
