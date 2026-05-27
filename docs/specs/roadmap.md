# Roadmap — IMOVEV2

> **Đọc trước khi bắt đầu Phase nào:** Theo CLAUDE.md, mọi thay đổi symbol phải chạy `gitnexus_impact()` trước, và chạy `gitnexus_detect_changes()` trước khi commit.

---

## Trạng thái hiện tại (snapshot 2026-05-27, sau Phase 0)

- **Luồng E2E thông**: `POST /trips` → `POST /trips/{id}/plan` → `GET /trips/{id}` → UI render ✅
- `LegResponse` schema có `instructions: list[str]` và `geometry: str | None` ✅
- `CitymapperTransitCard` đọc `leg.instructions` — ẩn step section khi rỗng ✅
- JWT auth chưa wired → Memory Agent preferences trả 501
- Gemini chưa được gọi thực sự trong Planning Agent
- TripMap vẽ straight line (`geometry = null`), polyline thật chờ Phase 2
- **Smoke test thật với OneMap API**: chưa chạy — cần verify trước demo

---

## Phase 0 — E2E Demo Fix ✅ HOÀN THÀNH (2026-05-27)
**Mục tiêu:** 1 tính năng hoàn thiện để demo = trip creation end-to-end hoạt động

### Checklist

**Backend connectivity:**
- [x] Verify `.env` của backend có đủ: `onemap_email`, `onemap_password`, `lta_api_key`, `gemini_api_key`
- [ ] `backend/app/services/onemap.py`: smoke test `get_route()` với OneMap thật → **còn lại, chạy trước demo**

**Frontend-Backend wiring:**
- [x] `frontend/.env`: `VITE_API_BASE_URL=` (empty → Vite proxy, đúng cho dev)
- [x] `frontend/src/services/api.js`: tất cả calls dùng `VITE_API_BASE_URL`, không hardcode URL
- [x] `POST /trips` → backend nhận, tạo trip, trả `trip_id`
- [x] `POST /trips/{id}/plan` (với `place_ids[]`) → Planning Agent chạy, trả `TripPlan`
- [x] `GET /trips/{id}` → frontend nhận và render itinerary

**UI flow:**
- [x] `PlaceSearch` component: gọi thật `GET /places/curated`, không dùng mock data
- [x] `Planner` page: sau khi plan → hiển thị `days[]` với legs trên UI
- [x] `RouteCard` / `CitymapperTransitCard`: render đúng `transport_mode`, `duration_minutes`, `cost_sgd`

**Schema Citymapper/Polyline:**
- [x] Chốt JSON schema: mỗi leg có `instructions: string[]` và `geometry: string | null`
- [x] Backend trả `instructions: []` và `geometry: null` (Phase 2 sẽ fill real data)
- [x] Frontend `CitymapperTransitCard`: nếu `instructions` empty → ẩn step-by-step section
- [x] `TripMap.jsx`: `geometry = null` → vẽ straight line (behavior không thay đổi)

**Smoke test (manual — chưa chạy):**
- [ ] Tạo 1 trip: Marina Bay Sands → Gardens by the Bay → Sentosa, 2 ngày
- [ ] Kết quả: itinerary hiển thị trên UI với route legs, duration, cost
- [ ] Không có console error liên quan đến API calls

---

## Phase 1 — Authentication & User Flow ✅ HOÀN THÀNH (2026-05-27)
**Thời gian:** Tuần 2
**Mục tiêu:** JWT auth đầy đủ, Memory Agent hoạt động (unblock 501 endpoint)

### Context
Hiện tại `GET /alerts/preferences` trả 501 vì chưa có JWT middleware. `POST /alerts/feedback` nhận `user_id` từ request body (không an toàn). Memory Agent không hoạt động được cho logged-in user. Supabase Auth đã cấu hình sẵn (anon key có trong `.env`).

### Checklist

- [x] Backend: dependency function `get_current_user(token: str = Depends(oauth2_scheme))` → extract `user_id` từ Supabase JWT
- [x] `POST /alerts/feedback`: bỏ `user_id` từ request body, dùng JWT `user_id`
- [x] `GET /alerts/preferences`: remove 501, implement với JWT auth → trả preferences của user đang đăng nhập
- [x] `PATCH /trips/{id}/legs/{leg_id}`: đã verify bằng `session_id` (giữ nguyên) + log implicit feedback (đã có)
- [x] Frontend `AuthModal`: email/password + Magic Link (signInWithOtp) + Google OAuth (signInWithOAuth) hoạt động
- [x] Frontend: auth state persist sau page reload (Supabase `onAuthStateChange` đã có trong `lib/supabase.js`, verified)
- [x] Frontend: header hiển thị đúng tên user / avatar sau login (verified, đã hoạt động)

