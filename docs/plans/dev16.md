# Dev 16 — Grab (Taxi) as a Real Transport Mode

**Status:** Pending approval  
**Scope:** Add Grab/taxi as a fully-integrated transport mode with estimated fare, deeplink launch, and smart auto-recommendation for long routes without viable transit.

---

## Background & Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Mode type | Real mode (updates leg) + opens deeplink | User wants `transport_mode=GRAB` persisted in plan so it reflects their choice |
| Fare calculation | Backend estimation (no Grab API) | Backend computes once, stores in `alternatives`; frontend just reads |
| Architecture | Backend injects GRAB into `_fetch_all_alternatives` | Lets planning agent recommend Grab during initial planning |
| Deeplink generation | Frontend only | Pure URL construction from lat/lng — no backend needed |
| Surge pricing | Not modelled — always `M_surge = 1.0` | Cannot know realtime; shown with "Estimated · Excl. surge & ERP" badge |
| UI placement | Dropdown Change (mode picker) + Compare modes panel | Per user request |
| Pickup during live navigation | Current GPS position if available, else `from_place` coords | Per user request |

---

## Fare Estimation Formula

Derived from Singapore 2026 Grab pricing. Uses only variables available in the system.

```
road_km       = distance_km × 1.3          # road distance ≈ 1.3× haversine
road_min      = (road_km / 30) × 60        # avg speed 30 km/h in city

F_base        = 3.00 + (road_km × 0.70) + (road_min × 0.16)
F_trip        = max(5.80, F_base)          # minimum fare floor
S_fixed       = 1.70                       # platform fee (1.20) + fuel surcharge (0.50)
S_location    = from from_place.name:
                  "changi"              → +6.00 SGD
                  "sentosa"            → +3.00 SGD
                  "gardens by the bay" → +3.00 SGD
                  "marina bay cruise"  → +3.00 SGD
                  (else)               → 0.00 SGD

F_final       = F_trip + S_fixed + S_location
duration_grab = road_min (rounded to nearest minute)
```

> Displayed with badge: **Estimated · Excl. surge & ERP**  
> `is_estimated = True` always for GRAB.

---

## Grab Deeplink Format

```
grab://open?screenType=BOOKING
  &sourceAddress={from_name}
  &sourceLatitude={from_lat}
  &sourceLongitude={from_lng}
  &destinationAddress={to_name}
  &destinationLatitude={to_lat}
  &destinationLongitude={to_lng}
```

- **Live navigation:** replace `source*` fields with current GPS position when available.  
- **Web fallback** (no Grab app): open `https://www.grab.com/sg/` — Grab has no booking deeplink for desktop web.

---

## Auto-Recommendation Logic

In the planning agent's route scoring, when the best mode resolves to `WALK` and `distance_km > 2.0`, the system currently tries PT fallback. We extend this to also try GRAB:

```
if best_key == "WALK" and distance_km >= 2.0:
    pt_fallback = first of ("METRO", "BUS") in alts
    if pt_fallback → use pt_fallback   (existing logic, unchanged)
    else           → use "GRAB"        (new: no viable transit → Grab recommended)
```

This means a leg from, say, Changi → Marina Bay Sands that has no good PT option gets `transport_mode=GRAB` as its default assignment in the plan.

---

## Impact Analysis (pre-implementation)

| Symbol | Risk | Notes |
|--------|------|-------|
| `TransportMode` (models/trip.py) | LOW | Adding new literal — all existing comparisons still match |
| `_fetch_all_alternatives` | LOW | Additive — injects one synthetic GRAB dict; all callers receive a superset |
| Route scoring WALK guard | LOW | Guard condition extended, existing METRO/BUS fallback path unchanged |
| `allModesWithAvailability` (transport.js) | LOW | GRAB now appears in `alternatives` → rendered automatically |
| `LegCard` mode picker (Trip.jsx) | LOW | One extra `if mode === "GRAB"` branch to open deeplink after `updateLeg` |
| `switch_leg_mode` (planning_agent.py) | LOW | GRAB alt stored in `alternatives` dict — existing cache-hit path handles it |

---

## Files Changed

### 1. `backend/app/models/trip.py`

Add `"GRAB"` to the `TransportMode` literal / enum so Pydantic accepts it in `LegResponse`.

**Change:** Add `"GRAB"` to `TransportMode`.

---

### 2. `backend/app/agents/planning_agent.py`

**A — Add fare estimator** (new private function, ~20 lines):

