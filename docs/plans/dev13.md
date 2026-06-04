# Dev 13: UX Improvements — Map, GPS, Trip Flow

Implements all 8 items from `To_fix.md`.

---

## Scope

| # | Item | Files |
|---|------|-------|
| 1 | Remove redundant Start buttons (DayView) | `Trip.jsx` |
| 2 | Fix polyline endpoints to snap to place markers | `TripMap.jsx` |
| 3 | Numbered markers + dim other-day markers on map | `TripMap.jsx`, `Trip.jsx` |
| 4 | Trip mode: hide visited, dim future places on map | `Trip.jsx`, `TripMap.jsx` |
| 5 | Remove instructions UI from LegCard | `Trip.jsx` |
| 6 | Auto-arrive when within 100 m of destination | `Trip.jsx`, `tripUtils.js` |
| 7 | Continue button after arrived (before advancing leg) | `Trip.jsx` |
| 8 | Live GPS polyline tracking (WALK/CYCLE); dot-on-route for Transit | `Trip.jsx`, `TripMap.jsx` |

---

## Task Breakdown

### Task 1 — Remove redundant Start button in DayView
**File:** `frontend/src/pages/Trip.jsx`

The `DayView` component header (lines 597–611) contains a "Start" button alongside "Add place".
This is redundant — the canonical start point is the "Start Trip" button in `Overview`.

**Change:** Remove the `<button … Start</button>` block (lines 604–610) from `DayView`'s header. Keep "Add place". The `onStart` prop and `startDay()` function remain in use only by `Overview`'s `onStartTrip` callback.

---

### Task 2 — Fix polyline snapping to place markers
**File:** `frontend/src/components/map/TripMap.jsx`

**Problem:** `decodeLegPositions()` returns the decoded geometry verbatim. The API route geometry often starts/ends a few meters away from the stored place coordinates, causing the polyline to appear to begin/end in open space rather than on the marker dot.

**Change:** In `decodeLegPositions`, after decoding, replace the first and last decoded points with `[from.lat, from.lng]` and `[to.lat, to.lng]` respectively:

```js
function decodeLegPositions(leg, from, to) {
  // ... decode loop (unchanged) ...
  if (decoded.length >= 2) {
    decoded[0] = [from.lat, from.lng]
    decoded[decoded.length - 1] = [to.lat, to.lng]
    return decoded
  }
  return [[from.lat, from.lng], [to.lat, to.lng]]
}
```

This ensures every polyline originates and terminates exactly at the marker dots without distorting intermediate shape.

---

### Task 3 — Numbered markers + dim other-day markers
**Files:** `Trip.jsx`, `TripMap.jsx`

#### 3a — Compute per-place metadata in Trip.jsx

When `activeTab` is a day tab (`day-N`), build two structures and pass to `TripMap`:
- `placeSequences`: `{ [placeId]: number }` — 1-based sequence number within the place's own day.
- `activeDayPlaceIds`: `Set<string>` — place IDs belonging to the currently selected day.

Logic:
```js
const placeSequences = useMemo(() => {
  const map = {}
  for (const day of trip?.days ?? []) {
    const places = timelineForDay(day, allPlacesById)
      .filter(i => i.type === 'place')
      .map(i => i.place)
    places.forEach((p, idx) => { map[p.id] = idx + 1 })
  }
  return map
}, [trip, allPlacesById])

const activeDayPlaceIds = useMemo(() => {
  if (!activeTab.startsWith('day-') || !currentDay) return null  // null = show all equal
  const ids = new Set(
    timelineForDay(currentDay, allPlacesById)
      .filter(i => i.type === 'place')
      .map(i => i.place.id)
  )
  return ids
}, [activeTab, currentDay, allPlacesById])
```

Pass both to `<TripMap … placeSequences={placeSequences} activeDayPlaceIds={activeDayPlaceIds} />`.

#### 3b — Numbered + dimmed icons in TripMap.jsx

