# Implementation Plan: Google Places API Data Enrichment

> **Scope**: Enrich all 499 POIs in `backend/app/data/singapore_places.json` using
> the Google Places API (New). Three enrichment passes → updated JSON → DB sync.

---

## Current State (Audit)

| Metric | Count | Note |
|--------|-------|------|
| Total POIs | 499 | ATTRACTION 162, FOOD_BEVERAGE 175, HERITAGE 75, SHOPPING 87 |
| `image_url` present | 136 (27%) | Partially seeded from Wikipedia/Unsplash — will be replaced |
| Missing `google_place_id` | 499 (100%) | Field does not exist yet |
| Missing `rating` | 499 (100%) | Field does not exist yet |
| Empty `close_days: []` | 436 (87%) | Most closed-day data is missing |
| `opening_hours` multi-slot | 23 | e.g. temples with split hours |
| `CLOSED_PERMANENTLY` count | unknown | Phase 1 will reveal — those POIs auto-removed |

---

## Architecture Decisions

### 1 — One script, 3 independent resumable phases

`backend/app/scripts/enrich_places_google.py` runs phases sequentially.
Each phase skips POIs that already have the corresponding field set in JSON (resume-safe).
The JSON is written to disk after every POI so a crash never loses completed work.

```
Phase 1 (Text Search Pro)       → adds google_place_id, business_status, lat, lng
                                   AUTO-REMOVES CLOSED_PERMANENTLY POIs from JSON
Phase 2 (Place Details Ent.)    → replaces opening_hours, close_days, formatted_address
                                   adds rating
Phase 3 (Place Details Photos)  → downloads image → Supabase Storage → replaces image_url
```

Run individual phases via `--phase 1|2|3|all` flag.

---

### 2 — Field-mask strategy (cost optimisation)

Billing is based on the **highest-tier field** in the request.
Grouping all Enterprise fields into one call avoids double-billing.

| Phase | API call | Fields requested | Billing tier | Free cap | Cost (499 POIs) |
|-------|----------|-----------------|--------------|----------|-----------------|
| 1 | Text Search | `places.id` · `places.displayName` · `places.location` · `places.businessStatus` | **Pro** | 5,000 req/month | **$0** |
| 2 | Place Details | `regularOpeningHours` · `rating` · `formattedAddress` | **Enterprise** | 1,000 req/month | **$0** |
| 3a | Place Details (photos ref) | `photos` | **IDs Only** | ∞ | **$0** |
| 3b | Photos media | `/v1/{name}/media?maxWidthPx=800` | **Photos** | 1,000 req/month | **$0** |

**Total cost for one full run: $0** (all within monthly free caps).
If re-run >2× in same month: Phase 2 overages ≈ $12, Phase 3 ≈ $0.63.

> `websiteUri` intentionally excluded — not used anywhere in the app.

---

### 3 — Photo storage: Supabase Storage (not raw Google URLs)

Google Places photo URLs are **temporary signed redirects** (expire in hours–days).
Storing them in the DB would break image display.

Strategy:
1. Request `photo_name` from Photos API (IDs Only, free).
2. Call `/v1/{photo_name}/media?maxWidthPx=800` → follow redirect → download JPEG bytes.
3. Upload to Supabase Storage bucket `poi-images/<place_id>.jpg` (public read, overwrite-safe).
4. Store the permanent Supabase public URL in `image_url`.

All 499 POIs get a fresh photo, **including the 136 that already had Wikipedia/Unsplash URLs**.
Those old URLs are replaced. Supabase free tier: 1 GB storage, 499 × ~200 KB ≈ 100 MB.

---

### 4 — Field update policy

> Rationale: Google is the authoritative source for coordinates and visuals.
> Manually curated fields (descriptions, keywords, durations) are kept as-is.

| Field | Action | Rationale |
|-------|--------|-----------|
| `lat` / `lng` | **ALWAYS REPLACE** | Google's geocoded coordinates are more precise than manual entry |
| `image_url` | **ALWAYS REPLACE** | Authoritative photo of the exact venue; replaces generic Wikipedia/Unsplash images |
| `opening_hours` | **REPLACE** | Google real-time structured data > static curation |
| `close_days` | **REPLACE** | 436/499 currently empty — Google fills the gap |
| `formatted_address` | **REPLACE** | Google address has canonical Singapore postal codes |
| `name` | **DO NOT update** | Curated English names may be cleaner than Google's |
| `description` / `search_keywords` | **DO NOT update** | High-quality manual curation |
| `is_outdoor` / `suggested_duration_minutes` / `best_time_*` | **DO NOT update** | Domain knowledge, not inferable from Google |

