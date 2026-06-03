# dev9 — POI Image Seeding via Wikipedia + Unsplash

## Goal
Seed `image_url` for all 499 Singapore POIs. Store in:
1. `backend/app/data/singapore_places.json` (primary source read by `routers/places.py`)
2. `supabase/places.image_url` column (keeps DB mirror in sync)

## Accuracy policy

| Category | Primary | Secondary | Fallback |
|---|---|---|---|
| ATTRACTION (162) | Wikipedia | — | **None** (leave NULL, log warning) |
| HERITAGE (75) | Wikipedia | — | **None** (leave NULL, log warning) |
| FOOD_BEVERAGE (175) | Wikipedia | Unsplash `"{name} Singapore"` | Illustrative category image |
| SHOPPING (87) | Wikipedia | Unsplash `"{name} Singapore"` | Illustrative category image |

ATTRACTION + HERITAGE: no illustrative fallback — missing image stays `null` and shows placeholder UI.

## Files to create / modify

```
supabase/migrations/009_places_image_url.sql   ← ADD image_url TEXT column
backend/app/scripts/seed_images.py              ← new fetch + write script
backend/.env.example                            ← add UNSPLASH_ACCESS_KEY
```

No changes to: Place model, routers, planning_agent, adaptation_agent, frontend.

## Migration 009

```sql
ALTER TABLE places ADD COLUMN IF NOT EXISTS image_url TEXT;
```

Simple. No index needed (not queried by distance or filter).

## Seed script logic

```
seed_images.py
  1. Load singapore_places.json → list[dict]
  2. Pre-fetch 10 fallback image URLs for FOOD_BEVERAGE + SHOPPING via Unsplash
  3. For each POI:
       a. Try Wikipedia summary API (name → "name Singapore")
       b. If found thumbnail → use it (all categories)
       c. If not found + category FOOD_BEVERAGE|SHOPPING:
            Try Unsplash search("{name} Singapore")
            If found → use it
            Else → pick from pre-fetched category fallbacks (round-robin for variety)
       d. If not found + category ATTRACTION|HERITAGE:
            image_url = None, log WARN "[ATTRACTION/HERITAGE] no image: {name}"
       e. Store result in-memory
  4. Write updated list back to singapore_places.json
  5. Upsert image_url column to Supabase places table (batch 50)
```

## APIs

### Wikipedia REST API (no key)
```
GET https://en.wikipedia.org/api/rest_v1/page/summary/{encoded_name}
→ body.thumbnail.source  (Wikimedia CDN URL)

Resize: replace /320px- with /800px- in the URL for higher resolution.
Try 1: "{name}"
Try 2: "{name} Singapore"  (if 404 or no thumbnail)
Rate: 0.2s delay between requests (polite crawl)
```

### Unsplash Search API (needs UNSPLASH_ACCESS_KEY)
```
GET https://api.unsplash.com/search/photos
    ?query={name} Singapore&per_page=1&orientation=landscape
    Authorization: Client-ID {UNSPLASH_ACCESS_KEY}
→ results[0].urls.regular  (1080px width)

Demo limit: 50 req/hr — script respects this with dynamic delay
Production limit: 5,000 req/hr — recommended (free, apply at unsplash.com/developers)
```

### Category fallback (Unsplash pre-fetch, 10 images each)
```python
FALLBACK_QUERIES = {
    "FOOD_BEVERAGE": "Singapore hawker food",
    "SHOPPING":      "Singapore Orchard Road shopping mall",
}
# Fetched once at script start: per_page=10 → pick round-robin per POI
```

## Rate limit strategy

| Situation | Delay |
|---|---|
| Between Wikipedia calls | 200ms |
| Between Unsplash calls (demo key) | 75s/50=1.44s → use 1.5s |
| Between Unsplash calls (prod key) | 100ms |
| Between Supabase upserts | 100ms (same as seed_db.py) |

Script detects demo vs production from rate limit response headers and auto-adjusts.

## Expected coverage (estimated)

| Category | Wikipedia hit | Unsplash hit | Fallback | NULL |
|---|---|---|---|---|
| ATTRACTION 162 | ~138 (85%) | — | — | ~24 (15%) |
| HERITAGE 75 | ~64 (85%) | — | — | ~11 (15%) |
| FOOD_BEVERAGE 175 | ~26 (15%) | ~130 (75%) | ~19 (10%) | 0 |
| SHOPPING 87 | ~35 (40%) | ~43 (50%) | ~9 (10%) | 0 |
| **Total** | **263** | **173** | **28** | **~35** |

~35 ATTRACTION/HERITAGE without a Wikipedia image will need manual review after the run.
Script outputs a `missing_images.txt` list for manual follow-up.

## Run instructions (to be added to README)

```bash
# Apply migration first
# (paste 009_places_image_url.sql in Supabase SQL Editor)

# Ensure UNSPLASH_ACCESS_KEY in backend/.env
cd backend
python -m app.scripts.seed_images

# Output:
#   backend/app/data/singapore_places.json  ← updated in-place
#   missing_images.txt                      ← ATTRACTION/HERITAGE without images
# Then restart backend so routers/places.py reloads the JSON.
```

## Frontend — no changes required

`PlaceCard.jsx` already renders `place.image_url` via `ImageStrip` (line 124).
`Place` Pydantic model already has `image_url: Optional[str] = None` (line 30).
`_normalise_place` uses `**p` spread so `image_url` flows through automatically.

A note for the frontend team will be added to `HandOffFrontend.md` about:
- ImageStrip currently shows 1 real photo + 2 placeholder slots
- PlaceBrowser grid cards (used in place picker) do not show images yet
