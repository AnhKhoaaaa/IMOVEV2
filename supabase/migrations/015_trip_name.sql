-- 015_trip_name.sql
-- Add human-readable name to trips table.
-- Nullable so existing rows are unaffected; frontend sends the name on create.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS name TEXT;