```python
_GRAB_LOCATION_SURCHARGES = {
    "changi":              6.00,
    "sentosa":             3.00,
    "gardens by the bay": 3.00,
    "marina bay cruise":  3.00,
}

def _estimate_grab(distance_km: float, from_place_name: str = "") -> dict:
    """Synthetic GRAB route dict — estimated fare only, no geometry."""
    road_km  = distance_km * 1.3
    road_min = (road_km / 30.0) * 60.0
    f_base   = 3.00 + (road_km * 0.70) + (road_min * 0.16)
    f_trip   = max(5.80, f_base)
    s_loc    = next(
        (v for k, v in _GRAB_LOCATION_SURCHARGES.items()
         if k in from_place_name.lower()),
        0.0,
    )
    fare = round(f_trip + 1.70 + s_loc, 2)
    return {
        "duration_minutes": round(road_min),
        "fare_sgd":         fare,
        "is_estimated":     True,
        "geometry":         None,
        "geometries":       [],
        "instructions":     [],
        "distance_km":      round(road_km, 2),
        "sub_legs":         [],
        "legs":             [],
    }
```

**B — Inject GRAB into `_fetch_all_alternatives`**:

After building the `result` dict (after WALK/CYCLE entries), append:

```python
# GRAB — always available; estimated fare based on haversine road estimate.
dist_km = _haversine_km(from_p["lat"], from_p["lng"], to_p["lat"], to_p["lng"])
result["GRAB"] = _estimate_grab(dist_km, from_place_name=from_p.get("name", ""))
```

`_fetch_all_alternatives` already receives `from_p` dict which includes `"name"` in the planning flow. Verify this is passed correctly wherever the function is called.

**C — Extend WALK > 2km guard in `plan_trip`**:

```python
# Current (both occurrences — hotel→first and place→place legs):
if dist_km >= 1.5 and best_key == "WALK":
    pt_key = next((m for m in ("METRO", "BUS") if m in alts), None)
    if pt_key:
        best_key = pt_key

# New:
if dist_km >= 1.5 and best_key == "WALK":
    pt_key = next((m for m in ("METRO", "BUS") if m in alts), None)
    if pt_key:
        best_key = pt_key
    elif dist_km >= 2.0 and "GRAB" in alts:
        best_key = "GRAB"   # no viable transit → recommend Grab
```

> The `dist_km >= 2.0` threshold is the user's stated rule. The `>= 1.5` guard for PT is kept intact.

---

### 3. `frontend/src/lib/transport.js`

**A — Add GRAB to constants:**

```js
import { Bus, Bike, Footprints, Route, Train, Car } from 'lucide-react'

export const TRANSPORT_OPTIONS = [
  { mode: 'METRO', label: 'MRT',   Icon: Train },
  { mode: 'BUS',   label: 'Bus',   Icon: Bus },
  { mode: 'WALK',  label: 'Walk',  Icon: Footprints },
  { mode: 'CYCLE', label: 'Cycle', Icon: Bike },
  { mode: 'GRAB',  label: 'Grab',  Icon: Car },
]

// In TRANSPORT_META:
GRAB: { label: 'Grab', Icon: Car, tone: 'bg-green-50 text-green-700 border-green-100', color: '#00b14f' },
```

Grab brand color `#00b14f` (Grab green).

**B — `normalizeTransportMode`:** add `if (upper === 'GRAB') return 'GRAB'` before the fallback return.

---

### 4. `frontend/src/lib/grab.js` *(new file)*

```js
/**
 * Build a Grab deeplink URL.
 * Opens the Grab app with pre-filled pickup and dropoff.
 * Falls back to the Grab SG website when the app is not installed (web).
 */
export function buildGrabDeeplink({ fromLat, fromLng, fromName, toLat, toLng, toName }) {
  const params = new URLSearchParams({
    screenType:           'BOOKING',
    sourceAddress:        fromName,
    sourceLatitude:       String(fromLat),
    sourceLongitude:      String(fromLng),
    destinationAddress:   toName,
    destinationLatitude:  String(toLat),
    destinationLongitude: String(toLng),
  })
  return `grab://open?${params.toString()}`
}

export function openGrab(params) {
  const deeplink = buildGrabDeeplink(params)
  // Attempt app deeplink; browser will fall back to app store if not installed
  window.location.href = deeplink
}
```

No web fallback URL needed — Grab's mobile deeplink handles fallback to the app store automatically.

---

### 5. `frontend/src/pages/Trip.jsx`

**A — Import `openGrab` from grab.js.**

**B — `changeMode` handler in `LegCard`:** after calling `api.updateLeg`, if the new mode is `GRAB`, call `openGrab` with the leg's from/to coords:

```js
async function changeMode(newMode) {
  setSavingMode(true)
  try {
    const result = await api.updateLeg(tripId, leg.id, { transport_mode: newMode })
    onUpdated(result)
    if (newMode === 'GRAB') {
      const fromPlace = placesById[leg.from_place_id]
      const toPlace   = placesById[leg.to_place_id]
      if (fromPlace && toPlace) {
        openGrab({
          fromLat:  fromPlace.lat,  fromLng: fromPlace.lng,  fromName: fromPlace.name,
          toLat:    toPlace.lat,    toLng:   toPlace.lng,    toName:   toPlace.name,
        })
      }
    }
  } finally {
    setSavingMode(false)
  }
}
```

**C — Live navigation pickup:** in the `LegCard` Arrived section, when user is on an active leg and presses a Grab button (see D), use GPS coords if available:

```js
const grabFrom = (tripStarted && position)
  ? { lat: position.lat, lng: position.lng, name: 'Your location' }
  : { lat: fromPlace?.lat, lng: fromPlace?.lng, name: fromPlace?.name }
