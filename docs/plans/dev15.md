# Dev 15 — GAP-9, GAP-11, GAP-15 Fixes

**Status:** Pending approval  
**Scope:** 3 targeted fixes — adaptation flow polish, GPS UX, fallback leg integrity

---

## Pre-read: Current state (verified by code inspection)

### GAP-15 — Adaptation UI is already implemented
`AlertBanner.jsx` (dev13 pre-existing changes) already has the full Preview → Accept flow:

| Component | Flow |
|-----------|------|
| `WeatherAlertBanner` | "Preview swap" → `api.adaptTrip()` → shows changes + delta pills → "Accept swap" → `api.acceptSwap()` → `onAdapted()` |
| `AlertBanner` (transit) | "Preview swap" → `api.adaptTrip()` → shows changes + delta pills → "Accept" → `api.acceptSwap()` → `onAdapted()` |

Both paths call `onDismiss(alert.id)` after accept, and `onAdapted` = `refresh` in Trip.jsx.  
Backend: `/accept-swap` (line 692) returns `updated_trip` and calls `commit_adaptation()` → DB persist ✅

**Two remaining issues:**
1. `handleAccept` ignores the `updated_trip` returned by `api.acceptSwap()` → calls `onAdapted()` with no args → triggers an extra `GET /trips/{id}` round-trip
2. `test_adapt_trip_weather_swap_outdoor_to_indoor` fails (root cause: mock bug, see Fix B below)

---

## Fix A — GAP-11: GPS Unavailable Banner

**File:** `frontend/src/pages/Trip.jsx`  
**Risk:** LOW — additive render only

### Problem

```js
// Line 636 — error is destructured but not used when tripStarted=true
const { position } = useGeolocation()
//      ↑ error is never destructured
```

When `tripStarted=true` and GPS is off (or permission denied), auto-arrive silently stops working. User has no feedback.

### Change

**Step 1** — Destructure `error` from `useGeolocation`:
```js
// Before:
const { position } = useGeolocation()

// After:
const { position, error: geoError } = useGeolocation()
```
Note: renamed to `geoError` to avoid shadowing the `error` prop from `useTrip`.

**Step 2** — Add GPS unavailable banner in the banner section (the `<section>` around line 1049 that already renders `arrivedPending`, `todayBanner`, alerts, etc.):

Add this block **after** the `arrivedPending` banner and **before** `todayBanner`:

```jsx
{tripStarted && geoError && (
  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
    <MapPin size={15} className="shrink-0" />
    GPS unavailable — auto-arrive is off. Tap{' '}
    <span className="font-bold">Arrived</span> manually when you reach each stop.
  </div>
)}
```

**Step 3** — Update the banner section condition to include `geoError`:
```jsx
// Before:
{(isOffline || todayBanner || optimizeMsg || arrivedPending || alerts.length > 0 || uiWarning) && (

// After:
{(isOffline || todayBanner || optimizeMsg || arrivedPending || (tripStarted && geoError) || alerts.length > 0 || uiWarning) && (
```

### Verify
- `MapPin` is already imported in Trip.jsx ✓
- `error` is already a property returned by `useGeolocation` ✓
- Banner only shows when `tripStarted` — no noise in planning mode ✓

---

## Fix B — GAP-9: `_recalculate_leg` Fallback Integrity

**Files:**
- `backend/app/agents/adaptation_agent.py` — `_recalculate_leg()` fallback return
- `backend/tests/test_agents/test_adaptation_agent.py` — `_make_supabase_mock()` + failing test

**Risk:** LOW (backend-only, additive fields in fallback)

### Problem 1 — Missing fields in fallback LegResponse

**File:** `adaptation_agent.py`, lines 660–668

```python
# Current fallback — missing geometry, sub_legs, first_bus_stop_code, etc.
return LegResponse(
    id=original.id,
    from_place_id=new_from_id,
    to_place_id=new_to_id,
    transport_mode=original.transport_mode,
    duration_minutes=original.duration_minutes,
    cost_sgd=original.cost_sgd,
    is_estimated=True,
)
```

When OneMap fails during a weather swap, the fallback leg is missing:
- `first_bus_stop_code` → BusArrivalPanel disappears silently for BUS legs
- `geometry`, `geometries`, `instructions` → map polyline and turn-by-turn gone
- `distance_km` → distance badge disappears
- `sub_legs` → transit detail cards disappear

**Fix:** Copy all non-routing fields from `original`:

```python
return LegResponse(
    id=original.id,
    from_place_id=new_from_id,
    to_place_id=new_to_id,
    transport_mode=original.transport_mode,
    duration_minutes=original.duration_minutes,
    cost_sgd=original.cost_sgd,
    is_estimated=True,
    # Preserve display fields from the original leg — routing geometry is still
    # approximately valid (same general area, even if from/to slightly changed).
    first_bus_stop_code=original.first_bus_stop_code,
    geometry=original.geometry,
    geometries=original.geometries or [],
    instructions=original.instructions or [],
    distance_km=original.distance_km,
    sub_legs=original.sub_legs or [],
)
```

### Problem 2 — Test mock root cause (failing test fix)

**File:** `tests/test_agents/test_adaptation_agent.py`

