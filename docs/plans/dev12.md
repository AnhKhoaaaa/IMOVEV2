# Plan: dev12 — To_fix.md v2 (7 UX Issues)

## Issues

From `To_fix.md`:
1. Active leg giao diện tràn màn hình → bố cục lại thành vertical stack trong 1/2 trái
2. LTA realtime hiển thị tất cả bus → chỉ hiện đúng tuyến liên quan + thêm tiêu đề cột
3. Chặn MRT có dùng bus sub_leg → cũng hiện LTA realtime cho tuyến đó
4. Hiển thị thời gian tới/đi dự tính tại mỗi điểm (cả plan lẫn live)
5. Tab Overview: thêm thời gian bắt đầu/kết thúc ngày và tổng thời gian di chuyển
6. Reorder địa điểm: không gọi API ngay, chỉ cập nhật local → bấm "Recalculate Route" mới gọi
7. Ẩn nút Optimize khi đã start trip

---

## Phân tích hiện trạng

### Issue #1 — Active leg overflow
`DayView` (Trip.jsx ~L468) khi `tripStarted && activeLeg`:
```jsx
<div className="grid grid-cols-[1fr_1.2fr_1fr] gap-4">
  <PlaceCard place={activeFrom} />
  <LegCard ... />
  <PlaceCard place={activeTo} ... />
</div>
```
Container trái là `minmax(520px, 0.9fr)` → mỗi cột ~170px, `PlaceCard` cần min ~300px → overflow.

### Issue #2 — LTA không filter
`LegCard` (Trip.jsx ~L318):
```jsx
<BusArrivalPanel stopCode={leg.first_bus_stop_code} />
```
Không truyền `serviceFilter` → hiện ALL services tại stop đó.

`BusArrivalPanel` không có header row → "131 6 min 13 min" không rõ nghĩa.

### Issue #3 — MRT + bus sub_leg
`PTSubLeg` model có `from_stop_code`, `to_stop_code`, `route` fields.
`LegCard` chỉ render `BusArrivalPanel` khi `normalizeTransportMode(leg.transport_mode) === 'BUS'` — bỏ sót MRT legs có BUS sub_leg.

### Issue #4 — Timestamps
Không có `start_time` trong `savedMeta`. `TripSetupModal` không có field này.
Cần: thêm `startTime` field (default "09:00") vào TripSetupModal + helper `computeTimeline(day, placesById, startTime)`.

### Issue #5 — Overview day cards
`OverviewTab` day cards chỉ hiện "X stops · Xh Xm · S$X.XX". Không có start/end time, không tách transit vs dwell.

### Issue #6 — Reorder gọi API mỗi lần
`reorder()` ở Trip.jsx L700 gọi `mutate(() => api.reorderPlaces(...))` mỗi lần bấm Up/Down.
Backend `reorderPlaces` gọi `planning_agent.plan_trip` → rất nặng cho mỗi lần click.

### Issue #7 — Optimize button khi started
`Overview` component (Trip.jsx ~L352) luôn hiện nút Optimize, không nhận `tripStarted` prop.

---

## Implementation Plan

### Step 1 — Issue #7: Ẩn Optimize khi started (đơn giản nhất)

**`Trip.jsx`** — truyền thêm prop `tripStarted` vào `Overview`:
```jsx
<Overview
  ...
  tripStarted={tripStarted}
/>
```

**`Trip.jsx` — `Overview` component** — thêm `tripStarted` param + wrap nút Optimize:
```jsx
function Overview({ ..., tripStarted }) {
  return (
    ...
    {!tripStarted && (
      <button onClick={onOptimize}>Optimise</button>
    )}
    {onStartTrip && !tripStarted && (
      <button onClick={onStartTrip}>Start Trip</button>
    )}
    ...
  )
}
```

---

### Step 2 — Issue #1: Redesign active leg layout

**`Trip.jsx` — `DayView` active state** (L468-498):

Thay `grid-cols-[1fr_1.2fr_1fr]` bằng vertical stack. Dùng compact place header thay vì full `PlaceCard`:

```jsx
if (tripStarted && activeLeg) {
  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-[20px] font-extrabold text-slate-950">Active leg</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">Day {day.day} · Leg {activeLegIndex + 1} of {day.legs?.length ?? 1}</p>
        </div>
        <button onClick={onArrive} className="flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-[13px] font-bold text-white hover:bg-emerald-500">
          <CheckCircle size={15} /> Arrived
        </button>
      </div>

      {/* From compact pill */}
      <CompactPlaceCard place={activeFrom} role="from" />

      {/* LegCard */}
      <LegCard leg={activeLeg} from={activeFrom} to={activeTo} tripId={tripId} tripStarted position={position} onUpdated={onUpdated} onWarning={onWarning} />

      {/* To compact pill */}
      <CompactPlaceCard place={activeTo} role="to" onRemove={() => onRemovePlace(activeTo.id)} />
    </div>
  )
}
```

