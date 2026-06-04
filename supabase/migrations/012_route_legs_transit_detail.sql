-- Add transit detail columns to route_legs so BusArrivalPanel works after backend restart.
-- Without these, _trip_store is cleared on Render hibernate and _fetch_trip_from_db returns
-- legs with empty sub_legs/first_bus_stop_code, making BusArrivalPanel invisible in travel mode.
alter table route_legs
  add column if not exists sub_legs            jsonb  null default '[]',
  add column if not exists first_bus_stop_code text   null,
  add column if not exists geometries          jsonb  null default '[]';
