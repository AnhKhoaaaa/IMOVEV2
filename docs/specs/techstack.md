# Tech Stack — IMOVEV2

## Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────┐
│                  FRONTEND (Vercel)                   │
│  React 18 + Vite  │  Leaflet.js  │  Tailwind + Radix │
│  PWA (manifest + service worker)                     │
└──────────────┬──────────────────────────────────────┘
               │ HTTP / WebSocket
┌──────────────▼──────────────────────────────────────┐
│                  BACKEND (Render)                    │
│                 FastAPI + APScheduler                │
│  ┌─────────────────────────────────────────────┐    │
│  │              Agents (Business Logic)         │    │
│  │  Planning Agent │ Adaptation Agent │ Memory  │    │
│  └──────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────┐    │
│  │              Services (External APIs)        │    │
│  │  OneMap  │  LTA DataMall  │  OpenWeather     │    │
│  │  Gemini 2.5 Flash                            │    │
│  └──────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────────────┘
               │ Supabase SDK
┌──────────────▼──────────────────────────────────────┐
│              SUPABASE (managed)                      │
│  PostgreSQL  │  Auth (JWT)  │  Realtime WebSocket    │
└─────────────────────────────────────────────────────┘
```

---

## Backend

### FastAPI `(Python 3.11+)`
**Tại sao:** Async-first, type-safe qua Pydantic, auto-generates OpenAPI docs, phù hợp với agent pattern (mỗi endpoint delegate sang agent/service layer).

**Constraints:**
- Render Free hibernates sau 15 phút không có inbound traffic; `/health` là health/readiness endpoint, không phải cơ chế keepalive của Render
- Khi instance hibernates, APScheduler cũng dừng nên alert polling dưới 3 phút không được đảm bảo trên Free tier
- Nếu deploy Cloud Run mà vẫn giữ APScheduler in-process, phải dùng CPU always allocated + `min-instances=1`, `max-instances=1` để tránh job chạy trùng
- All logic nằm trong `agents/` và `services/`, router chỉ là HTTP layer
- CORS whitelist: `localhost:5173`, `localhost:5174`, `FRONTEND_URL` env var

### APScheduler
**Tại sao:** Cần background job để poll LTA alerts (2 phút) và weather (30 phút) mà không cần worker riêng. Chạy in-process với FastAPI lifespan.

**Constraints:**
- `poll_lta_alerts()`: chỉ query trips có `status = HAPPENING_TODAY` và có MRT legs → tránh N+1
- `poll_weather_alerts()`: per-trip failure không crash toàn bộ loop

### Pydantic v2
**Tại sao:** Schema validation + serialization cho tất cả API contracts. Models trong `backend/app/models/` là source of truth cho request/response shape.

---

## Frontend

### React 18.3.1 + Vite 5.4.10
**Tại sao:** React 18 có concurrent rendering; Vite có HMR nhanh hơn CRA/Webpack đáng kể.

**Entry point:** `App.jsx` — React Router với 3 routes:
- `/` → `Home` (dashboard trips)
- `/plan` → `Planner` (multi-step trip creation)
- `/trip/:id` → `Trip` (active trip view + alerts)

### Tailwind CSS 4 + Shadcn/Radix UI
**Tại sao:** Tailwind cho utility-first styling; Radix cung cấp accessible component primitives (Dialog, Tabs, Select) mà không cần custom ARIA logic.

### Leaflet.js 1.9.4 + react-leaflet 4.2.1
**Tại sao:** Open-source, không cần API key (khác Google Maps), tile từ OpenStreetMap. Đủ mạnh cho routing visualization Singapore.

**Rendering strategy:**
- Phase 0–1: vẽ straight line giữa các điểm nếu `geometry = null`
- Phase 2+: decode encoded polyline từ OneMap, vẽ đường thực tế uốn lượn

### PWA (Phase 3)
**Tại sao:** Cùng codebase React, không cần React Native. Có thể "cài" lên Android (Chrome) và iOS (Safari Add to Home Screen).

**Trạng thái hiện tại:** Chưa triển khai `vite-plugin-pwa`, manifest và service worker.

**Implementation đề xuất:** Vite PWA plugin → generate manifest + service worker; cache app shell/static assets, không cache chung dữ liệu trip/alert/transit cần độ mới cao.

**iOS install flow:** Safari → Share → Add to Home Screen → Open as Web App → Add. iOS cần hướng dẫn thủ công trong UI thay vì chỉ dựa vào install prompt của browser.

---

## Database & Auth

### Supabase (free tier)
**Tại sao:** Gộp Postgres + Auth + Realtime WebSocket + Row-Level Security trong 1 service, không cần tự vận hành database server. Free tier đủ cho prototype với ~10 concurrent users.

**Tables chính:**
- `trips` — metadata (status, budget, dates)
- `trip_places` — places thuộc trip
- `route_legs` — computed legs (transport_mode, duration, cost, is_estimated, geometry)
- `lta_alerts` — active alerts per trip
- `trip_feedback` — explicit + implicit user feedback
- `user_preferences` — learned preferences per user

**Realtime:** Frontend dùng Supabase Postgres Changes (WebSocket) để nhận adaptation alerts — không polling.

**Auth:** JWT-based. User ID phải được extract **server-side** từ JWT (không tin `user_id` từ request body — TODO: wiring đầy đủ trong Phase 1).

---

## LLM

### Gemini 2.5 Flash
**Tại sao:** Free tier đủ cho usecase (natural-language place name parsing, edge-case routing). Flash model nhanh hơn Pro cho tasks đơn giản.

**Constraints (cứng):**
- Rate limit: max 1 call / 4 giây (≤15 RPM) — guard đã có trong `services/gemini.py`
- Chỉ dùng cho: parse tên địa điểm ambiguous, xử lý edge case → **không dùng cho routing/cost/time**
- 75% code rule-based, 25% LLM — tỷ lệ này là design principle, không phải target đo được

---

## External APIs

| API | Mục đích | Giới hạn | Failure mode |
|-----|---------|---------|-------------|
| **OneMap (SLA)** | Geocoding + multi-modal routing (MRT/bus/walk) | Free, cần auth token (email/password) | `NoRouteError` → HTTP 422 |
| **LTA DataMall** | Real-time MRT/LRT disruptions, bus status | Free, cần API key | `LTAUnavailableError` → alert type "service_unavailable" |
| **OpenWeather** | 3-hour forecast, rain probability | 1000 calls/day (free) | `WeatherUnavailableError` → skip weather swap |
| **Grab Deep Link** | Mở Grab app với tọa độ pre-filled (Phase 6) | Stateless, không cần API key | Fallback: open `grab.com/sg/` in browser |

**Nguyên tắc:** Không có fallback estimate — mọi API failure đều raise typed exception, router trả explicit error response.

---

## Deployment

| Service | Platform | Notes |
|---------|---------|-------|
| Backend (demo) | Render | Free có cold start và dừng APScheduler khi sleep; paid always-on nếu cần alert liên tục |
| Backend (production) | Google Cloud Run + Cloud Scheduler | Tách LTA/weather polling khỏi web process để scale an toàn |
| Frontend/PWA | Vercel | Set `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; thêm SPA rewrite |
| Database | Supabase (managed) | Chạy `supabase/migrations/` trên production project |
| CI | GitHub Actions (Phase 4) | Lint + test on PR |

