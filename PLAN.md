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

## Dev 1 — Backend Infrastructure (`dev/backend-infra`)

### Nhiệm vụ

#### Phase 1 — Database (hỗ trợ)
- Hỗ trợ Dev 2 viết `supabase/migrations/001_initial_schema.sql`
- Test kết nối Supabase từ Python client

#### Phase 2A — Infrastructure + External Services

**2A.1 — `app/routers/health.py`**
- `GET /health` → `{"status":"ok","timestamp":"..."}`
- Dùng cho Render keep-alive ping (gọi mỗi 10 phút)

**2A.2 — `app/services/onemap.py`**
- `geocode(place_name: str) → {lat, lng, address}` — OneMap Search API
- `get_route(from_lat, from_lng, to_lat, to_lng, mode) → RouteResult` — OneMap Route API
- Error: không tìm được route → raise `NoRouteError` (không fallback, không estimate)

**2A.3 — `app/services/lta.py`**
- `get_bus_arrival(bus_stop_code) → list[BusArrival]`
- `get_train_alerts() → list[TrainAlert]`
- Error: API down → raise `LTAUnavailableError`

**2A.4 — `app/services/gemini.py`**
- `parse_places_input(raw_text: str) → list[str]` — LLM parse natural language
- Rate-limit guard: max 1 call/4s (≤ 15 RPM)
- Comment rõ: phần nào code thuần, phần nào LLM

**2A.5 — `app/services/openweather.py`**
- `get_forecast(date: str) → {date, condition, rain_probability, temp_max, temp_min}`
- Tọa độ Singapore: lat=1.3521, lng=103.8198
- Error: API lỗi → raise `WeatherUnavailableError` (soft — không block)
- Đăng ký key tại openweathermap.org → share qua team chat

**2A.6 — `app/routers/places.py`**
- `GET /places/search?q=...` → geocode OneMap + filter curated dataset
- `GET /places/curated` → trả toàn bộ POI từ `data/places.json`

### Tests phụ trách (`backend/tests/test_services/`)
- `test_onemap.py` — mock HTTP, assert geocode/route schema, NoRouteError
- `test_lta.py` — mock HTTP, assert parse đúng, LTAUnavailableError khi down
- `test_gemini.py` — mock SDK, assert rate-limit guard
- `test_openweather.py` — mock response, assert rain_probability; mock 503 → WeatherUnavailableError
- `test_routers/test_places.py` — search + curated endpoint

### API Keys cần đăng ký
- OneMap: đăng ký tại onemap.gov.sg → share `ONEMAP_EMAIL` + `ONEMAP_PASSWORD`
- LTA DataMall: đăng ký tại datamall.lta.gov.sg → share `LTA_API_KEY`
- OpenWeather: đăng ký tại openweathermap.org → share `OPENWEATHER_API_KEY`

### Acceptance Criteria
- [ ] `GET /health` → 200 với timestamp
- [ ] `pytest backend/tests/test_services/ -v` — 100% pass
- [ ] Tất cả error case raise đúng exception, không fallback/estimate