```

**D — "Open Grab" button on active leg (Compare modes panel):**

Inside the `tripStarted` block where Compare modes results are shown, add a Grab row:

```jsx
{/* Grab row — always available */}
<div className="flex items-center justify-between rounded-md border border-green-100 bg-green-50 p-3">
  <div className="flex items-center gap-2">
    <Car size={14} className="text-green-700" />
    <span className="text-[13px] font-bold text-green-700">Grab</span>
    <span className="text-[11px] text-green-500">Estimated · Excl. surge & ERP</span>
  </div>
  <button
    onClick={() => openGrab({ fromLat: grabFrom.lat, fromLng: grabFrom.lng, fromName: grabFrom.name,
                              toLat: toPlace?.lat, toLng: toPlace?.lng, toName: toPlace?.name })}
    className="rounded-md bg-green-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-green-500"
  >
    Open Grab
  </button>
</div>
```

**E — Estimated badge for GRAB legs:** GRAB legs already have `is_estimated=True` from the backend, so the existing `{leg.is_estimated && <span>Estimated</span>}` badge renders automatically. Add a second sub-label "Excl. surge & ERP" next to it:

```jsx
{leg.is_estimated && normalizeTransportMode(leg.transport_mode) === 'GRAB' && (
  <span className="rounded-md bg-amber-50 px-2 py-1 text-[12px] font-bold text-amber-700">
    Estimated · Excl. surge & ERP
  </span>
)}
{leg.is_estimated && normalizeTransportMode(leg.transport_mode) !== 'GRAB' && (
  <span className="rounded-md bg-amber-50 px-2 py-1 text-[12px] font-bold text-amber-700">Estimated</span>
)}
```

---

## Data Flow (end-to-end)

```
Planning:
  _fetch_all_alternatives(A, B)
    → calls OneMap for METRO/BUS/WALK/CYCLE in parallel
    → computes _estimate_grab(haversine(A,B), A.name)
    → returns {METRO: ..., BUS: ..., WALK: ..., CYCLE: ..., GRAB: ...}
  score_alternatives(alts) → picks best_key
  if best_key == WALK and distance > 2km and no PT → best_key = GRAB
  LegResponse(..., alternatives={..., GRAB: AlternativeRoute(...)})

User opens mode picker → sees GRAB in dropdown
User selects GRAB:
  PATCH /trips/:id/legs/:leg_id  { transport_mode: "GRAB" }
    → switch_leg_mode("GRAB", leg, plan) → cache hit → updates leg
  frontend opens grab:// deeplink
  leg now has transport_mode=GRAB, is_estimated=True in DB + _trip_store

Live navigation, Compare modes:
  "Open Grab" button uses GPS lat/lng (if available) as pickup
```

---

## Out of Scope

- Grab fare calculation accounting for real-time surge (`M_surge` ≠ 1.0)
- ERP surcharge (`S_ERP`) — not modelled
- Grab Business / GrabShare / GrabXL variants — only JustGrab/GrabCar formula applied
- Grab web booking integration (no public web deeplink for booking)
- Storing Grab booking reference in trip

---

## Test Cases to Add

| Test | File | Assertion |
|------|------|-----------|
| `_estimate_grab` with normal place returns fare ≥ 5.80 | `tests/test_agents/test_planning_agent.py` | `fare >= 5.80` |
| `_estimate_grab` with "Changi" in name adds +6.00 | same | `fare == base + 1.70 + 6.00` |
| `_fetch_all_alternatives` result always contains GRAB key | same | `"GRAB" in alts` |
| WALK > 2km with no PT → planning assigns GRAB | same | `leg.transport_mode == "GRAB"` |
| `buildGrabDeeplink` produces correct URL format | `frontend/src/__tests__/lib/grab.test.js` | URL starts with `grab://open?screenType=BOOKING` |
| Mode picker shows GRAB as available when `alternatives` has GRAB | `Trip.test.jsx` | button with name `/Grab/i` in dropdown |
