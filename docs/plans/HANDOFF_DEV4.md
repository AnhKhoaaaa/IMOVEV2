# HANDOFF — Dev 4: Frontend Map + Realtime

> **Đọc file này trước khi làm bất cứ việc gì.**
> File này là kênh giao tiếp giữa Dev 3 (phiên hiện tại) và Dev 4 (phiên riêng).
> Dev 3 đã hoàn thành frontend core. Dev 4 sở hữu map, hooks, lib, và adaptation.

---

## ⚠️ GIAO THỨC CẬP NHẬT FILE NÀY

```
MỌI cập nhật phải được APPEND vào "Update Log" ở cuối file.
TUYỆT ĐỐI không xóa hoặc sửa entry cũ.
Format bắt buộc: ### [YYYY-MM-DD | DevX] Tiêu đề ngắn
```

---

## Ngữ cảnh dự án

**IMOVE** là web app lập kế hoạch di chuyển công cộng tại Singapore cho khách du lịch.

**Tech stack:**
- Frontend: React 18 + Vite + Tailwind v4 + Shadcn/ui (Radix UI)
- Maps: Leaflet 1.9 + react-leaflet 4.2
- DB/Auth/Realtime: Supabase 2.45
- Icons: Lucide React
- Tests: Vitest + React Testing Library

**Branch của Dev 4:** `dev/frontend-map`
**Dev 4 owns:**
```
frontend/src/components/map/        ← TripMap.jsx (Leaflet)
frontend/src/components/adaptation/ ← AlertBanner.jsx
frontend/src/hooks/                 ← useTrip.js, useAlerts.js
frontend/src/lib/                   ← supabase.js, utils.js
```

---

## Trạng thái hiện tại (khi file này được tạo)

### Dev 3 đã làm xong (KHÔNG ĐƯỢC SỬA)
```
frontend/src/pages/Home.jsx         ✅
frontend/src/pages/Planner.jsx      ✅ (4-step form)
frontend/src/pages/Trip.jsx         ✅ (có Tabs: Danh sách | Bản đồ)
frontend/src/components/planner/    ✅ (PlaceSearch, DayPlan, RouteCard)
frontend/src/components/layout/     ✅ (Header)
frontend/src/components/auth/       ✅ (AuthModal)
frontend/src/components/ui/         ✅ (Button, Card, Badge, Dialog, Tabs, v.v.)
frontend/src/services/api.js        ✅ (tất cả API calls)
frontend/src/App.jsx                ✅ (routing)
```

Tests Dev 3: **77/77 pass** — đừng làm hỏng.

### Dev 4 cần hoàn thành

| File | Trạng thái | Việc cần làm |
|------|-----------|-------------|
| `lib/supabase.js` | Có thay đổi chưa commit | Commit env var validation (xem bên dưới) |
| `hooks/useTrip.js` | Đã implement | Verify, viết test nếu chưa có |
| `hooks/useAlerts.js` | Đã implement | Verify, viết test nếu chưa có |
| `components/map/TripMap.jsx` | Stub cơ bản | Nâng cấp (xem spec bên dưới) |
| `components/adaptation/AlertBanner.jsx` | Đã implement | Verify với Supabase Realtime thật |

---

## Task 1 — Commit `supabase.js`

File `frontend/src/lib/supabase.js` có thay đổi đang uncommitted. Dev 3 đã thêm env var validation:

```javascript
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('Supabase env vars missing — auth and realtime features will be unavailable')
}
export const supabase = createClient(url ?? '', key ?? '')
```

**Việc cần làm:** Commit file này vào branch `dev/frontend-map`. Không cần thay đổi gì thêm.

---

## Task 2 — Nâng cấp `TripMap.jsx`

### Props contract (KHÔNG ĐƯỢC THAY ĐỔI — Trip.jsx đang truyền đúng shape này)

```jsx
// Trip.jsx gọi TripMap như này:
<TripMap places={trip.places} legs={trip.days.flatMap(d => d.legs)} />

// Props types:
places: Array<{
  id: string,
  name: string,
  lat: number,
  lng: number,
  dwell_minutes: number,
  best_time_start: string,   // "HH:MM"
  best_time_end: string,     // "HH:MM"
  category: string,
  is_outdoor: boolean
}>

legs: Array<{
  id: string,
  from_place_id: string,     // khớp với places[].id
  to_place_id: string,
  transport_mode: "MRT" | "BUS" | "WALK" | "DRIVE" | "CYCLE",
  duration_minutes: number,
  cost_sgd: number | null,
  is_estimated: boolean
}>
```

### Yêu cầu hiển thị

**Markers (địa điểm):**
- Số thứ tự trên marker (1, 2, 3...) theo thứ tự xuất hiện đầu tiên trong legs
- Popup khi click: tên địa điểm + dwell_minutes + khung giờ tốt nhất
- Zoom to bounds khi map mount

**Routes (đường nối giữa các địa điểm):**
- Màu theo transport_mode:
  - `MRT` → đỏ `#ef4444`
  - `BUS` → xanh lá `#22c55e`
  - `WALK` → cam `#f97316`, nét đứt (dashArray: "5,5")
  - `DRIVE` / `CYCLE` → xanh dương `#3b82f6`