---

### 5 — New fields added to JSON and DB

After the enrichment run, each POI has these new fields:

```jsonc
{
  "google_place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",  // null if no match found
  "google_match_confidence": "high",                  // "high"|"medium"|"low"|"no_match"
  "rating": 4.6,                                      // null if unavailable
}
```

> `business_status` is **not stored** in JSON or DB — it is only used during Phase 1
> to decide whether to remove a POI. `CLOSED_PERMANENTLY` POIs are deleted from the
> JSON before Phase 2 runs and logged in `backend/closed_permanently.txt` for auditing.

---

### 6 — Automatic removal of closed venues

During Phase 1, when `business_status=CLOSED_PERMANENTLY` is returned:
1. The POI is immediately flagged in memory.
2. After Phase 1 completes (all POIs searched), flagged POIs are **removed from the JSON**.
3. Their names and IDs are written to `backend/closed_permanently.txt` as an audit log.
4. Phases 2 and 3 only run on the surviving (non-closed) POIs.

This keeps the dataset clean without manual intervention.

---

### 7 — Place matching (confidence scoring)

Text Search is called with `textQuery = "{name} Singapore"` and
`locationBias` centred on the POI's existing lat/lng (±500 m radius).

Confidence is assigned by comparing the returned `displayName` against the JSON `name`:

| Condition | Confidence |
|-----------|-----------|
| Name similarity ≥ 80% AND distance < 200 m | `high` |
| Name similarity ≥ 60% OR distance < 500 m | `medium` |
| Name similarity < 60% AND distance ≥ 500 m | `low` |
| No results returned | `no_match` |

Phase 2 and 3 only run on `high` and `medium` confidence matches.
`low` and `no_match` items are written to `backend/unmatched_places.txt` for manual follow-up.

---

## Dependency Graph

```
config.py ← GOOGLE_PLACES_API_KEY
    │
    └─► Phase 1: search_place(poi)
            → google_place_id, lat, lng, business_status
            → CLOSED_PERMANENTLY POIs removed from JSON after phase completes
            │
            └─► Phase 2: fetch_place_details(place_id)
                    → opening_hours, close_days, rating, formatted_address
                    depends on: convert_opening_hours() helper
                    │
                    └─► Phase 3: photo pipeline
                            fetch_photo_name(place_id) → photo_name
                            download_photo(photo_name) → bytes
                            upload_to_supabase(place_id, bytes) → public_url
                            → image_url ALWAYS replaced
                            │
                            └─► JSON written to disk (resumable state)
                                    │
                                    └─► DB sync
                                            Migration 010 (new columns)
                                            models/place.py (new optional fields)
                                            seed_db.py → _to_row() updated
```

---

## Task List

### Phase 0: Setup
- [ ] **Task 0** — API key in config + env.example

### Phase 1: Place ID Discovery
- [ ] **Task 1** — Implement `search_place()` + confidence scorer
- [ ] **Checkpoint 1** — Manual test: 3 POIs searched, verify place_id + new lat/lng correct in Google Maps

### Phase 2: Data Enrichment Functions
- [ ] **Task 2** — Implement `convert_opening_hours()` (Google `periods[]` → app format)
- [ ] **Task 3** — Implement `fetch_place_details()` (Enterprise field mask, no websiteUri)
- [ ] **Checkpoint 2** — Manual test: 3 POIs with known place_id → verify opening_hours + rating

### Phase 3: Photo Functions
- [ ] **Task 4** — Implement photo pipeline: `fetch_photo_name()` + `download_photo()` + `upload_to_supabase()`
- [ ] **Checkpoint 3** — Manual test: 1 photo downloaded, Supabase URL opens in browser

### Phase 4: Batch Runner + CLI
- [ ] **Task 5** — Full `enrich_places_google.py` with `--phase` flag, resume, rate-limit, reports
- [ ] **Checkpoint 4** — Dry run `--phase 1 --limit 10`: inspect JSON, verify lat/lng shifted, confirm CLOSED_PERMANENTLY removal logic

