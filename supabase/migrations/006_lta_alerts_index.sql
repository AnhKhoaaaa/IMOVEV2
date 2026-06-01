-- Composite indexes on lta_alerts to eliminate full-table-scan in dedup queries.
--
-- The dedup pattern runs every 2 minutes across all active trips; without indexes,
-- every call is O(n) on the full lta_alerts table.
--
-- Query patterns covered:
--   Pattern 1 — train_delay / transport_alert:
--     WHERE trip_id=? AND alert_type=? AND affected_line=? AND resolved_at IS NULL AND created_at>=?
--   Pattern 2 — service_unavailable:
--     WHERE trip_id=? AND alert_type=? AND resolved_at IS NULL AND created_at>=?
--   Pattern 3 — weather_warning (no resolved_at filter):
--     WHERE trip_id=? AND alert_type=? AND created_at>=?

-- Index A (partial): covers patterns 1 & 2 — unresolved alerts only.
-- Partial indexes are ~60% smaller than full indexes and are preferentially chosen
-- by the PostgreSQL planner when the query contains WHERE resolved_at IS NULL.
CREATE INDEX IF NOT EXISTS lta_alerts_dedup_unresolved_idx
  ON lta_alerts (trip_id, alert_type, created_at DESC)
  WHERE resolved_at IS NULL;

-- Index B (full): covers pattern 3 — weather_warning queries that do not
-- filter on resolved_at. Also serves as fallback for the planner on any
-- trip_id + alert_type range-scan that doesn't qualify for Index A.
CREATE INDEX IF NOT EXISTS lta_alerts_dedup_full_idx
  ON lta_alerts (trip_id, alert_type, created_at DESC);