Hướng dẫn và so sánh chi tiết: [`deployment-pwa.md`](./deployment-pwa.md).

---

## Versions (pinned)

| Package | Version |
|---------|---------|
| Python | 3.11+ |
| FastAPI | từ `backend/requirements.txt` |
| React | 18.3.1 |
| Vite | 5.4.10 |
| React Router | 6.27.0 |
| Leaflet | 1.9.4 |
| react-leaflet | 4.2.1 |
| Tailwind CSS | 4.x |

Xem đầy đủ: `backend/requirements.txt` và `frontend/package.json`.

---

## Quyết định không thay đổi stack

Các quyết định này đã confirmed và **không nên thay đổi trong phạm vi dự án:**

1. **Không dùng Redux/Zustand** — React context + hooks đủ cho state complexity hiện tại
2. **Không dùng Google Maps** — Leaflet + OpenStreetMap tránh API key billing
3. **Không tự host database** — Supabase managed giảm ops burden
4. **Không dùng LLM cho routing** — Gemini chỉ cho NLP, không cho cost/time/mode
5. **Không React Native** — PWA đủ cho mobile requirement, giữ 1 codebase

---

## Liên kết

- Mission & scope: [`mission.md`](./mission.md)
- Lộ trình phát triển: [`roadmap.md`](./roadmap.md)