- Tooltip khi hover đường: "MRT · 15 phút · SGD 1.80"
- `is_estimated: true` → thêm "(ước tính)" vào tooltip

**Layout:**
- Height container: `h-[480px]` (đã có trong Trip.jsx)
- Mobile: full width, không overflow

### Không cần làm (MVP)
- Clustering markers
- Animated path drawing
- Real routing path (chỉ cần straight line giữa 2 điểm)

---

## Task 3 — Verify `useAlerts.js`

Hook này subcribes Supabase Realtime và trả alerts cho `AlertBanner`.

**Verify các điểm sau:**
1. Channel name unique per tripId (tránh conflict khi nhiều tab mở)
2. Cleanup subscription khi component unmount
3. Initial fetch khi mount (lấy alerts đang tồn tại trong DB)
4. Khi alert mới INSERT vào `lta_alerts` → `alerts` state cập nhật < 2s

**Schema `lta_alerts` table:**
```sql
id          uuid PRIMARY KEY
trip_id     uuid (foreign key → trips.id)
type        text  -- 'transport_alert' | 'service_unavailable' | 'weather_warning'
message     text
created_at  timestamptz
```

---

## Task 4 — Verify `useTrip.js`

Hook fetch trip data và refresh sau khi adapt.

**Verify:**
1. Gọi `api.getTrip(tripId)` khi mount
2. Trả `{ trip, loading, error, refresh }`
3. `refresh()` re-fetch trip (dùng sau khi `adaptTrip` thành công trong AlertBanner)
4. `loading: true` khi đang fetch → Trip.jsx hiển thị Skeleton cards
5. Cleanup: ignore flag tránh `setState` sau khi unmount

---

## Quy tắc testing

- Mọi component/hook cần có test file trong `frontend/src/__tests__/`
- Chạy `npm run test` — phải pass toàn bộ (bao gồm 77 tests của Dev 3)
- **KHÔNG** dùng Radix primitives trong test — dùng native HTML elements cho test compatibility
  - Lý do: `fireEvent.change` không work với Radix Select/Slider → dùng `<select>`, `<input type="range">`

---

## Giao tiếp với Dev 3 (phiên chính)

1. Khi xong một task → append vào Update Log bên dưới
2. Nếu cần thay đổi props của TripMap (vì Trip.jsx là Dev 3's file) → ghi vào Update Log, Dev 3 sẽ cập nhật Trip.jsx
3. Nếu cần thêm API call mới vào `api.js` (shared file) → ghi rõ signature trong Update Log

---

## Files cần đọc trước khi code

```
frontend/src/pages/Trip.jsx                  — xem TripMap được render thế nào
frontend/src/components/ui/                  — tái dụng Button, Badge, Card, Alert có sẵn
frontend/src/lib/utils.js                    — cn() helper (clsx + tailwind-merge)
frontend/src/services/api.js                 — adaptTrip(), getTrip() signatures
frontend/src/__tests__/pages/Trip.test.jsx   — xem mock data shape để viết tests nhất quán
```

---

## 📋 Update Log — APPEND ONLY

<!-- QUAN TRỌNG: Chỉ thêm mới xuống dưới. KHÔNG xóa hay sửa entry cũ. -->
<!-- Format: ### [YYYY-MM-DD | DevX] Mô tả ngắn -->

### [2026-05-20 | Dev3] Khởi tạo handoff file

- Phase 3A Frontend Core + UI Upgrade hoàn thành: 77/77 tests pass
- TripMap.jsx hiện là stub (markers + polyline đơn giản, chưa có màu theo mode)
- AlertBanner.jsx, useAlerts.js, useTrip.js đã implement nhưng chưa verify với data thật
- supabase.js có uncommitted change (env var validation) cần Dev 4 commit
- Props contract TripMap đã document đầy đủ ở trên — Trip.jsx đang dùng đúng shape này

### [2026-05-20 | Dev4] TripMap nâng cấp hoàn thành — cần Dev 3 cập nhật Trip.jsx

**Việc Dev 3 cần làm (1 dòng trong Trip.jsx):**

```jsx
// Dòng cũ (khoảng line 83):
<TripMap places={trip.places} />

// Dòng mới — thêm legs prop:
<TripMap places={trip.places} legs={trip.days?.flatMap((d) => d.legs) ?? []} />
```

**Lý do:** TripMap giờ cần `legs` để:
- Đánh số markers theo thứ tự hành trình (1, 2, 3...)
- Vẽ polylines màu theo transport_mode (MRT=đỏ, BUS=xanh lá, WALK=cam đứt, DRIVE/CYCLE=xanh)
- Hiển thị tooltip hover: "MRT · 15 phút · SGD 1.80 · (ước tính)"

**Trạng thái branch dev/frontend-map (44 tests pass):**
- `lib/supabase.js` — env var validation ✅
- `hooks/useAlerts.js` — unique channel name, initial fetch, ignore flag ✅
- `hooks/useTrip.js` — ignore flag, isMounted ref cho refresh(), loading state ✅
- `components/adaptation/AlertBanner.jsx` — service_unavailable ẩn adapt button ✅
- `components/map/TripMap.jsx` — numbered markers, colored polylines, tooltips, fitBounds ✅
