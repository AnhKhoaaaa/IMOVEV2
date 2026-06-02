# Dev8 — Integrate `singapore_places.json` (499-POI dataset)

## Context

A new curated dataset `backend/app/data/singapore_places.json` replaces the old
`backend/app/data/places.json` (50 POI). The new file has 499 entries and an
updated schema. All production features currently hard-code paths to `places.json`
and expect the old field names. This sprint makes the switch with zero silent
failures at runtime.

---

## What changed in the data

| Dimension | Old (`places.json`) | New (`singapore_places.json`) |
|-----------|--------------------|-----------------------------|
| Count | 50 | **499** |
| Categories | ATTRACTION | ATTRACTION (162), FOOD_BEVERAGE (175), HERITAGE (75), SHOPPING (87) |
| `dwell_minutes` | ✓ int | ✗ **renamed** → `suggested_duration_minutes` |
| `best_time_start` | ✓ "HH:MM" | ✓ **pre-enriched** — research-backed per-place values (499/499 entries, all validated within `opening_hours`) |
| `best_time_end` | ✓ "HH:MM" | ✓ **pre-enriched** — same as above |
| `opening_hours` | single string `"HH:MM-HH:MM"` | **list** `["HH:MM-HH:MM"]` (23 entries have 2 slots) |
| `close_days` | ✗ | ✓ list[str] e.g. `["Monday"]` (63 entries) |
| `image_url` | Optional[str] | ✗ removed |
| `source` | str | ✗ removed |
| `description` | ✗ | ✓ str (rich text) |
| `formatted_address` | ✗ | ✓ str |
| `search_keywords` | ✗ | ✓ list[str] |
| `is_audited`, `offset_over_1km` | ✗ | ✓ bool |

> `best_time_start` / `best_time_end` were added via `backend/scripts/enrich_best_times.py`
> (run once, output committed to the JSON). No runtime derivation needed.

### Notable ID renames (21 old IDs not in new file)

| Old ID | New ID(s) |
|--------|-----------|
| `gardens-by-the-bay` | `gardens-by-the-bay-supertree-grove`, `-flower-dome`, `-cloud-forest`, `-ocbc-skyway` |
| `marina-bay-sands` | `marina-bay-sands-skypark` |
| `esplanade-theatres` | `esplanade-theatres-on-the-bay` |
| `chinatown`, `kampong-glam`, `haji-lane` | replaced by more granular entries |
| `sentosa-palawan-beach`, `sentosa-siloso-beach`, `sentosa-universal-studios` | new Sentosa IDs |
| `night-safari`, `river-wonders`, `satay-by-the-bay`, etc. | new IDs |

---

## Files affected

| File | Change type |
|------|------------|
| `backend/app/agents/planning_agent.py` | Path update + normaliser + validation update |
| `backend/app/routers/places.py` | Path update + search improvement |
| `backend/app/models/place.py` | Schema update (add new fields, list opening_hours) |
| `backend/app/agents/adaptation_agent.py` | `_is_open_now` — handle list opening_hours + close_days |
| `backend/tests/test_routers/test_places.py` | Fix 3 tests broken by name/category changes |

`tests/test_agents/test_adaptation_agent.py` — fixtures are self-contained (no real IDs looked up from dataset), no changes needed.

---

## Implementation steps

### Step 1 — `planning_agent.py`: normaliser + path switch

`best_time_start` / `best_time_end` are **already present** in the JSON — no
derivation needed. `_normalise_place` only needs to map the renamed
`suggested_duration_minutes` → `dwell_minutes`.

```python
_PLACES_PATH = Path(__file__).parent.parent / "data" / "singapore_places.json"

def _normalise_place(p: dict) -> dict:
    """Map singapore_places.json schema → internal schema expected by all agents.
    Only transformation needed: suggested_duration_minutes → dwell_minutes.
    best_time_start / best_time_end are pre-enriched in the JSON itself.
    """
    return {
        **p,
        "dwell_minutes": p.get("suggested_duration_minutes", 60),
        # opening_hours stays as list[str] — _is_open_now handles this format
    }
```

