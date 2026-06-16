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

## Dev 2 — Agent Logic (`dev/agent-logic`)

### Nhiệm vụ

#### Phase 1 — Database (chủ trì)
- Viết `supabase/migrations/001_initial_schema.sql` — schema đầy đủ, RLS, index
- Apply migration lên Supabase Dashboard
- Bật Realtime trên table `lta_alerts`
- Tạo tài khoản Supabase → share `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Tạo Google AI Studio → share `GEMINI_API_KEY`

#### Phase 2B — Agent Logic

**2B.1 — `app/data/places.json`** — Curated dataset ~50 POIs Singapore
- Mỗi entry: `{id, name, lat, lng, dwell_minutes, best_time_start, best_time_end, category, is_outdoor}`
- `is_outdoor: true` — Gardens by the Bay, Merlion Park, MacRitchie, Botanic Gardens...
- `is_outdoor: false` — Marina Bay Sands (mall), National Museum, Universal Studios, Jewel Changi...
- Nguồn: data.gov.sg cho tọa độ + giờ mở cửa; `dwell_minutes` và `best_time` điền tay
- Đây là nguồn sự thật duy nhất — **không dùng LLM để sinh dwell time**

**2B.2 — `app/agents/planning_agent.py`** — Planning Agent (75% code / 25% LLM)
```
Input: list[place_id], num_days, budget_sgd, optimize_order, preferences
Logic:
  1. [CODE] Validate: tất cả place_id có trong places.json → lỗi nếu thiếu
  2. [CODE] Nếu optimize_order=True: greedy nearest-neighbor sort
  3. [CODE] Phân địa điểm vào ngày (dwell_time tổng ≤ budget giờ/ngày)
  4. [CODE] Mỗi chặng: gọi onemap.get_route → time + cost (is_estimated=False)
  5. [CODE] Kiểm tra tổng cost ≤ budget_sgd → lỗi nếu vượt
  6. [CODE] Check best_time conflicts → soft warning (không block)
  7. [LLM]  Chỉ gọi Gemini cho edge case rules không cover
Output: TripPlan (list ngày, mỗi ngày có route_legs đầy đủ)
```

**2B.3 — `app/routers/trips.py`**
- `POST /trips` → tạo trip mới (guest dùng session_id, auth dùng user_id)
- `POST /trips/{id}/plan` → gọi planning_agent, lưu route_legs vào DB
- `GET /trips/{id}` → lấy trip + route_legs
- `PATCH /trips/{id}/legs/{leg_id}` → user chỉnh từng chặng

**2B.4 — `app/agents/adaptation_agent.py`** — Adaptation Agent
```
Trigger 1 (tự động, APScheduler mỗi 2 phút):
  → Lấy trips active, gọi lta.get_train_alerts()
  → Nếu ảnh hưởng route → insert lta_alerts + tính route thay thế
  → LTAUnavailableError → insert alert type="service_unavailable", không tính lại

Trigger 2 (thủ công, POST /trips/{id}/adapt):
  → Tính lại kế hoạch từ vị trí hiện tại

Trigger 3 (weather, APScheduler mỗi 30 phút):
  → openweather.get_forecast(today) → rain_probability > 70%
  → Tìm outdoor places trong trip active → gợi ý indoor alternatives
  → insert lta_alerts với alert_type="weather_warning"
  → WeatherUnavailableError → log warning, skip
```

**2B.5 — `app/agents/memory_agent.py`** — Memory Agent (logged-in only)
- `POST /feedback` → lưu rating/comment vào `trip_feedback`
- `GET /preferences` → trả `user_preferences` từ Supabase
- Implicit learning: nếu user sửa nhiều bus legs → update `prefer_mrt=True`
- Thêm vào `app/routers/alerts.py`

### Tests phụ trách (`backend/tests/`)
- `test_agents/test_planning_agent.py` — unit test từng bước: validate, sort, split days, budget check, conflict warning
- `test_agents/test_adaptation_agent.py` — trigger thủ công + tự động + weather path
- `test_routers/test_trips.py` — integration test endpoints với Supabase test project
- `test_anti_hallucination.py` — không có hardcode estimate; mọi `is_estimated=False` đều có OneMap data

### Acceptance Criteria
- [ ] `POST /trips/{id}/plan` với 3 địa điểm hợp lệ → kế hoạch 1 ngày với route_legs đầy đủ
- [ ] Địa điểm không trong places.json → error "Thiếu dữ liệu dwell time"
- [ ] Vượt budget → error "Vượt ngân sách"
- [ ] `pytest backend/tests/test_agents/ -v` — 100% pass
- [ ] `test_anti_hallucination.py` — 100% pass