### Phase 5: DB Sync
- [ ] **Task 6** — `supabase/migrations/010_places_google_enrichment.sql`
- [ ] **Task 7** — Update `models/place.py` + `scripts/seed_db.py`
- [ ] **Task 8** — Full run all phases → `seed_db.py` → verify in Supabase dashboard
- [ ] **Checkpoint 5** — `cd backend && pytest tests/ -v` must pass green

---

## Detailed Tasks

---

### Task 0 — API key in config + env.example
**Scope**: XS (2 files)

**What**: Add `GOOGLE_PLACES_API_KEY` as optional setting in `backend/app/config.py`
and document it in `backend/.env.example`.
Optional because it's only needed at script time, not at app runtime.

**Acceptance criteria**:
- [ ] `config.py` has `google_places_api_key: Optional[str] = None`
- [ ] `backend/.env.example` has `GOOGLE_PLACES_API_KEY=your_key_here` with a comment explaining it's only for the enrichment script
- [ ] `cd backend && python -c "from app.config import settings; print(settings.google_places_api_key)"` prints the key or `None` without error

**Verification**:
- [ ] `cd backend && python -c "from app.config import settings"` succeeds with no import errors

**Dependencies**: None

**Files touched**:
- `backend/app/config.py`
- `backend/.env.example`

---

### Task 1 — Implement `search_place()`
**Scope**: S (1 new file + function)

**What**: Write a function that calls the Places API (New) Text Search endpoint for a single POI.

Returns a dataclass/dict:
```python
{
  "place_id":    str | None,
  "confidence":  "high" | "medium" | "low" | "no_match",
  "lat":         float | None,   # Google's coordinates — replaces JSON value unconditionally
  "lng":         float | None,
  "is_closed_permanently": bool,
}
```

Implementation details:
- Endpoint: `POST https://places.googleapis.com/v1/places:searchText`
- Body: `{"textQuery": "{name} Singapore", "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 500.0}}}`
- Headers: `X-Goog-FieldMask: places.id,places.displayName,places.location,places.businessStatus` and `X-Goog-Api-Key: {key}`
- Pick the **first result** from the response.
- Confidence: computed from `difflib.SequenceMatcher` name ratio + haversine distance.
- `is_closed_permanently = (businessStatus == "CLOSED_PERMANENTLY")`

**Acceptance criteria**:
- [ ] `search_place("Merlion Park", 1.28681, 103.85453, key)` → `confidence="high"`, non-null `place_id`, `lat`/`lng` within 50 m of original
- [ ] `search_place("XYZ Nonexistent 99999", 1.3, 103.8, key)` → `confidence="no_match"`, `place_id=None`
- [ ] A venue known to be permanently closed → `is_closed_permanently=True`

**Verification**:
- [ ] Run manually for 3 known POIs; cross-check returned `place_id` at `maps.google.com/?cid=`

**Dependencies**: Task 0

**Files touched**:
- `backend/app/scripts/enrich_places_google.py` (new file)

---

### Task 2 — Implement `convert_opening_hours()`
**Scope**: S (1 helper + unit tests)

**What**: Convert Google's `regularOpeningHours.periods` array into the app's formats:
- `opening_hours: list[str]` — e.g. `["09:00-18:00", "19:00-22:00"]`
- `close_days: list[str]` — e.g. `["Monday"]`

Google `periods` structure:
```json
{"open": {"day": 1, "hour": 9, "minute": 0}, "close": {"day": 1, "hour": 18, "minute": 0}}
```
`day` = 0 (Sunday) … 6 (Saturday). 24h place: `open: {day:0, hour:0, minute:0}` with no `close`.

Close days = day numbers 0–6 **not present** in any `open.day` across all periods.

**Acceptance criteria**:
- [ ] Single-slot Mon–Sun 09:00–18:00 → `opening_hours=["09:00-18:00"]`, `close_days=[]`
- [ ] Split-hours place (07:00–12:00, 18:00–21:00 daily) → `opening_hours=["07:00-12:00", "18:00-21:00"]`, `close_days=[]`
- [ ] Museum open Tue–Sun 10:00–18:00 (closed Monday) → `close_days=["Monday"]`
- [ ] 24h place → `opening_hours=["00:00-23:59"]`, `close_days=[]`
- [ ] `periods=None` or `periods=[]` → `(["00:00-23:59"], [])` (fail-open — same as current app behaviour)
- [ ] Midnight-crossing slot (22:00–02:00) → `opening_hours=["22:00-02:00"]`