Replace `categoryIcon` with a `placeIcon(category, num, dimmed)` that renders:
- A numbered circle showing `num` (or just the color dot if `num` is undefined)
- If `dimmed = true`: CSS opacity 0.5 on the icon HTML

```js
function placeIcon(category, num, dimmed = false) {
  const color = CATEGORY_DOT_COLORS[category?.toLowerCase()] ?? '#64748b'
  const label = num != null ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff">${num}</span>` : ''
  const opacity = dimmed ? 'opacity:0.5;' : ''
  return L.divIcon({
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28);position:relative;${opacity}">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    className: '',
  })
}
```

In the marker render:
```jsx
<Marker
  key={place.id}
  position={[place.lat, place.lng]}
  icon={placeIcon(
    place.category,
    placeSequences?.[place.id],
    activeDayPlaceIds != null && !activeDayPlaceIds.has(place.id)
  )}
>
```

---

### Task 4 — Trip mode: hide visited, dim future places
**Files:** `Trip.jsx`, `TripMap.jsx`

#### 4a — Compute place status in Trip.jsx

Replace current `mapPlaces` logic with:

```js
const mapPlaces = useMemo(() => {
  if (!trip) return []
  if (tripStarted && currentDay) {
    const legs = currentDay.legs ?? []
    // Places whose leg has already been completed → hide
    const visitedIds = new Set(
      legs.slice(0, activeLegIndex).map(l => l.from_place_id)
    )
    // Active leg's from and to → full opacity
    const activeIds = activeLeg
      ? new Set([activeLeg.from_place_id, activeLeg.to_place_id])
      : new Set()

    return (trip.places ?? [])
      .filter(p => !visitedIds.has(p.id))
      .map(p => ({ ...p, _dim: !activeIds.has(p.id) }))
  }
  return trip.places ?? []
}, [trip, tripStarted, currentDay, activeLeg, activeLegIndex])
```

#### 4b — Render dimmed places in TripMap

`placeIcon` already supports `dimmed`. Update the marker render call to use `place._dim ?? false` when `tripStarted` (passed as a new prop).

---

### Task 5 — Remove instructions UI from LegCard
**File:** `Trip.jsx`

In `LegCard` (inside the `tripStarted &&` block, lines ~304–388):

**Remove:**
- The "instructions" button (`{leg.instructions?.length} instructions` / `No instructions`)
- The entire `leg.instructions?.length > 0` block that renders the `<ol>` list

**Keep:**
- `sub_legs` transit details block
- `BusArrivalPanel`
- `compare` mode comparison grid
- "Compare modes" button

---

### Task 6 — Auto-arrive at 100 m radius
**Files:** `tripUtils.js`, `Trip.jsx`

#### 6a — Add haversine util to `tripUtils.js`

```js
export function haversineMeters(a, b) {
  const R = 6371000
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}
```

#### 6b — Auto-arrive effect in Trip.jsx

```js
const autoArrivedRef = useRef(false)

useEffect(() => {
  if (!tripStarted || !position || !activeTo || autoArrivedRef.current) return
  const dist = haversineMeters(position, { lat: activeTo.lat, lng: activeTo.lng })
  if (dist <= 100) {
    autoArrivedRef.current = true
    markArrived()   // new function — see Task 7
  }
}, [position, tripStarted, activeTo])
```

Reset `autoArrivedRef.current = false` in `advanceLeg()` (Task 7) so it fires again for the next destination.

---

### Task 7 — Continue button after arrived
**File:** `Trip.jsx`

**New state:** `const [arrivedPending, setArrivedPending] = useState(false)`

**Split `arrive()` into two:**

```js
// Called by both auto-arrive (Task 6) and manual "Arrived" button
const markArrived = () => setArrivedPending(true)