Update `_REQUIRED_KEYS` and startup validation. `best_time_start`/`best_time_end`
are now real fields in the file so `_validate_time` calls are kept:

```python
_REQUIRED_KEYS = {
    "id", "name", "lat", "lng", "category", "is_outdoor",
    "suggested_duration_minutes", "opening_hours",
    "best_time_start", "best_time_end",   # present in file, validated at startup
}

# _validate_time calls stay: both fields now exist in the JSON
_validate_time(_p["best_time_start"], _p["id"], "best_time_start")
_validate_time(_p["best_time_end"],   _p["id"], "best_time_end")
```

### Step 2 — `routers/places.py`: path switch + search improvement

```python
_PLACES_PATH = pathlib.Path(__file__).parent.parent / "data" / "singapore_places.json"
_raw_places = json.loads(_PLACES_PATH.read_text(encoding="utf-8"))
_CURATED: list[Place] = [Place(**_normalise_place(p)) for p in _raw_places]
```

Import `_normalise_place` from `planning_agent`. Improve `/search` to also
match `search_keywords` (new field):

```python
@router.get("/search", response_model=list[Place])
async def search_places(q: str = Query(..., min_length=1)):
    q_lower = q.lower()
    return [
        p for p in _CURATED
        if q_lower in p.name.lower()
        or q_lower in p.category.lower()
        or any(q_lower in kw.lower() for kw in (p.search_keywords or []))
    ]
```

### Step 3 — `models/place.py`: schema update

`best_time_start` / `best_time_end` remain required (now sourced from the JSON
directly, not derived). `opening_hours` changes from `Optional[str]` to
`Optional[list[str]]`. New fields added as optional for backward-compat with
test fixtures that construct `Place(...)` without them.

```python
from pydantic import BaseModel
from typing import Optional

class Place(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    category: str
    is_outdoor: bool
    in_curated_dataset: bool = True

    # Required — present in both old schema (str) and new JSON (pre-enriched)
    dwell_minutes: int            # normalised from suggested_duration_minutes
    best_time_start: str          # HH:MM, stored directly in singapore_places.json
    best_time_end: str            # HH:MM, stored directly in singapore_places.json

    # New schema fields (optional for backward-compat with test fixtures)
    opening_hours: Optional[list[str]] = None   # was Optional[str] — now list
    close_days: Optional[list[str]] = None
    description: Optional[str] = None
    formatted_address: Optional[str] = None
    search_keywords: Optional[list[str]] = None
    suggested_duration_minutes: Optional[int] = None
    is_audited: Optional[bool] = None
    offset_over_1km: Optional[bool] = None

    # Old schema field — absent in new file but kept optional for old trips
    image_url: Optional[str] = None
```

### Step 4 — `adaptation_agent.py`: list-aware `_is_open_now`

The existing `_is_open_now` (added in dev7 audit fix) parses a string. Update to
handle `list[str]` and `close_days`:

```python
from datetime import datetime

def _is_open_now(place: dict) -> bool:
    """Return False if the place is provably closed right now. Fail-open on parse error."""
    now_dt = datetime.now()
    now_str = now_dt.strftime("%H:%M")
    day_name = now_dt.strftime("%A")  # e.g. "Monday"

    # Check close_days first
    close_days = place.get("close_days") or []
    if day_name in close_days:
        return False

    opening_hours = place.get("opening_hours")
    if not opening_hours:
        return True
    # Normalise to list
    slots: list[str] = opening_hours if isinstance(opening_hours, list) else [opening_hours]
    if not slots:
        return True

    for slot in slots:
        parts = slot.split("-")
        if len(parts) != 2:
            return True  # unparseable → fail-open
        start, end = parts[0].strip(), parts[1].strip()
        if start == "00:00" and end in ("23:59", "24:00"):
            return True
        # Midnight-crossing slot (e.g. "19:00-02:00")
        if end < start:
            if now_str >= start or now_str <= end:
                return True
        else:
            if start <= now_str <= end:
                return True
    return False
```

