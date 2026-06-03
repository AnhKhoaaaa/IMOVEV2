# dev11 — Frontend UX Overhaul

Kế hoạch toàn diện giải quyết 8 vấn đề từ `To_fix.md` + 3 cải tiến UX map/route bổ sung.

---

## Tổng quan các nhóm thay đổi

| Nhóm | Mô tả | Files | Ưu tiên |
|------|--------|-------|---------|
| A | Optimize feedback | `Trip.jsx` | Medium |
| B | Map layout / z-index | `Trip.jsx`, `index.css` | High |
| C | Route visualization nâng cấp | `TripMap.jsx`, `index.css` | High |
| D | Ẩn chi tiết khi planning | `Trip.jsx` (LegCard) | High |
| E | Tách Planning / Live mode | `Trip.jsx` | High |
| F | Thông báo ngày bắt đầu chuyến | `Trip.jsx` | Low |
| G | Dropdown modes: dim unavailable | `Trip.jsx`, `transport.js` | High |
| H | Map active trip: chỉ active leg | `Trip.jsx`, `TripMap.jsx` | High |
| I | Glow/pulse, day opacity trên map | `TripMap.jsx`, `index.css` | High |

---

## Chi tiết từng nhóm

---

### Nhóm A — Optimize button feedback

**Root cause:** `api.optimizeRoute(id)` → `refresh()` hoạt động đúng nhưng không có visual feedback nào. User không biết có gì thay đổi hay không.

**Fix — `Trip.jsx`:**
- Thêm state `optimizeResult` lưu số lượng thay đổi sau khi optimize.
- Sau khi `optimize()` thành công, so sánh thứ tự places trước/sau và hiển thị banner tạm:
  - Có thay đổi: "Route optimised! X stops reordered across Y days."
  - Không thay đổi: "Already optimal — no reordering needed."
- Banner tự dismiss sau 4 giây (dùng `setTimeout`).

---

### Nhóm B — Map không đè lên UI

**Root cause:** `leaflet/dist/leaflet.css` đã được import (`main.jsx` line 6) ✓. Vấn đề thực là:
1. Grid layout `minmax(560px,0.92fr)` + `minmax(460px,1.08fr)` = min 1020px — overflow ngang trên màn < 1120px.
2. Leaflet controls/popup có `z-index: 400-1000` không có stacking context riêng → có thể tràn đè header.

**Fix — `Trip.jsx` layout (line 761):**
```jsx
// Trước
<div className="grid min-h-0 flex-1 grid-cols-[minmax(560px,0.92fr)_minmax(460px,1.08fr)] overflow-hidden">

// Sau — thêm stacking context cho sidebar, đổi sang flex với basis
<div className="flex min-h-0 flex-1 overflow-hidden">
  <section className="relative isolate min-h-0 overflow-y-auto ...">  {/* isolate tạo stacking context */}
  <aside className="relative isolate ...">
```

Hoặc đơn giản hơn: giữ grid nhưng thêm `isolate` vào `<section>` và `<aside>` để ngăn Leaflet z-index tràn sang sidebar.

---

### Nhóm C + I — Route visualization & Map enhancements

**`TripMap.jsx` — toàn bộ render logic:**

**C1. Numbered markers:**
Thay `categoryIcon()` bằng `placeIcon(category, index, dimmed)`:
```js
function placeIcon(category, index, dimmed) {
  const color = dimmed ? '#cbd5e1' : (CATEGORY_DOT_COLORS[category?.toLowerCase()] ?? '#64748b')
  const textColor = dimmed ? '#94a3b8' : '#fff'
  return L.divIcon({
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:3px solid #fff;
           box-shadow:0 2px 8px rgba(0,0,0,${dimmed?'0.08':'0.28'});display:flex;align-items:center;
           justify-content:center;font-size:10px;font-weight:800;color:${textColor}">
           ${dimmed ? '' : index + 1}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 13], className: '',
  })
}
```

**C2. Polylines — mode colors & thickness:**
```js
const MODE_STYLE = {
  METRO: { color: '#2563eb', dashArray: null },
  MRT:   { color: '#6366f1', dashArray: null },
  LRT:   { color: '#7c3aed', dashArray: null },
  BUS:   { color: '#10b981', dashArray: null },
  WALK:  { color: '#f97316', dashArray: '4,8' },  // thưa hơn
  CYCLE: { color: '#0d9488', dashArray: '8,4' },
}
// weight: transit=5, walk=3, active leg=6+glow
```

