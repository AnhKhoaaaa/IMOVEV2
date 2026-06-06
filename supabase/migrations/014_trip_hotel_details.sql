-- 014_trip_hotel_details.sql
-- Add hotel configuration columns to trips table (optional)
-- This allows tourists to configure a start location for their trip.

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS hotel_name TEXT,
  ADD COLUMN IF NOT EXISTS hotel_lat NUMERIC,
  ADD COLUMN IF NOT EXISTS hotel_lng NUMERIC;