---

## Phase 2 — Complete All 3 Agents + Real Routing UI
**Thời gian:** Tuần 2–3 (sau khi Phase 1 xong)
**Mục tiêu:** 3 agent hoạt động thật, polyline + Citymapper UI hoàn chỉnh

### Checklist — Agents

- [ ] **Gemini:** wire `services/gemini.py` vào Planning Agent — dùng cho `parse_place_name()` khi tên địa điểm ambiguous
- [ ] **Adaptation Agent — LTA:** test full flow: `poll_lta_alerts()` detect delay → insert alert → frontend nhận qua Realtime WebSocket
- [ ] **Adaptation Agent — Weather:** test `poll_weather_alerts()`: rain > 70% → suggest indoor alternative → hiển thị trên `AlertBanner`
- [ ] **Adaptation Agent — Accept swap:** `POST /trips/{id}/accept-swap` → commit changes + resolve alert → UI cập nhật
- [ ] **Memory Agent:** `learn_from_implicit()` test với ≥2 feedback records → verify preferences được update trong `user_preferences` table
- [ ] `DisruptionSimulator` component: chỉ hiển thị trong development mode (`import.meta.env.DEV`)

### Checklist — Citymapper UI + Polyline

- [ ] **OneMap geometry:** kiểm tra response thực tế của `onemap.get_route()` có field `route_geometry` không
  - Nếu có: extract và populate `geometry` field trong leg response
  - Nếu không có (MRT/bus): `geometry = null`, fallback straight line (không block feature)
- [ ] **Backend:** `route_legs` schema bổ sung `geometry: str | None` và `instructions: list[str]`
- [ ] **Planning Agent:** populate `instructions` từ OneMap leg steps (turn-by-turn hoặc boarding instructions)
- [ ] **Frontend `TripMap.jsx`:** nếu `geometry != null`, decode encoded polyline → `L.polyline()` trên Leaflet
  - Xem xét thêm `@mapbox/polyline` hoặc `polyline` npm package nếu OneMap dùng Google encoding
- [ ] **Frontend `CitymapperTransitCard`:** render `instructions[]` dưới dạng timeline step list
- [ ] Test: trip với 3 địa điểm → map vẽ đường uốn lượn thực tế (ít nhất walking legs)

---

## Phase 3 — Testing & Quality
**Thời gian:** Tuần 3–4
**Mục tiêu:** Coverage đủ để tự tin deploy, PWA hoạt động

### Checklist

**Backend tests (pytest):**
- [ ] `tests/test_agents/test_planning_agent.py`: cover `_sort_places_greedy()`, `_distribute_days()`, budget check, `NoRouteError`
- [ ] `tests/test_agents/test_adaptation_agent.py`: cover `_apply_weather_swap()`, `_reroute_mrt_legs()`, dedup logic
- [ ] `tests/test_services/test_onemap.py`: mock HTTP, cover success + `NoRouteError`
- [ ] Target: ≥70% coverage cho `agents/` và `services/`

**Frontend tests (Vitest):**
- [ ] Cover 3 critical flows: (1) tạo trip, (2) xem trip với alerts, (3) accept swap
- [ ] `PlaceSearch`: test API call + render results
- [ ] `RouteCard`: test render với `geometry = null` và `geometry = "encoded_string"`

**E2E (Playwright):**
- [ ] Happy path: Home → Planner → tạo trip 3 địa điểm → xem itinerary trên Trip page
- [ ] Auth flow: login → tạo trip → logout → trip vẫn hiển thị (guest vs. auth)

**Load test:**
- [ ] 10 concurrent `POST /trips/{id}/plan` requests không timeout (< 30s)
- [ ] Render free tier: sau cold start, `/health` trả 200 trong < 5s

**PWA:**
- [ ] Thêm `vite-plugin-pwa` vào `vite.config.js`
- [ ] `manifest.json`: name, short_name, icons (192px + 512px), start_url, display=standalone
- [ ] Service worker: cache static assets, network-first cho API calls
- [ ] Verify installable: Chrome Android "Add to Home Screen" + Safari iOS "Add to Home Screen"

---

## Phase 4 — Production Deployment
**Thời gian:** Tuần 4
**Mục tiêu:** App chạy production, CI/CD tự động