**Verification**:
- [ ] `cd backend && pytest tests/test_scripts/test_enrich_helpers.py -v` — all cases pass

**Dependencies**: None (pure function, testable in isolation)

**Files touched**:
- `backend/app/scripts/enrich_places_google.py`
- `backend/tests/test_scripts/test_enrich_helpers.py` (new)

---

### Task 3 — Implement `fetch_place_details()`
**Scope**: S (1 function)

**What**: Call Place Details (New) with an Enterprise field mask for a single `google_place_id`.

- Endpoint: `GET https://places.googleapis.com/v1/places/{place_id}`
- Header: `X-Goog-FieldMask: regularOpeningHours,rating,formattedAddress`
- Header: `X-Goog-Api-Key: {key}`

Returns:
```python
{
  "opening_hours":    list[str],  # from convert_opening_hours()
  "close_days":       list[str],  # from convert_opening_hours()
  "rating":           float | None,
  "formatted_address": str | None,
}
```

> `websiteUri` is intentionally **not** in the field mask — reduces tier cost and is unused.

**Acceptance criteria**:
- [ ] For a museum known to be closed Monday, `close_days=["Monday"]` is returned
- [ ] `rating` is a float between 1.0 and 5.0 (or `None` for very new/obscure venues)
- [ ] `formatted_address` contains "Singapore" and a 6-digit postal code
- [ ] Function handles HTTP 404 (place_id stale) gracefully — returns `None`

**Verification**:
- [ ] Manually call for Asian Civilisations Museum → confirm `close_days=["Monday"]`
- [ ] Manually call for Merlion Park (24h, no close day) → confirm `close_days=[]`

**Dependencies**: Task 0, Task 2

**Files touched**:
- `backend/app/scripts/enrich_places_google.py`

---

### Task 4 — Photo pipeline
**Scope**: S (3 small functions)

**What**: Three functions chained to produce a permanent `image_url` from a `google_place_id`.

```
fetch_photo_name(place_id, key) → photo_name: str | None
    GET https://places.googleapis.com/v1/places/{place_id}
    X-Goog-FieldMask: photos
    Returns the first photo's resource name: "places/ChIJ.../photos/AUc7tXk..."

download_photo(photo_name, key) → bytes | None
    GET https://places.googleapis.com/v1/{photo_name}/media?maxWidthPx=800&skipHttpRedirect=false
    Follow redirect → read full JPEG response body

upload_to_supabase(place_id, jpeg_bytes) → str | None
    Bucket: poi-images  (auto-create as public if missing)
    Object: {place_id}.jpg  (overwrite — enables idempotent re-runs)
    Returns: {SUPABASE_URL}/storage/v1/object/public/poi-images/{place_id}.jpg
```

All 499 POIs run through this pipeline — **existing `image_url` values are replaced**.

**Acceptance criteria**:
- [ ] `fetch_photo_name(valid_place_id, key)` returns a string starting with `"places/"`
- [ ] `download_photo(photo_name, key)` returns bytes > 10 000 (valid JPEG, not an error body)
- [ ] `upload_to_supabase("merlion-park", bytes)` returns a URL; browser opens it and shows the photo
- [ ] Re-running `upload_to_supabase` for the same `place_id` overwrites the previous file without error
- [ ] If any step fails, the function returns `None` and logs a warning — does not raise or crash the batch

**Verification**:
- [ ] Run pipeline for `"merlion-park"` → open returned URL in browser, confirm correct photo

**Dependencies**: Task 0

**Files touched**:
- `backend/app/scripts/enrich_places_google.py`

---

### Task 5 — Full batch runner + CLI
**Scope**: M (orchestration)

**What**: Implement the `enrich()` entry point with full batch logic.

CLI flags:
- `--phase 1|2|3|all` (default: `all`)
- `--limit N` — process only first N POIs per phase (for dry-run testing)
- `--dry-run` — print what would change, write nothing

Resume logic (per field):
- Phase 1: skip POIs that already have `google_place_id` set in JSON
- Phase 2: skip POIs that already have `rating` set in JSON
- Phase 3: **no skip** — `image_url` is always replaced (even if already set)

