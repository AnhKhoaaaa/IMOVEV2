-- IMOVE initial schema

create table user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null unique,
  prefer_mrt boolean default true,
  max_walk_minutes integer default 15,
  avoid_transfers boolean default false,
  updated_at timestamptz default now()
);

create table trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,   -- nullable: guest mode
  session_id text not null,             -- localStorage UUID for guests
  num_days integer not null,
  budget_sgd numeric(10,2) not null,
  status text default 'planning',       -- planning | active | completed
  created_at timestamptz default now()
);

create table trip_places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips on delete cascade not null,
  place_id text not null,              -- references places.json id
  day integer not null,
  position integer not null            -- order within the day
);

create table route_legs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips on delete cascade not null,
  day integer not null,
  position integer not null,
  from_place_id text not null,
  to_place_id text not null,
  transport_mode text not null,
  duration_minutes integer not null,
  cost_sgd numeric(6,2) not null,
  is_estimated boolean not null default false  -- must be false when from OneMap
);

create table lta_alerts (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips on delete cascade not null,
  alert_type text not null,             -- transport_alert | service_unavailable | weather_warning
  message text not null,
  created_at timestamptz default now()
);

create table trip_feedback (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips on delete cascade not null,
  user_id uuid references auth.users not null,
  leg_id uuid references route_legs,
  rating integer check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now()
);

-- Indexes
create index on trips(session_id);
create index on trip_places(trip_id, day);
create index on route_legs(trip_id, day);
create index on lta_alerts(trip_id);

-- RLS
alter table trips enable row level security;
alter table user_preferences enable row level security;
alter table lta_alerts enable row level security;

create policy "trips: owner access" on trips
  using (user_id = auth.uid() or session_id = current_setting('app.session_id', true));

create policy "preferences: owner only" on user_preferences
  using (user_id = auth.uid());

create policy "alerts: read only for clients" on lta_alerts
  for select using (true);
