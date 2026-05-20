# IMOVE — Dev 4: Frontend Map + Realtime

**Branch:** `dev/frontend-map`  
**Owns:** `components/map/` · `components/adaptation/` · `hooks/` · `lib/supabase.js`  
**Quy trình PR, testing, anti-hallucination rules → xem PLAN_OVERVIEW.md**

---

## File ownership

```
frontend/src/components/map/TripMap.jsx
frontend/src/components/adaptation/AlertBanner.jsx
frontend/src/hooks/useAlerts.js · useTrip.js
frontend/src/lib/supabase.js
```
Shared (báo nhóm trước khi sửa): `App.jsx` · `services/api.js`

---

## Phase 0 — Setup
Clone repo sau khi Dev 3 khởi tạo. Tạo `frontend/.env` từ `.env.example`, điền `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.

---

## Tasks — Phase 3B

### Task 1: Supabase client
**`frontend/src/lib/supabase.js`** — tạo xong notify Dev 3 (họ dùng cho AuthModal):
```js
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

### Task 2: useAlerts hook
```js
export function useAlerts(tripId) {
  const [alerts, setAlerts] = useState([])
  useEffect(() => {
    if (!tripId) return
    const channel = supabase
      .channel(`trip-alerts-${tripId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'lta_alerts', filter: `trip_id=eq.${tripId}` },
        (payload) => setAlerts(prev => [...prev, payload.new])
      ).subscribe()
    return () => supabase.removeChannel(channel)  // ← BẮT BUỘC: tránh memory leak
  }, [tripId])
  const dismissAlert = (id) => setAlerts(prev => prev.filter(a => a.id !== id))
  return { alerts, dismissAlert }
}
```

### Task 3: AlertBanner component
Props: `{ alert: { id, alert_type, affected_line, message }, onDismiss, onAdapt }`

| alert_type | Icon | Background | Nút |
|---|---|---|---|
| `train_delay` | ⚠️ | Đỏ | "Cập nhật kế hoạch" + "Bỏ qua" |
| `bus_cancellation` | 🚫 | Cam | "Cập nhật kế hoạch" + "Bỏ qua" |
| `service_unavailable` | ℹ️ | Xám | "Đã hiểu" only |
| `weather_warning` | ☔ | Xanh dương nhạt | "Cập nhật kế hoạch" + "Bỏ qua" |

- Banner sticky/fixed top
- Nút "Cập nhật kế hoạch" → `onAdapt()` → gọi `adaptTrip(tripId)` từ api.js
- Nút "Bỏ qua" / "Đã hiểu" → `onDismiss(alert.id)`

**Thêm vào `api.js`** (báo Dev 3 trước):
```js
export const adaptTrip = (tripId, body) =>
  fetch(`${BASE_URL}/trips/${tripId}/adapt`, {method:'POST', ...}).then(handleResponse)
```

### Task 4: useTrip hook
```js
export function useTrip(tripId) {
  const [trip, setTrip] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState(1)
  const [error, setError] = useState(null)
  useEffect(() => {
    getTrip(tripId).then(setTrip).catch(setError).finally(() => setLoading(false))
  }, [tripId])
  return { trip, loading, error, selectedDay, setSelectedDay }
}
```

### Task 5: TripMap component
Props: `{ places: Place[], legs: RouteLeg[], selectedDay: number }`

**Fix Leaflet icon trong Vite** (thêm vào `main.jsx`):
```js
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, shadowUrl: markerShadow })
```

Logic:
- `MapContainer`: center = trung bình lat/lng, zoom 13
- TileLayer: OpenStreetMap (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`)
- Mỗi place trong `selectedDay`: Marker + số thứ tự (custom DivIcon) + Popup (tên, dwell_minutes, best_time)
- Polyline theo `order_in_day`: 🔵 MRT · 🟢 Bus · ⬜ Walk
- `selectedDay` đổi → map fit bounds markers của ngày đó
- Responsive: height 500px desktop · 300px mobile (≤768px)

### Task 6: Tích hợp vào Trip page
Phối hợp với Dev 3:
- Dev 3 import `<TripMap />` vào `Trip.jsx` tab "Bản đồ"
- Dev 3 import `<AlertBanner />` và dùng `useAlerts()` + `useTrip()` trong `Trip.jsx`
- Thống nhất props interface trước khi implement

---

## Test files

| File | Cần test gì |
|------|------------|
| `__tests__/hooks/useAlerts.test.js` | Mock `supabase.channel().on().subscribe()` → simulate INSERT → alerts cập nhật · unmount → removeChannel được gọi |
| `__tests__/adaptation/AlertBanner.test.jsx` | type="train_delay" → text đúng · click "Cập nhật" → onAdapt gọi · click "Bỏ qua" → onDismiss(id) · type="service_unavailable" → không có nút "Cập nhật" · type="weather_warning" → icon ☔, nền xanh |
| `__tests__/map/TripMap.test.jsx` | Mock react-leaflet → render không crash · số markers = số places · selectedDay đổi → re-render |

---

## Acceptance Criteria

- [ ] `npm run test` → 100% PASS
- [ ] Bản đồ load đúng markers + polylines khi có trip data
- [ ] INSERT thủ công vào `lta_alerts` → AlertBanner xuất hiện < 2 giây, không refresh
- [ ] `type="service_unavailable"` → không có nút "Cập nhật kế hoạch"
- [ ] `type="weather_warning"` → icon ☔, nền xanh dương