**`CompactPlaceCard`** — new component ở trên cùng file (không cần file riêng):
```jsx
function CompactPlaceCard({ place, role, onRemove }) {
  if (!place) return null
  const isTo = role === 'to'
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg border px-4 py-3',
      isTo ? 'border-emerald-200 bg-emerald-50' : 'border-blue-100 bg-blue-50'
    )}>
      <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', isTo ? 'bg-emerald-500' : 'bg-blue-500')} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-[10.5px] font-bold uppercase tracking-wide', isTo ? 'text-emerald-600' : 'text-blue-500')}>
          {isTo ? 'Destination' : 'Starting from'}
        </p>
        <p className="font-display font-bold text-[15px] text-slate-900 truncate">{place.name}</p>
        {place.dwell_minutes > 0 && (
          <p className="text-[11.5px] text-slate-500 mt-0.5">⏱ {place.dwell_minutes} min visit</p>
        )}
      </div>
      {onRemove && (
        <button onClick={onRemove} className="shrink-0 grid h-7 w-7 place-items-center rounded text-slate-300 hover:text-red-500">
          <X size={13} />
        </button>
      )}
    </div>
  )
}
```

---

### Step 3 — Issue #2: BusArrivalPanel header + filter

**`BusArrivalPanel.jsx`** — thêm header row:
```jsx
// Before the service list:
<div className="mb-1.5 grid grid-cols-[2.5rem_1fr_auto] gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100 pb-1">
  <span>Route</span>
  <span>Arrivals</span>
  <span>Load</span>
</div>

// Service row — change from flex to grid:
<div key={svc.service_no} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2">
  ...
</div>
```

**`LegCard`** (Trip.jsx) — truyền `serviceFilter` cho BUS legs:
```jsx
{leg.first_bus_stop_code && normalizeTransportMode(leg.transport_mode) === 'BUS' && (
  <BusArrivalPanel
    stopCode={leg.first_bus_stop_code}
    serviceFilter={leg.sub_legs?.[0]?.route || null}
  />
)}
```

---

### Step 4 — Issue #3: MRT + bus sub_legs → LTA

**`LegCard`** — sau phần bus arrival hiện tại, thêm:
```jsx
{/* BUS sub_legs trong MRT/PT legs */}
{normalizeTransportMode(leg.transport_mode) !== 'BUS' &&
  (leg.sub_legs ?? [])
    .filter((sub) => sub.mode === 'BUS' && sub.from_stop_code)
    .map((sub, i) => (
      <div key={i} className="mt-2">
        <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400 mb-1">
          Bus {sub.route} — {sub.from_name}
        </p>
        <BusArrivalPanel stopCode={sub.from_stop_code} serviceFilter={sub.route || null} />
      </div>
    ))
}
```

---

### Step 5 — Issue #4: Estimated arrival/departure times

**`frontend/src/lib/tripUtils.js`** — thêm helper:
```js
export function toHHMM(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseHHMM(str) {
  const [h, m] = (str ?? '09:00').split(':').map(Number)
  return h * 60 + (m ?? 0)
}

/**
 * Returns { [placeId]: { arrive: 'HH:MM', depart: 'HH:MM' } }
 */
export function computePlaceTimes(day, placesById, startTime = '09:00') {
  const legs = day?.legs ?? []
  if (!legs.length) return {}
  let cursor = parseHHMM(startTime)
  const times = {}
  for (const leg of legs) {
    const from = placesById[leg.from_place_id]
    const to = placesById[leg.to_place_id]
    if (!times[leg.from_place_id]) {
      const dwell = from?.dwell_minutes ?? 30
      times[leg.from_place_id] = { arrive: toHHMM(cursor), depart: toHHMM(cursor + dwell) }
      cursor += dwell
    } else {
      cursor = parseHHMM(times[leg.from_place_id].depart)
    }
    cursor += leg.duration_minutes ?? 0
    if (!times[leg.to_place_id]) {
      const dwell = to?.dwell_minutes ?? 30
      times[leg.to_place_id] = { arrive: toHHMM(cursor), depart: toHHMM(cursor + dwell) }
    }
  }
  return times
}
```

**`TripSetupModal.jsx`** — thêm field `startTime` (time input, default "09:00"):
```jsx
// Trong draft state:
startTime: savedMeta.startTime ?? '09:00',

// UI field (đặt cạnh dates section):
<div>
  <label>Start time (each day)</label>
  <input type="time" value={draft.startTime} onChange={(e) => set('startTime', e.target.value)} />
</div>
```

**`Trip.jsx` — `DayView`**:
- Import `computePlaceTimes` + `savedMeta` đã available ở parent
- Tính `placeTimes = computePlaceTimes(day, placesById, savedMeta?.startTime ?? '09:00')`
- Truyền `placeTimes` xuống `timelineForDay` items → hiển thị trong render

Hiển thị trong `PlaceCard` hoặc timeline:
```jsx
// Trong phần hiển thị place item:
{placeTimes[place.id] && (
  <p className="text-[11.5px] text-slate-500">
    🕐 Arrive {placeTimes[place.id].arrive} · Leave {placeTimes[place.id].depart}
  </p>
)}
```