// Called only when user clicks "Continue"
const advanceLeg = () => {
  autoArrivedRef.current = false
  setArrivedPending(false)
  const day = trip?.days?.find(d => d.day === selectedDay)
  if (!day) return
  if (activeLegIndex < (day.legs?.length ?? 0) - 1) {
    setActiveLegIndex(v => v + 1)
    return
  }
  const nextDay = trip.days.find(d => d.day === selectedDay + 1)
  if (nextDay) {
    setSelectedDay(nextDay.day)
    setActiveLegIndex(0)
    setActiveTab(`day-${nextDay.day}`)
  } else {
    setTripStarted(false)
    setActiveTab('summary')
  }
}
```

**Update `DayView`:** Change `onArrive` prop to `onMarkArrived`. Replace the "Arrived" button with `onClick={onMarkArrived}`.

**Show Continue banner:** In the live mode banner area (or over the map panel), when `arrivedPending`:

```jsx
{arrivedPending && (
  <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-800">
    <CheckCircle size={15} className="text-emerald-600" />
    You've arrived! Ready for the next leg?
    <button
      onClick={advanceLeg}
      className="ml-auto rounded-md bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-500"
    >
      Continue →
    </button>
  </div>
)}
```

---

### Task 8 — Live GPS polyline tracking
**Files:** `Trip.jsx`, `TripMap.jsx`

#### 8a — Track GPS path in Trip.jsx

```js
const [trackingPath, setTrackingPath] = useState([])
const lastTrackPointRef = useRef(null)

useEffect(() => {
  if (!tripStarted || !position) return
  if (!lastTrackPointRef.current) {
    lastTrackPointRef.current = position
    setTrackingPath([[position.lat, position.lng]])
    return
  }
  const dist = haversineMeters(lastTrackPointRef.current, position)
  if (dist >= 30) {
    lastTrackPointRef.current = position
    setTrackingPath(prev => [...prev, [position.lat, position.lng]])
  }
}, [position, tripStarted])
```

Reset on leg advance: `setTrackingPath([])` + `lastTrackPointRef.current = null` in `advanceLeg()`.

#### 8b — Determine tracking mode

```js
const activeLegMode = activeLeg ? normalizeTransportMode(activeLeg.transport_mode) : null
const isWalkOrCycle = activeLegMode === 'WALK' || activeLegMode === 'CYCLE'
```

Pass to TripMap: `trackingPath={isWalkOrCycle ? trackingPath : []}`.

For Transit (BUS/MRT/LRT): don't pass tracking path, but pass `userPosition` normally so the GPS dot is visible on the route.

#### 8c — Render tracking polyline in TripMap.jsx

Add prop `trackingPath = []` to `TripMap`.

Render a live tracking polyline (Google Maps–style blue trail) above all route layers:
```jsx
{trackingPath.length >= 2 && (
  <Polyline
    positions={trackingPath}
    color="#2563eb"
    weight={5}
    opacity={0.9}
    lineCap="round"
    lineJoin="round"
  />
)}
```

#### 8d — Transit off-route warning (bonus)

When `activeLegMode` is BUS/MRT/LRT and `tripStarted`, check distance from `position` to the nearest point on `activeLeg`'s route geometry. If > 50 m, show a subtle inline warning:
> "You may be off the planned transit route."

This reuses the existing `projectMeters`/`trimPositionsFromUser` geometry utilities.

---

## File Summary

| File | Tasks |
|------|-------|
| `frontend/src/pages/Trip.jsx` | 1, 3a, 4a, 5, 6b, 7, 8a–b |
| `frontend/src/components/map/TripMap.jsx` | 2, 3b, 4b, 8c–d |
| `frontend/src/lib/tripUtils.js` | 6a |

---

## Implementation Order

1. Task 5 (remove instructions) — isolated, no dependencies  
2. Task 1 (remove Start button) — isolated  
3. Task 2 (polyline snapping) — isolated map fix  
4. Task 6a (haversine util) — prerequisite for 6b, 8d  
5. Tasks 3a + 3b together (numbered markers + dimming)  
6. Tasks 4a + 4b together (trip mode opacity)  
7. Tasks 6b + 7 together (auto-arrive + continue button)  
8. Tasks 8a–d together (GPS tracking polyline)
