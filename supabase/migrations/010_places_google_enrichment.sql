-- Migration 010: Google Places API enrichment fields
--
-- Adds google_place_id (for re-enrichment targeting) and rating (for future
-- sorting/display). website_uri and business_status are intentionally NOT
-- stored in the DB — they are JSON-only or ephemeral (business_status is used
-- only during the enrichment script run, not persisted).
--
-- Run after 009_places_image_url.sql.
-- Apply via Supabase Dashboard → SQL editor, or supabase db push.

ALTER TABLE places
    ADD COLUMN IF NOT EXISTS google_place_id  TEXT,
    ADD COLUMN IF NOT EXISTS rating           FLOAT4;

-- Index to support future re-enrichment queries targeting specific place_ids
CREATE INDEX IF NOT EXISTS places_google_place_id_idx
    ON places (google_place_id);