---

### Step 6 — Issue #5: Overview day cards — start/end + transit

**`OverviewTab.jsx`** — nhận thêm prop `startTime`:
```jsx
export default function OverviewTab({ trip, savedMeta, startTime, onJumpDay, onOptimize })
```

Import `computePlaceTimes` từ tripUtils. Trong day cards:
```jsx
const { ordered } = buildOrderedPlaces(allPlaces, d.legs ?? [])
const allLegs = d.legs ?? []
const transitMin = allLegs.reduce((s, l) => s + (l.duration_minutes ?? 0), 0)
const dwellMin = ordered.reduce((s, p) => s + (p.dwell_minutes ?? 30), 0)
const times = computePlaceTimes(d, placesById, startTime ?? '09:00')

// Get first + last place times
const firstId = ordered[0]?.id
const lastId = ordered[ordered.length - 1]?.id
const dayStart = firstId && times[firstId] ? times[firstId].arrive : null
const dayEnd = lastId && times[lastId] ? times[lastId].depart : null
```

Hiển thị trong day card:
```jsx
{dayStart && dayEnd && (
  <span className="text-[11.5px] text-slate-500 tabular-nums">
    {dayStart} – {dayEnd}
  </span>
)}
<span className="text-[11.5px] text-slate-500 tabular-nums">
  {fmtMin(transitMin)} transit
</span>
```

**`Trip.jsx`** — truyền `startTime` và `placesById` vào OverviewTab (hiện không pass):
Xem lại: hiện `OverviewTab` được dùng ở đâu? Nhìn code, dường như `OverviewTab` ở `components/planner/OverviewTab.jsx` có thể **không được dùng** — thay bằng `Overview` function component trực tiếp trong Trip.jsx. Cần check.

→ Nếu `OverviewTab` không được dùng: implement logic time vào `Overview` function trong Trip.jsx.
→ Nếu có: truyền `startTime` qua từ Trip.jsx.

---

### Step 7 — Issue #6: Reorder batch + Recalculate Route

**`Trip.jsx` — `Overview` component**:

Thêm local state:
```jsx
const [pendingOrders, setPendingOrders] = useState({})  // { [dayNum]: placeIds[] }
```

Helper kiểm tra pending:
```jsx
const getDisplayOrder = (day, items) => {
  const pending = pendingOrders[day.day]
  if (!pending) return items
  return pending.map((id) => items.find((item) => item.place.id === id)).filter(Boolean)
}
```

Up/Down buttons: thay `onReorder(...)` bằng local state update:
```jsx
onClick={() => {
  const currentIds = getDisplayOrder(day, items).map((item) => item.place.id)
  const next = [...currentIds]
  ;[next[index], next[index - 1]] = [next[index - 1], next[index]]
  setPendingOrders((prev) => ({ ...prev, [day.day]: next }))
}}
```

Thêm nút Recalculate Route (chỉ hiện khi có pending):
```jsx
{pendingOrders[day.day] && (
  <button
    onClick={async () => {
      await onRecalculate(day.day, pendingOrders[day.day])
      setPendingOrders((prev) => { const next = { ...prev }; delete next[day.day]; return next })
    }}
    className="mt-2 w-full h-9 rounded-lg border border-indigo-200 bg-indigo-50 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 inline-flex items-center justify-center gap-2"
  >
    <RotateCcw size={13} /> Recalculate Route
  </button>
)}
```

**`Trip.jsx`** — thêm `onRecalculate` prop:
```jsx
const recalculateDay = (day, placeIds) => mutate(() => api.reorderPlaces(id, day, placeIds))

<Overview
  ...
  onRecalculate={recalculateDay}
/>
```

---

## Thứ tự implement

1. Step 1 (Issue #7 — ẩn Optimize) — 5 phút, không risk
2. Step 2 (Issue #1 — layout) — 20 phút, Trip.jsx DayView
3. Step 3 (Issue #2 — LTA headers + filter) — 10 phút, 2 files
4. Step 4 (Issue #3 — MRT+bus) — 5 phút, LegCard trong Trip.jsx
5. Step 5 (Issue #4 — timestamps) — 30 phút, tripUtils + TripSetupModal + DayView
6. Step 6 (Issue #5 — overview times) — 15 phút, OverviewTab/Overview
7. Step 7 (Issue #6 — reorder batch) — 20 phút, Overview component

## Files sẽ thay đổi

| File | Issues |
|------|--------|
| `frontend/src/pages/Trip.jsx` | #1, #6, #7 |
| `frontend/src/components/transit/BusArrivalPanel.jsx` | #2 |
| `frontend/src/components/planner/OverviewTab.jsx` | #5 |
| `frontend/src/components/planner/TripSetupModal.jsx` | #4 |
| `frontend/src/lib/tripUtils.js` | #4, #5 |

## Không cần thay đổi backend

`reorderPlaces` backend đã gọi `planning_agent.plan_trip` → tự recalculate legs. Frontend chỉ cần batch clicks lại thay vì gọi mỗi lần.