**Root cause trace:**
1. `_apply_weather_swap` calls `_nearest_indoor(lat, lng, exclude_ids)`
2. `_nearest_indoor` tries Supabase PostGIS RPC first when `supabase` is not None:
   ```python
   result = supabase.table("places").rpc("find_nearest_indoor", {...}).execute()
   return result.data[0] if result.data else None
   ```
3. `_make_supabase_mock` sets up `"places"` table as the `else` branch → `t.execute.return_value = MagicMock(data=[])`
4. BUT: `t.rpc(...)` is a separate auto-generated MagicMock (not `t` itself) → `t.rpc(...).execute()` returns a **new** auto-MagicMock where `.data` is also a MagicMock (truthy!)
5. `result.data[0]` = `MagicMock[0]` = another MagicMock → returned as the "indoor place"
6. This MagicMock leaks into `swap_map`, then into `new_from_id`, then into `LegResponse(from_place_id=MagicMock)` → Pydantic ValidationError

**Fix in `_make_supabase_mock`:** Add explicit handling for the `"places"` table to make its RPC return empty data, triggering the haversine fallback:

```python
elif name == "places":
    # _nearest_indoor tries PostGIS RPC first; empty data forces haversine fallback
    t.rpc.return_value.execute.return_value = MagicMock(data=[])
    t.execute.return_value = MagicMock(data=[])
```

After this fix, `_nearest_indoor` falls back to the haversine loop over `get_all_places()` (static JSON), finds a real indoor place, and the weather swap succeeds with proper string IDs.

**Expected test outcome after fix:**
```
test_adapt_trip_weather_swap_outdoor_to_indoor  PASSED
```
The test already has the correct assertions (adapted=True, gardens-by-the-bay swapped out, leg.is_estimated=False).

---

## Fix C — GAP-15: `handleAccept` Uses Preloaded Response

**File:** `frontend/src/components/adaptation/AlertBanner.jsx`  
**Risk:** LOW — only changes how `onAdapted` is called

### Problem

`api.acceptSwap()` already returns `updated_trip` (full TripPlan) from the backend.  
But both `WeatherAlertBanner` and `AlertBanner` ignore it:

```js
// Current — ignores returned updated_trip, triggers extra GET /trips/{id}
await api.acceptSwap(tripId, { alert_id: alert.id, session_id: getSessionId() })
if (onAdapted) await onAdapted()   // ← called without args → full re-fetch
```

`useTrip`'s `refresh(preloaded)` accepts a preloaded arg that skips the network round-trip:
```js
const refresh = useCallback((preloaded) => {
  if (preloaded && Array.isArray(preloaded.days)) {
    setTrip(preloaded)                              // immediate update
    api.cacheTripData(tripId, preloaded, userId)    // update cache
    return Promise.resolve(preloaded)               // no fetch
  }
  return api.getTrip(tripId).then(...)              // fallback fetch
}, [tripId])
```

### Change

In **both** `WeatherAlertBanner.handleAccept` and `AlertBanner.handleAccept`:

```js
// Before:
await api.acceptSwap(tripId, { alert_id: alert.id, session_id: getSessionId() })
if (onAdapted) await onAdapted()

// After:
const updatedTrip = await api.acceptSwap(tripId, { alert_id: alert.id, session_id: getSessionId() })
if (onAdapted) await onAdapted(updatedTrip)
```

This passes the returned `TripPlan` directly into `refresh(preloaded)`, eliminating the extra GET request and making the UI update instant.

### Verify

- `api.acceptSwap` returns the full JSON body from `POST /accept-swap`, which is `updated_trip: TripPlan` ✓
- `refresh(preloaded)` checks `preloaded && Array.isArray(preloaded.days)` — safe even if backend returns unexpected data ✓
- No change to error handling or dismiss logic ✓

---

## Execution Order

```
Fix B backend (adaptation_agent.py)      — no deps
Fix B test (_make_supabase_mock)         — after Fix B backend
Fix A (Trip.jsx GPS banner)              — no deps
Fix C (AlertBanner.jsx)                  — no deps

All 4 changes are independent. Implement in any order.
```

---

## Files Touched

| File | Fix |
|------|-----|
| `frontend/src/pages/Trip.jsx` | Fix A |
| `backend/app/agents/adaptation_agent.py` | Fix B (backend) |
| `backend/tests/test_agents/test_adaptation_agent.py` | Fix B (test) |
| `frontend/src/components/adaptation/AlertBanner.jsx` | Fix C |

---

## Test Plan

### Backend
```
cd backend && pytest tests/test_agents/test_adaptation_agent.py -v
```
Expected: `test_adapt_trip_weather_swap_outdoor_to_indoor` changes from FAILED → PASSED.  
All other adaptation tests remain green.

### Frontend build
```
cd frontend && npm run build
```
Expected: clean build, no TypeScript/ESLint errors.

### Manual check (adaptation flow)
1. Open a trip with an active weather/train alert
2. Click "Preview swap" → proposal renders with changes list + delta pills
3. Click "Accept swap" / "Accept" → trip updates **immediately** without a loading flash (preloaded data)
4. Alert dismisses; updated legs visible in DayView

### Manual check (GPS banner)
1. Open an active trip (tripStarted=true)
2. Revoke location permission in browser settings
3. Reload page → GPS unavailable banner should appear in the banner section
4. Banner shows: "GPS unavailable — auto-arrive is off. Tap Arrived manually..."
5. Banner does NOT appear in planning mode (tripStarted=false)