Update `_nearest_indoor` signature to pass `place` dict (not just lat/lng) so
the open check can read `close_days` too:

```python
# In _nearest_indoor, change filter to:
and _is_open_now(p)     # replaces check_open=True param
```

### Step 5 — `tests/test_routers/test_places.py`: fix 3 broken tests

| Test | Problem | Fix |
|------|---------|-----|
| `test_curated_place_has_required_fields` | asserts `"dwell_minutes"` — still valid since we derive it | No change needed |
| `test_search_finds_by_name` | searches `"marina"`, checks `"Marina Bay Sands"` in names — new name is `"Marina Bay Sands – SkyPark Observation Deck"` | assert `any("Marina Bay Sands" in n for n in names)` |
| `test_search_case_insensitive` | searches `"GARDENS"`, checks `"Gardens by the Bay"` — new has `"Gardens by the Bay Supertree Grove"` etc. | assert `any("Gardens by the Bay" in n for n in names)` |
| `test_search_finds_by_category` | searches category `"nature"` — new data uses `"ATTRACTION"` not `"nature"` | search `"ATTRACTION"` or use `search_keywords` match |

---

## Pre-enriched `best_time_start` / `best_time_end` — methodology

Fields were populated by `backend/scripts/enrich_best_times.py` (one-shot run,
output committed). Logic used:

| Source | Priority | Coverage |
|--------|----------|----------|
| `SPECIFIC` dict in script | Highest | 420+ famous/time-sensitive places — research-backed (web search for show times, sunset hours, birdwatching windows) |
| Fallback rules | Fallback | Remaining generic entries — category × is_outdoor × opening pattern |
| Validator | Post-check | Ensures both times fall within `opening_hours`; falls back to rule-based if a specific override violates the place's own hours |

**Key decisions recorded:**

| Place type | `best_time` | Reason |
|---|---|---|
| Supertree Grove | 19:00–21:00 | Garden Rhapsody light show at 19:45 & 20:45 |
| Wings of Time | 19:40–20:10 | First show slot exactly |
| Night Safari | 19:15–22:00 | Park opens 19:15; Creatures of Night show 19:30 |
| Singapore Flyer | 18:00–21:00 | Golden hour + city lights |
| Outdoor parks (24h) | 07:00–11:00 | Cooler temperature, less crowded |
| Hawker centres (open < 08:00) | 07:00–11:00 | Breakfast peak + fresh wet market |
| Hawker / satay (open ≥ 17:00) | opening + 1h to +3h | Evening crowd |
| Museums / galleries | 10:00–14:00 | Before afternoon school groups |
| Temples | First slot open → +3h | Morning puja/prayer activity |
| Shopping malls | 14:00–20:00 | Avoid quiet opening hours |

The script is idempotent and re-runnable if the JSON needs to be regenerated.

---

## Out of scope for this sprint

- Removing the old `places.json` file — keep as backup until dev9 verification
- Supabase migration for `trip_places` referencing old IDs — existing saved trips
  with old place IDs will get `in_curated_dataset=False` on next load (existing
  behaviour for unknown IDs)
- Frontend place-picker updates for new categories (FOOD_BEVERAGE, HERITAGE,
  SHOPPING) — separate frontend sprint
- `offset_over_1km` field usage in routing logic — not used today, just stored

---

## Test plan

```bash
cd backend
pytest tests/test_routers/test_places.py -v          # places API
pytest tests/test_agents/test_adaptation_agent.py -v # weather swap + LTA
pytest tests/test_agents/test_planning_agent.py -v   # planning logic
```

All tests must pass. Then manually verify:
- `GET /places/curated` → 200, returns 499 items
- `GET /places/search?q=gardens` → returns Supertree Grove, Flower Dome, Cloud Forest entries
- `GET /places/search?q=hawker` → returns food/beverage places via `search_keywords`
- Server startup has no `RuntimeError` from missing required keys
