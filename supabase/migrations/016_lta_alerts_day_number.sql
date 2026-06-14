-- dev18: weather alerts are now scoped to a specific day.
-- day_number lets the backend store WHICH day a weather_warning applies to, so the
-- swap only touches that day's outdoor stops and the UI can label "Day N".
-- Nullable: transit alerts (train_delay / service_unavailable) leave it NULL, and
-- legacy weather alerts created before this migration also read back as NULL
-- (the swap then falls back to its previous whole-trip behaviour).
alter table lta_alerts add column if not exists day_number integer;