Rate limiting: `time.sleep(0.3)` between API calls (≈ 3 req/s).

Progress display: `[042/499] Phase 1 — Searching: Gardens by the Bay...`

**Phase 1 flow** (detailed):
1. For each POI without `google_place_id`: call `search_place()`, write result to JSON immediately.
2. After all POIs processed: remove every POI where `is_closed_permanently=True` from the JSON list.
3. Write the pruned JSON to disk.
4. Write removed POIs to `backend/closed_permanently.txt` (audit log).
5. Write `confidence=low|no_match` POIs to `backend/unmatched_places.txt`.

**Phase 2 flow**:
- For each POI with `google_place_id` and `confidence in (high, medium)` and no `rating` yet:
  call `fetch_place_details()`, update fields in JSON, write to disk.

**Phase 3 flow**:
- For each POI with `google_place_id` and `confidence in (high, medium)`:
  run photo pipeline, set `image_url`, write to disk. No skip — always replaces.

**Acceptance criteria**:
- [ ] `--phase 1 --limit 10 --dry-run` prints 10 planned changes without writing anything
- [ ] `--phase 1 --limit 10` writes to JSON, second run skips all 10 (already have `google_place_id`)
- [ ] After Phase 1 with a known-closed venue: that POI is absent from JSON, present in `closed_permanently.txt`
- [ ] After `--phase all`: `image_url` is set for all surviving POIs that had a `high`/`medium` match
- [ ] Interrupt mid-run (Ctrl-C), re-run → continues from last saved POI

**Verification**:
- [ ] `--phase 1 --limit 10`: inspect 3 POIs in JSON — `lat`/`lng` updated, `google_place_id` set
- [ ] `--phase 2 --limit 5`: open 2 POIs in Google Maps, confirm `opening_hours` match reality
- [ ] `--phase 3 --limit 3`: check 3 Supabase Storage objects exist and images load in browser

**Dependencies**: Tasks 1–4

**Files touched**:
- `backend/app/scripts/enrich_places_google.py`

---

### Task 6 — Migration 010: new DB columns
**Scope**: XS (1 SQL file)

**What**: Add the 2 new fields (`google_place_id`, `rating`) to the `places` table.
`website_uri` and `business_status` are **not** added to the DB — they are JSON-only
or ephemeral (business_status used only during enrichment, not persisted).

```sql
-- Migration 010: Google Places API enrichment fields
-- Adds google_place_id (for re-enrichment) and rating (for future sorting/display).

ALTER TABLE places
    ADD COLUMN IF NOT EXISTS google_place_id  TEXT,
    ADD COLUMN IF NOT EXISTS rating           FLOAT4;

-- Index for future lookups by place_id (e.g. re-enrichment targeting)
CREATE INDEX IF NOT EXISTS places_google_place_id_idx
    ON places (google_place_id);
```

**Acceptance criteria**:
- [ ] Migration applies without error in Supabase SQL editor
- [ ] `SELECT google_place_id, rating FROM places LIMIT 1;` returns 2 null columns before seed

**Verification**:
- [ ] Run in Supabase Dashboard → SQL editor → confirm "Success"

**Dependencies**: None (independent of script tasks)

**Files touched**:
- `supabase/migrations/010_places_google_enrichment.sql` (new)

---

### Task 7 — Update Place model + seed_db.py
**Scope**: S (2 files)

**What**:
1. Add 2 new optional fields to `backend/app/models/place.py`:
   ```python
   google_place_id: Optional[str]   = None
   rating:          Optional[float] = None
   ```
2. Update `_to_row()` in `backend/app/scripts/seed_db.py` to include the 2 new fields.

> `website_uri` and `business_status` are **not** added to the model — they are not
> stored in the DB and not used by the app at runtime.

**Acceptance criteria**:
- [ ] Existing `Place(...)` instantiation without new fields still validates (backward-compatible)
- [ ] `_to_row({"id":"x", ..., "google_place_id":"ChIJ...", "rating": 4.5})` includes both keys
- [ ] `_to_row({"id":"x", ...})` (no new fields) works without KeyError (uses `.get()`)

**Verification**:
- [ ] `cd backend && pytest tests/ -v` — all existing tests green (no regressions)