**I. Glow/pulse active leg + day-based opacity:**

New props cho TripMap: `activeLegId`, `dayGroups`, `activeDayNum`
- `activeLegId`: id của leg đang active (khi `tripStarted`)
- `dayGroups`: `{[placeId]: dayNum}` — map place → ngày của nó
- `activeDayNum`: ngày đang xem (khi ở Day tab, planning mode); `null` nếu Overview

**Marker dimming:** Khi `activeDayNum != null && dayGroups[place.id] !== activeDayNum` → `placeIcon(..., true)` (dimmed).

**Polyline active glow:** Render 2 Polylines khi `isActive`:
```jsx
<React.Fragment key={leg.id}>
  {isActive && (
    <Polyline positions={positions} color={style.color}
      weight={16} opacity={0.2} className="active-route-glow" />
  )}
  <Polyline positions={positions} color={style.color}
    dashArray={isActive ? null : style.dashArray}
    weight={isActive ? 6 : (isWalk ? 3 : 5)}
    opacity={isActive ? 1 : 0.75}
  >
    <Tooltip sticky>{legTooltip(leg)}</Tooltip>
  </Polyline>
</React.Fragment>
```

**`index.css` — thêm animation:**
```css
@keyframes route-pulse {
  0%, 100% { opacity: 0.12; }
  50%       { opacity: 0.42; }
}
.active-route-glow {
  animation: route-pulse 1.8s ease-in-out infinite;
}
```

---

### Nhóm D — Ẩn chi tiết khi planning mode

**Root cause:** `LegCard` luôn hiển thị instructions, "Compare modes", sub_legs, BusArrivalPanel kể cả khi chưa bắt đầu chuyến. Đây là thông tin chỉ cần khi đang đi.

**Fix — `Trip.jsx` `LegCard` component:**

Giữ nguyên "Change mode" dropdown (cần cho planning). Chỉ ẩn:
- Button "N instructions" + button "Compare modes": bọc trong `{tripStarted && (...)}` 
- Details section (instructions list, sub_legs, BusArrivalPanel, compare grid): bọc trong `{tripStarted && (...)}`

Khi `tripStarted=true` → hiển thị đầy đủ như hiện tại (bao gồm compare + switch).

---

### Nhóm E — Tách Planning / Live mode

**Fix — `Trip.jsx`:**

Thêm **mode banner** ngay dưới header, trên alert section:
- `!tripStarted`: banner xanh nhạt nhỏ — "Planning mode — review your itinerary before you start."
- `tripStarted`: banner emerald — "Live · Day {selectedDay} · Tap Arrived when you reach each stop."

Thêm **"Start Trip"** button nổi bật trong `Overview` component:
```jsx
// Trong Overview, bên cạnh "Optimise" button
<button onClick={() => startDay(trip.days[0].day)}
  className="... bg-emerald-600 text-white ...">
  <Navigation2 size={15} /> Start Trip
</button>
```

Khi `tripStarted=true`, ẩn buttons: "+ Add Day", "Optimise", "Settings" trong header (sử dụng `disabled={tripStarted}` hoặc `{!tripStarted && ...}`).

---

### Nhóm F — Thông báo ngày bắt đầu chuyến

**Fix — `Trip.jsx`:**

```jsx
const [todayBanner, setTodayBanner] = useState(() => {
  const today = new Date().toISOString().slice(0, 10)
  return savedMeta?.start_date === today && !tripStarted
})

useEffect(() => {
  const today = new Date().toISOString().slice(0, 10)
  if (savedMeta?.start_date === today && !tripStarted) setTodayBanner(true)
}, [savedMeta, tripStarted])
```

Render banner emerald trên alerts section:
```jsx
{todayBanner && (
  <div className="... bg-emerald-50 border-emerald-200 ...">
    <Navigation2 size={15} /> Your trip starts today!
    <button onClick={() => { startDay(1); setTodayBanner(false) }}>
      Start Day 1 →
    </button>
    <button onClick={() => setTodayBanner(false)}><X size={14} /></button>
  </div>
)}
```

---

### Nhóm G — Mode dropdown: dim unavailable modes

