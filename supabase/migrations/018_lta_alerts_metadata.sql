-- dev20: structured payload for closing_risk alerts (at-risk place, projected/close times,
-- per-day capacity for the "push to another day" option). Frontend reads alert.metadata to
-- render the feasible resolutions (leave_earlier / skip / push) and per-day capacity badges.
-- Other alert types leave it NULL.
alter table lta_alerts add column if not exists metadata jsonb;
