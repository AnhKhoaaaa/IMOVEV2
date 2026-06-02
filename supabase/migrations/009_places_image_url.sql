-- Migration 009: add image_url column to places table
--
-- image_url stores a CDN URL fetched by seed_images.py (Wikipedia / Unsplash).
-- NULL means no image was found for that POI (ATTRACTION/HERITAGE require
-- accurate images; FOOD_BEVERAGE/SHOPPING accept illustrative fallbacks).
-- Run after 007_places_postgis.sql and 008_fix_find_nearest_indoor.sql.

ALTER TABLE places ADD COLUMN IF NOT EXISTS image_url TEXT;