**`transport.js` — thêm function:**
```js
export function allModesWithAvailability(leg) {
  const hasAlts = leg?.alternatives && Object.keys(leg.alternatives).length > 0
  if (!hasAlts) return TRANSPORT_OPTIONS.map((o) => ({ ...o, available: true }))
  const avail = new Set(Object.keys(leg.alternatives).map(normalizeTransportMode))
  return TRANSPORT_OPTIONS.map((o) => ({ ...o, available: avail.has(o.mode) }))
}
```

**`Trip.jsx` `LegCard` dropdown:**
- Thay `availableModesForLeg(leg)` → `allModesWithAvailability(leg)`
- Unavailable mode: `opacity-50 cursor-not-allowed` + nhãn "N/A" ở cuối + disabled click

---

### Nhóm H — Map active trip: chỉ active leg

**`Trip.jsx` — hoist active leg computation lên Trip level:**
```jsx
const activeLeg = useMemo(
  () => (tripStarted ? currentDay?.legs?.[activeLegIndex] ?? null : null),
  [tripStarted, currentDay, activeLegIndex]
)
const activeFrom = activeLeg ? placesById[activeLeg.from_place_id] : null
const activeTo   = activeLeg ? placesById[activeLeg.to_place_id]   : null
```

**Rewrite `mapLegs` và `mapPlaces`:**
```jsx
const mapLegs = useMemo(() => {
  if (tripStarted && activeLeg) return [activeLeg]
  if (activeTab === 'overview' || activeTab === 'summary')
    return trip?.days?.flatMap((d) => d.legs ?? []) ?? []
  return currentDay?.legs ?? []
}, [tripStarted, activeLeg, activeTab, trip, currentDay])

const mapPlaces = useMemo(() => {
  if (!trip) return []
  if (tripStarted && activeFrom && activeTo) return [activeFrom, activeTo]
  return trip.places ?? []  // all places; TripMap handles dimming
}, [trip, tripStarted, activeFrom, activeTo])
```

**Thêm `dayGroupsForMap` và `activeDayNum`:**
```jsx
const dayGroupsForMap = useMemo(() => {
  if (!trip?.days) return {}
  const map = {}
  for (const day of trip.days) {
    for (const leg of day.legs ?? []) {
      if (leg.from_place_id) map[leg.from_place_id] = day.day
      if (leg.to_place_id)   map[leg.to_place_id]   = day.day
    }
  }
  return map
}, [trip])

const activeDayNum = (!tripStarted && activeTab.startsWith('day-')) ? selectedDay : null
```

**Update TripMap call:**
```jsx
<TripMap
  places={mapPlaces}
  legs={mapLegs}
  userPosition={tripStarted ? position : null}
  activeLegId={activeLeg?.id ?? null}
  dayGroups={dayGroupsForMap}
  activeDayNum={activeDayNum}
/>
```

---

## Tóm tắt files cần sửa

| File | Thay đổi |
|------|---------|
| `frontend/src/lib/transport.js` | +`allModesWithAvailability()` |
| `frontend/src/pages/Trip.jsx` | LegCard dropdown, ẩn detail khi planning, mode banner, today banner, optimize feedback, hoist activeLeg, rewrite mapLegs/mapPlaces, dayGroupsForMap, pass props |
| `frontend/src/components/map/TripMap.jsx` | New props, numbered markers, day dimming, glow polylines, import React |
| `frontend/src/index.css` | +route-pulse keyframe + .active-route-glow |

Không cần sửa backend. Không cần tạo file mới.

---

## Kiểm tra sau khi implement

1. **Overview tab**: All places numbered 1,2,3..., all legs với màu đúng mode, không dimming.
2. **Day 1 tab (planning)**: Places Day 1 full opacity + numbered; Day 2+ places grayed không số; chỉ Day 1 legs được vẽ; LegCard chỉ có "Change mode" dropdown, không có "Instructions"/"Compare".
3. **Day 1 tab (started)**: Map chỉ hiện 2 places + 1 leg với glow pulse; mode dropdown hiện đủ 4 mode, N/A bị dim; "Compare modes" + "Instructions" button hiện và hoạt động.
4. **Mode dropdown**: Tất cả 4 mode hiện, mode không khả dụng có nhãn "N/A" và mờ.
5. **Today banner**: Nếu `savedMeta.start_date === today`, hiện banner với nút "Start Day 1 →".
6. **Optimize**: Sau khi bấm, hiện banner "X stops reordered" hoặc "Already optimal".
