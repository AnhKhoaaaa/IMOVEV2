# Task List: Google Places API Data Enrichment

> See `tasks/plan.md` for full context, acceptance criteria, and dependency graph.

## Phase 0 — Setup
- [x] **Task 0** · XS · `config.py` + `.env.example` — add `GOOGLE_PLACES_API_KEY`

## Phase 1 — Place ID Discovery
- [x] **Task 1** · S · `enrich_places_google.py` — implement `search_place()` + confidence scorer
  - Returns `place_id`, `confidence`, `lat`, `lng`, `is_closed_permanently`
  - `lat`/`lng` always replaces JSON values on `high`/`medium` confidence
- [ ] **✅ Checkpoint 1** — manually verify 3 place_ids in Google Maps + check lat/lng shift

## Phase 2 — Data Enrichment Functions
- [x] **Task 2** · S · `enrich_places_google.py` — implement `convert_opening_hours(periods)` helper
  - `tests/test_scripts/test_enrich_helpers.py` — 14 unit tests, all pass ✅
- [x] **Task 3** · S · `enrich_places_google.py` — implement `fetch_place_details(place_id)`
  - Field mask: `regularOpeningHours,rating,formattedAddress` (no `websiteUri`)
- [ ] **✅ Checkpoint 2** — test ACM museum (closed Monday), Merlion Park (24h open)

## Phase 3 — Photo Pipeline
- [x] **Task 4** · S · `enrich_places_google.py` — `fetch_photo_name()` + `download_photo()` + `upload_to_supabase()`
  - All 499 POIs — **replaces existing `image_url` unconditionally**
  - Re-run overwrites Supabase Storage object idempotently
- [ ] **✅ Checkpoint 3** — 1 photo URL opens in browser; re-run doesn't error

## Phase 4 — Batch Runner
- [x] **Task 5** · M · `enrich_places_google.py` — full orchestrator
  - Flags: `--phase 1|2|3|all`, `--limit N`, `--dry-run`
  - Phase 1 post-step: auto-remove `CLOSED_PERMANENTLY` from JSON → `closed_permanently.txt`
  - Phase 3: **no resume skip** — always re-fetches images
  - Report files: `closed_permanently.txt`, `unmatched_places.txt`
- [ ] **✅ Checkpoint 4** — `--phase 1 --limit 10 --dry-run`: inspect output, confirm CLOSED_PERMANENTLY removal logic

## Phase 5 — DB Sync
- [x] **Task 6** · XS · `010_places_google_enrichment.sql` — add `google_place_id TEXT`, `rating FLOAT4` columns
  - **Not adding** `website_uri` or `business_status` to DB
- [x] **Task 7** · S · `models/place.py` + `scripts/seed_db.py`
  - Add `google_place_id: Optional[str] = None` and `rating: Optional[float] = None`
  - **Not adding** `website_uri` or `business_status` to model
- [ ] **Task 8** · M · Full run + review logs + `seed_db.py` sync
- [ ] **✅ Checkpoint 5** — `pytest tests/ -v` green; 100% image coverage; `lat`/`lng` updated in DB

---

## Dependency Order

```
Task 0 → Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 8
                                                         ↑
                                         Task 6 ─────────┤
                                         Task 7 ─────────┘
```

Tasks 2 and 4 can be implemented in parallel (different functions, no shared state).
Tasks 6 and 7 can be applied independently of the script (no mutual dependency).

---

## Key Policy Changes vs. Original Plan

| Field | Old policy | **New policy** |
|-------|-----------|----------------|
| `lat` / `lng` | Update only if delta < 100 m | **ALWAYS replace** with Google's coords |
| `image_url` | Set only if currently null | **ALWAYS replace** (even existing Wikipedia/Unsplash) |
| `website_uri` | Add as new field | **Dropped** — not used in app |
| `CLOSED_PERMANENTLY` | Write to report, manual review | **Auto-remove** from JSON, log to audit file |

---

## Files Created / Modified

| File | Action | Task |
|------|--------|------|
| `backend/app/config.py` | modify | 0 |
| `backend/.env.example` | modify | 0 |
| `backend/app/scripts/enrich_places_google.py` | **create** | 1–5 |
| `backend/tests/test_scripts/test_enrich_helpers.py` | **create** | 2 |
| `supabase/migrations/010_places_google_enrichment.sql` | **create** | 6 |
| `backend/app/models/place.py` | modify | 7 |
| `backend/app/scripts/seed_db.py` | modify | 7 |
| `backend/app/data/singapore_places.json` | modify (data) | 8 |

---

## Runtime Output Files (not committed to git)

| File | Content |
|------|---------|
| `backend/closed_permanently.txt` | Audit log of auto-removed POIs (`CLOSED_PERMANENTLY`) |
| `backend/unmatched_places.txt` | POIs with `confidence=low\|no_match` — need manual follow-up |
