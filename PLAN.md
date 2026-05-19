# IMOVE — Project Plan

## Plan Overview

**App:** Web app lập kế hoạch di chuyển công cộng cho khách du lịch Singapore, kiến trúc multi-agent.  
**Stack:** FastAPI · React + Leaflet.js · Supabase · Gemini 2.5 Flash · Render · Vercel

### Phân công nhóm

| Dev | Branch | Phụ trách Phase 2/3 |
|-----|--------|----------------------|
| Dev 1 | `dev/backend-infra` | Infrastructure + External APIs (OneMap, LTA, Gemini, OpenWeather) |
| Dev 2 | `dev/agent-logic` | Agent Logic (Planning / Adaptation / Memory) |
| Dev 3 | `dev/frontend-core` | Core UI Flow (Input form, list view, auth) |
| Dev 4 | `dev/frontend-map` | Map + Realtime (Leaflet, Supabase Realtime) |

### Ownership (không ai commit vào vùng của người khác)

| Dev | Owns |
|-----|------|
| Dev 1 | `backend/app/services/`, `backend/app/routers/health.py`, `backend/app/routers/places.py` |
| Dev 2 | `backend/app/agents/`, `backend/app/routers/trips.py`, `backend/app/routers/alerts.py`, `backend/app/data/` |
| Dev 3 | `frontend/src/pages/`, `frontend/src/components/planner/`, `frontend/src/components/auth/` |
| Dev 4 | `frontend/src/components/map/`, `frontend/src/components/adaptation/`, `frontend/src/hooks/`, `frontend/src/lib/` |
| Shared | `backend/app/models/`, `frontend/src/services/api.js`, `supabase/migrations/` |

### Phase tổng quan

```
Phase 0  — Khởi tạo nền tảng        (cả nhóm,    ~0.5 ngày)
Phase 1  — Database Supabase          (Dev 1+2,   ~1 ngày)
Phase 2  — Backend / API              (Dev 1+2,   ~3 ngày, song song)
Phase 3  — Frontend UI                (Dev 3+4,   ~3 ngày, song song)
Phase 4  — Tích hợp & Kiểm thử       (cả nhóm,   ~1 ngày)
```

### MVP Priority

```
MUST HAVE:   Phase 0 → 1 → 2A.1–2A.5 → 2B.1–2B.3 → 3A.1–3A.3
SHOULD HAVE: 2B.4 → 3B.1–3B.4 + weather integration
NICE TO HAVE: Memory Agent (2B.5 + 3A.4)
```

### Git Workflow

```
main        ← production-ready, protected
develop     ← integration branch
  └── dev/backend-infra
  └── dev/agent-logic
  └── dev/frontend-core
  └── dev/frontend-map
```

Merge cycle: rebase → test 100% pass → PR → code review → human approve → squash merge → delete branch.

---

## Dev 4 — Frontend Map + Realtime (`dev/frontend-map`)

### Nhiệm vụ

#### Phase 1 — Database (hỗ trợ Dev 2)
- Review migration SQL, đặc biệt bảng `lta_alerts` và `trips`
- Verify Supabase Realtime bật trên `lta_alerts`

#### Phase 3B — Map + Realtime

**3B.1 — `lib/supabase.js`** — Supabase client
- Init với `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY`
- Export single instance dùng chung toàn app

**3B.2 — `components/map/TripMap.jsx`** — Leaflet map
- Markers cho tất cả địa điểm trong ngày đang xem
- Polyline nối các chặng theo thứ tự
- Popup mỗi marker: tên địa điểm, dwell time, best time window
- Responsive: 50% màn hình desktop / full-width mobile

**3B.3 — `hooks/useAlerts.js`** — Supabase Realtime subscription
```javascript
supabase.channel('trip-alerts')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'lta_alerts',
    filter: `trip_id=eq.${tripId}`
  }, handleNewAlert)
  .subscribe()
// Cleanup: supabase.removeChannel(channel) on unmount
```

**3B.4 — `components/adaptation/AlertBanner.jsx`** — Alert notification
- Banner cố định khi có alert mới từ Realtime
- Phân biệt theo `alert_type`:
  - `transport_alert` → nền đỏ/cam, icon `!`
  - `service_unavailable` → nền vàng, icon `!`
  - `weather_warning` → nền xanh dương, icon `☔`
- Nội dung: tuyến/địa điểm bị ảnh hưởng + phương án thay thế
- Nút "Cập nhật kế hoạch" → gọi `POST /trips/{id}/adapt`
- Tự động dismiss sau khi user xác nhận

**3B.5 — `hooks/useTrip.js`** — Trip data fetching
- Fetch trip + route_legs từ `GET /trips/{id}`
- Expose `refresh()` để reload sau khi adapt

**3B.6 — `services/api.js`** *(Shared — báo nhóm trước khi sửa)*
- Bổ sung `adaptTrip(id, body)` wrapper nếu Dev 3 chưa làm

### Tests phụ trách (`frontend/src/__tests__/`)
- `hooks/useAlerts.test.js` — mock Supabase Realtime, assert callback khi có INSERT
- `map/TripMap.test.jsx` — Leaflet mount không lỗi, markers đúng số lượng
- `adaptation/AlertBanner.test.jsx`:
  - Banner hiện khi nhận alert, dismiss sau confirm
  - Render `type="weather_warning"` → icon `☔`, nền xanh, nút "Cập nhật kế hoạch"

### Contract với backend (cần Dev 2 xong trước)
```javascript
// Supabase table cần Realtime ON:
lta_alerts: { id, trip_id, alert_type, message, created_at }

// API cần:
POST /trips/{id}/adapt → { days: [...updated legs...] }
```

### Contract với Dev 3
- `TripMap` nhận prop `places: [{id, name, lat, lng, dwell_minutes, best_time_start, best_time_end}]`
- `AlertBanner` nhận props `alert`, `tripId`, `onDismiss`
- Dev 3 render `<TripMap>` trong `Trip.jsx` tab Map

### Acceptance Criteria
- [ ] Bản đồ load đúng markers và polyline khi có trip data
- [ ] Supabase Realtime: INSERT vào `lta_alerts` → AlertBanner xuất hiện < 2s, không cần refresh
- [ ] Weather banner hiển thị icon `☔` và nền xanh (phân biệt với transport alert)
- [ ] `npm run test` — 100% pass cho useAlerts, TripMap, AlertBanner tests
