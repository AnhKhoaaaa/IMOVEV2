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

## Dev 3 — Frontend Core (`dev/frontend-core`)

### Nhiệm vụ

#### Phase 1 — Database (hỗ trợ Dev 2)
- Review migration SQL
- Verify `frontend/src/services/api.js` contract khớp với backend endpoints

#### Phase 3A — Core UI Flow

**3A.1 — Routing** (`App.jsx` + `react-router-dom`)
- `/` → `Home.jsx` — landing page
- `/plan` → `Planner.jsx` — input form
- `/trip/:id` → `Trip.jsx` — kết quả + bản đồ

**3A.2 — `pages/Planner.jsx`** — Multi-step input form
```
Step 1: Chọn quốc gia/thành phố (hardcode Singapore MVP)
Step 2: PlaceSearch.jsx — search + thêm địa điểm
  → gọi GET /places/search
  → hiển thị badge "Thiếu dữ liệu" nếu place không trong curated dataset
Step 3: Nhập số ngày, budget SGD, sở thích (ưu tiên MRT, max đi bộ X phút)
Step 4: Chọn optimize order hay giữ thứ tự
  → gọi POST /trips + POST /trips/{id}/plan
  → loading state khi đang gọi API
```

**3A.3 — `pages/Trip.jsx`** — Kết quả kế hoạch
- Tab 1: List view (`DayPlan.jsx`) — mỗi ngày accordion, mỗi chặng `RouteCard.jsx`
- Tab 2: Map view (do Dev 4 cung cấp `TripMap` component)
- `RouteCard.jsx`: transport mode, thời gian, chi phí, icon
  - **Bắt buộc:** badge "~" hoặc "Ước tính" nếu `is_estimated=true`
- Soft warning banner cho conflict best_time
- Nút "Chỉnh sửa" từng chặng → `PATCH /trips/{id}/legs/{leg_id}`

**3A.4 — `components/auth/AuthModal.jsx`** *(NICE TO HAVE — sau khi core xong)*
- Sign up / Sign in qua Supabase Auth
- Chỉ yêu cầu khi user muốn lưu preference (Memory Agent)
- Guest mode mặc định — không cần đăng nhập

**3A.5 — `components/planner/PlaceSearch.jsx`**
- Input search + gọi `GET /places/search`
- Hiển thị kết quả với badge "Thiếu dữ liệu" nếu `in_curated=false`
- Nút Add → thêm vào danh sách trip

**3A.6 — `frontend/src/services/api.js`** *(Shared — báo nhóm trước khi sửa)*
- Base URL từ `VITE_API_BASE_URL`
- Wrapper fetch với error handling chuẩn cho tất cả calls

### Tests phụ trách (`frontend/src/__tests__/`)
- `planner/PlaceSearch.test.jsx` — render, search input gọi API, badge "Thiếu dữ liệu"
- `planner/DayPlan.test.jsx` — render route cards đúng, badge "~" khi `is_estimated=true`

### Contract với backend (cần Dev 1+2 xong trước)
```javascript
// Cần từ backend:
GET  /places/search?q=...  → [{id, name, lat, lng, in_curated, ...}]
POST /trips                → {id, session_id, ...}
POST /trips/{id}/plan      → {days: [{day, legs: [{transport_mode, duration_minutes, cost_sgd, is_estimated}]}]}
GET  /trips/{id}           → trip + days + legs
PATCH /trips/{id}/legs/{leg_id}
```

### Acceptance Criteria
- [ ] User nhập 3 địa điểm Singapore → nhận kế hoạch dạng list
- [ ] Badge "~" xuất hiện khi `is_estimated=true` — bắt buộc, anti-hallucination
- [ ] Badge "Thiếu dữ liệu" xuất hiện khi place ngoài curated dataset
- [ ] Guest mode hoạt động không cần đăng nhập (session_id từ localStorage)
- [ ] `npm run test` — 100% pass cho PlaceSearch + DayPlan tests