### Checklist

**Backend (Render):**
- [ ] Deploy từ `main` branch, root directory = `backend/`
- [ ] Set env vars: `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`, `LTA_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FRONTEND_URL`
- [ ] Verify `GET /health` trả 200
- [ ] Set health check URL = `/health` trên Render dashboard (keepalive)

**Database (Supabase):**
- [ ] Tạo production Supabase project (tách khỏi dev project)
- [ ] Chạy `supabase/migrations/001_initial_schema.sql` trên production
- [ ] Verify Row-Level Security (RLS) policies đúng

**Frontend (Vercel):**
- [ ] Deploy từ `main` branch, root directory = `frontend/`
- [ ] Set env vars: `VITE_API_BASE_URL` (Render production URL), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- [ ] Verify production build không có TypeScript/ESLint errors

**CORS:**
- [ ] `FRONTEND_URL` trên Render = Vercel production URL (không trailing slash)

**CI/CD (GitHub Actions):**
- [ ] `.github/workflows/ci.yml`: chạy `pytest` + `npm test` trên mọi PR vào `main`
- [ ] Block merge nếu CI fail

**Smoke test production:**
- [ ] Tạo 1 trip thật trên production URL
- [ ] PWA installable trên phone thật

---

## Phase 5 — Polish & Documentation
**Thời gian:** Tuần 4+
**Mục tiêu:** Production-grade quality, tài liệu đầy đủ cho giáo viên

### Checklist

- [ ] Lighthouse audit frontend: Performance ≥ 80, Accessibility ≥ 90, PWA ≥ 90 (on mobile)
- [ ] Remove `DisruptionSimulator` component khỏi production build hoàn toàn
- [ ] OpenAPI spec: export từ FastAPI `/docs` → lưu vào `docs/api.json`
- [ ] README: cập nhật với production URLs, demo screenshots, hướng dẫn cài PWA
- [ ] `docs/specs/`: review lại 3 files này, cập nhật nếu có thay đổi architecture

---

## Phase 6 — Future: Grab Deep Linking
**Thời gian:** Sau khi Phase 0–4 hoàn thành
**Mục tiêu:** Taxi/rideshare integration qua Grab Deep Link — không cần Grab API key

### Luồng hoạt động

1. Planning Agent trả về leg với `transport_mode = "TAXI"` (khi không có public transit khả dụng)
2. Backend response leg bao gồm: `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`
3. Frontend `RouteCard.jsx`: hiển thị nút "Đặt xe qua Grab" khi `mode = TAXI`
4. Click → mở deep link trên mobile / fallback web trên desktop

### Deep Link format
```
grab://open?pickup[latitude]={lat}&pickup[longitude]={lng}&pickup[address]={name}&dropoff[latitude]={lat}&dropoff[longitude]={lng}&dropoff[address]={name}
```

### Checklist

- [ ] Backend: `route_legs` schema thêm `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng` (nullable, chỉ populated khi mode=TAXI)
- [ ] Frontend: `frontend/src/lib/grabDeepLink.js` — helper build URL từ coordinates
- [ ] Frontend `RouteCard.jsx`: `GrabButton` component (conditional render khi `mode = TAXI`)
- [ ] PWA: test deep link trên Chrome Android → Grab app mở với tọa độ pre-filled
- [ ] Fallback: nếu Grab chưa cài → `window.open("https://grab.com/sg/", "_blank")`
- [ ] Backend: không gọi Grab API — stateless, chỉ trả coordinates

---

## Ưu tiên khi bị overwhelm

Nếu không biết bắt đầu từ đâu, theo thứ tự này:

1. ~~**Luồng E2E thông không?** → Phase 0~~ ✅ **Xong**
2. **Smoke test thật với OneMap** → Chạy backend + frontend, tạo 1 trip thật trước demo
3. ~~**Auth hoạt động không?** → Phase 1 (JWT wiring + unblock 501)~~ ✅ **Xong**
4. **3 agent chạy thật không?** → Phase 2
5. **Deploy được chưa?** → Phase 4 (có thể làm trước Phase 3 nếu cần demo sớm)
6. **Tests xanh không?** → Phase 3
7. **Chất lượng tốt không?** → Phase 5

---

## Liên kết

- Mission & scope: [`mission.md`](./mission.md)
- Kiến trúc kỹ thuật: [`techstack.md`](./techstack.md)
- Business rules: [`../plans/business_rules.md`](../plans/business_rules.md)
