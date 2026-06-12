-- Persist per-leg transport alternatives so the mode switcher survives backend restart /
-- DB reload. Without this, _fetch_trip_from_db returns legs with empty alternatives and the
-- Trip mode menu disables every mode except the current one ("đổi 1 lần không đổi lại được").
-- Compact summary only (no polylines/instructions/sub_legs) to avoid bloating route_legs;
-- full geometry is re-fetched lazily on switch.
alter table route_legs
  add column if not exists alternatives jsonb null default '{}';
