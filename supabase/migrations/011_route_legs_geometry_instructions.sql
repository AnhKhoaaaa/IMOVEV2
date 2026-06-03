-- Add geometry (encoded polyline) and instructions (turn-by-turn steps) to route_legs.
-- Both were present in the Pydantic model but missing from the schema, causing
-- PGRST204 errors whenever the backend tried to persist a leg after a mode change.
alter table route_legs
  add column if not exists geometry     text          null,
  add column if not exists instructions text[]        null default '{}',
  add column if not exists distance_km  numeric(8,3)  null;