**Dependencies**: None (backward-compatible model extension)

**Files touched**:
- `backend/app/models/place.py`
- `backend/app/scripts/seed_db.py`

---

### Task 8 — Full run + DB sync
**Scope**: M (operational — no new code)

**What**: Execute the enrichment end-to-end and sync to Supabase.

```bash
# 1. Run enrichment (all 3 phases)
cd backend && python -m app.scripts.enrich_places_google --phase all

# 2. Review audit logs
cat closed_permanently.txt   # POIs auto-removed (note how many, for awareness)
cat unmatched_places.txt     # POIs that need manual image / address check

# 3. Commit updated JSON
git add backend/app/data/singapore_places.json
git commit -m "data: enrich 499 POIs with Google Places API (coords, hours, ratings, photos)"

# 4. Apply migration
# Supabase Dashboard → SQL editor → paste 010_places_google_enrichment.sql → Run

# 5. Sync to DB
cd backend && python -m app.scripts.seed_db
```

**Acceptance criteria**:
- [ ] All surviving POIs have `google_place_id` set, or `google_match_confidence=no_match`
- [ ] `lat`/`lng` have been updated for all `high`/`medium` confidence POIs
- [ ] `image_url` is non-null for **100%** of `high`/`medium` confidence POIs
- [ ] `close_days` is now non-empty for museums and temples known to have weekly closures
- [ ] `CLOSED_PERMANENTLY` POIs absent from JSON (logged in `closed_permanently.txt`)
- [ ] `cd backend && pytest tests/ -v` all green after DB sync

**Verification**:
- [ ] Frontend → Planner → browse all categories → every card has a photo
- [ ] `SELECT COUNT(*) FROM places WHERE image_url IS NULL` → returns 0 (or only unmatched POIs)
- [ ] `SELECT COUNT(*) FROM places WHERE lat != original_lat` → non-zero (confirms coords updated)

**Dependencies**: Tasks 5, 6, 7

---

## Checkpoint Summary

| Checkpoint | After tasks | What to verify |
|-----------|------------|----------------|
| **CP 1** | Task 1 | 3 place_ids correct in Google Maps; lat/lng shifted as expected |
| **CP 2** | Task 3 | `opening_hours` + `close_days` correct for 3 known venues |
| **CP 3** | Task 4 | 1 photo loads in browser; re-run overwrites cleanly |
| **CP 4** | Task 5 | `--limit 10` dry run looks correct; CLOSED_PERMANENTLY removal works |
| **CP 5** | Task 8 | All tests green; 100% image coverage; coords updated in DB |

---

## Risk Table

| Risk | Impact | Mitigation |
|------|--------|------------|
| Place name doesn't match Google | Medium | `locationBias` + confidence scoring; `unmatched_places.txt` for follow-up |
| Google returns wrong venue for ambiguous name | High | Only update on `high`/`medium` confidence; `low`/`no_match` untouched |
| Enterprise free cap (1,000/month) exceeded mid-run | Medium | Script is resumable; pause until next month resets cap |
| Supabase Storage `poi-images` bucket missing | Low | Script auto-creates bucket on first run |
| Photo download fails (network / 429) | Low | Retry 3× with exponential backoff; log warning, skip POI for Phase 3 |
| Google lat/lng moves a venue to wrong location | Low | Confidence scoring uses original coords as bias; large deltas get `low` confidence |
| `convert_opening_hours` edge case (midnight-crossing, public holidays) | Medium | Unit-tested against all known patterns; `periods=None` fails open |
| `CLOSED_TEMPORARILY` venue wrongly included | Low | Only `CLOSED_PERMANENTLY` is auto-removed; temporary closures stay in dataset |

---

## Open Questions

1. **Supabase Storage region**: The `poi-images` bucket will be in the Supabase project's region. Acceptable for image serving latency to Singapore users?
2. **Rating display in UI**: `rating` is added to JSON and DB but not yet displayed in any frontend component. Separate frontend task needed if desired.
3. **`google_match_confidence` in DB**: Currently JSON-only. Should it be stored in the DB for filtering (e.g. hide `no_match` venues from recommendations)?
4. **Unmatched POIs**: After seeing `unmatched_places.txt`, decide whether to manually find their `google_place_id` or leave them without Google enrichment.
