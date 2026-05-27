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

## Phase 2 — Complete All 3 Agents + Real Routing UI ✅ HOÀN THÀNH (2026-05-27)
**Thời gian:** Tuần 2–3 (sau khi Phase 1 xong)
**Mục tiêu:** 3 agent hoạt động thật, polyline + Citymapper UI hoàn chỉnh

### Checklist — Agents

- [x] **Gemini:** wire `services/gemini.py` vào Planning Agent — `_resolve_via_gemini()` fallback khi place_id không có trong `_PLACES`
- [x] **Adaptation Agent — LTA:** test full flow: `poll_lta_alerts()` detect delay → insert alert (đã test trong `test_adaptation_agent.py`)
- [x] **Adaptation Agent — Weather:** test `poll_weather_alerts()`: rain > 70% → suggest indoor alternative (đã test)
- [x] **Adaptation Agent — Accept swap:** `POST /trips/{id}/accept-swap` → commit changes + resolve alert → 3 tests mới
- [x] **Memory Agent:** `learn_from_implicit()` test với ≥2 feedback records → verify preferences update (đã test)
- [x] `DisruptionSimulator` component: chỉ hiển thị trong development mode (`import.meta.env.DEV`)

### Checklist — Citymapper UI + Polyline

- [x] **OneMap geometry:** `get_route()` trả `geometry` từ `legGeometry.points` của transit leg chính
  - Nếu không có: `geometry = null`, TripMap vẽ straight line (fallback hoạt động)
- [x] **Backend:** `route_legs` schema có `geometry: str | None` và `instructions: list[str]` (Phase 0)
- [x] **Planning Agent:** populate `instructions` từ OneMap leg steps (`_build_pt_instructions()`)
- [x] **Frontend `TripMap.jsx`:** decode `@mapbox/polyline` khi `geometry != null` → `L.polyline()`
- [x] **Frontend `CitymapperTransitCard`:** render `instructions[]` dưới dạng timeline step list (đã có từ Phase 0)
- [x] Test: RouteCard với `geometry=null` + instructions expand behavior (2 tests mới)

---

## Phase 3 — UX Fixes & Data Integrity ⚠️ TRƯỚC KHI TESTING
**Thời gian:** Tuần 3 (ngay sau Phase 2, trước Phase 4 Testing)
**Mục tiêu:** Sửa 12 vấn đề UX/bug xác định sau review Phase 2 — đảm bảo app hoạt động đúng trước khi viết test

### Context
Sau Phase 2 (3 agents + polyline UI), review thực tế phát hiện các vấn đề ảnh hưởng trực tiếp đến user flow và data integrity. Testing mà chạy trên broken behavior sẽ tạo test debt — viết test sau khi sửa bug làm hỏng coverage đã có. Phase này dọn sạch 4 nhóm vấn đề: UI (6), Backend logic (2), Database/Auth (3), Data quality (1).

---

### Checklist — A: UI / Frontend

- [ ] **[A1] Nút xoá chuyến đi** — `frontend/src/pages/Home.jsx` `TripCard` không có nút xoá
  - Backend: thêm `DELETE /trips/{id}` endpoint vào `backend/app/routers/trips.py` — xoá khỏi `_trip_store`, `_trip_meta`, và Supabase (`trips`, `route_legs`, `trip_places`)
  - Frontend: confirm dialog trước khi xoá (dùng `components/ui/dialog.jsx`) → gọi `api.deleteTrip(id)` → xoá khỏi local trip list
  - Nếu user đang ở `/trip/:id` đang bị xoá → `navigate("/")`

- [ ] **[A2] Date range overflow trong TripCard** — `frontend/src/pages/Home.jsx` component `DestinationThumb`
  - Span chứa dateLabel thiếu `overflow-hidden whitespace-nowrap text-ellipsis max-w-*`
  - Fix: thêm `max-w-[160px] truncate` hoặc rút ngắn format (ví dụ "27–28 May" thay vì "27 May 2026–28 May 2026")
  - Verify trên viewport 375px

- [ ] **[A3] Header bar render 2 lần + logo 2 lần** — `frontend/src/App.jsx` + `frontend/src/pages/Home.jsx`
  - `App.jsx` render `<Header />` globally bên ngoài `<Routes>`; `Home.jsx` có thêm block `<header>` riêng bên trong trang với logo IMOVE lần 2
  - Fix: xoá inline `<header>` block trong `Home.jsx` — chỉ giữ `<main>` content
  - Verify trên `/`, `/plan`, `/trip/:id` — chỉ còn 1 header bar

- [ ] **[A4] Nút "Lưu chuyến đi" sau AI planning** — `frontend/src/pages/Planner.jsx`
  - Hiện tại `saveTrip()` được gọi ngầm và `navigate()` chạy ngay sau `planTrip()` thành công — user không confirm
  - Fix: sau khi `planTrip()` xong, lưu kết quả vào `planResult` state và hiển thị confirmation step (tên trip có thể edit, tóm tắt số ngày/điểm dừng, nút "Lưu & Xem lịch trình")
  - Chỉ khi user click mới gọi `saveTrip()` + `navigate()` — không cần thêm route mới

- [ ] **[A5] Thêm ảnh địa điểm** — `backend/app/data/places.json` + `frontend/src/components/planner/PlaceCard.jsx`
  - `places.json` không có field `image_url` — `PlaceCard` đang render placeholder gradient giả
  - Backend data: thêm `"image_url": "https://..."` vào tất cả 50 entries (dùng Wikimedia Commons / URL public domain cho Singapore attractions)
  - Backend model: thêm `image_url: str | None = None` vào `Place` model (`backend/app/models/place.py`) — không phải required field
  - Frontend: trong `PlaceCard.jsx` `ImageStrip()`, thay placeholder bằng `<img src={place.image_url} ...>` nếu có; giữ placeholder gradient làm fallback khi `image_url` là null

- [ ] **[A6] Map legend cho màu transport mode** — `frontend/src/components/map/TripMap.jsx`
  - `MODE_STYLE` định nghĩa 6 màu (MRT=indigo, LRT=violet, BUS=emerald, WALK=orange-dashed, DRIVE=purple, CYCLE=teal-dashed) nhưng không có legend
  - Fix: thêm absolute-positioned legend box (bottom-left của map container) render chỉ các modes thực sự xuất hiện trong `legs` prop — colored swatch + mode label
  - Style nhất quán với Tailwind (`bg-white rounded-lg shadow-sm text-xs p-2`)

---

### Checklist — B: Backend Logic

- [ ] **[B1] Smart transport recommendation theo user preferences** — `backend/app/agents/planning_agent.py`
  - `_primary_mode()` hiện lấy mode đầu tiên không phải WALK từ OneMap — bỏ qua hoàn toàn `prefs` (prefer_mrt, max_walk_minutes, budget_sgd) dù đã được pass vào `plan_trip()`
  - Fix (rule-based, không dùng Gemini):
    - Nếu `prefs.get("prefer_mrt") == False` và OneMap trả `MRT` → thử request lại với `mode=bus` hoặc đổi sang `BUS`
    - Nếu mode là `WALK` và `duration_minutes > prefs.get("max_walk_minutes", 20)` → upgrade lên `BUS`
    - Budget check: nếu tổng `cost_sgd` vượt `prefs.get("budget_sgd")` → cảnh báo trong `warnings[]` thay vì raise exception ngay

- [ ] **[B2] Verify change transport mode trong day plan detail tab** — `frontend/src/pages/Trip.jsx` → `frontend/src/components/planner/DayPlan.jsx`
  - `Trip.jsx` đã pass `tripId={id}` xuống `<DayPlan>` — OK
  - `DayPlan.jsx` dùng `TransitSegment` (có inline dropdown riêng), không dùng `RouteCard` (dialog-based)
  - Action: verify `TransitSegment` dropdown hoạt động end-to-end (gọi `api.updateLeg()`, cập nhật UI sau khi thành công)
  - Nếu không hoạt động: refactor `DayPlan.jsx` để render `RouteCard` thay `TransitSegment` cho consistency với edit dialog

---

### Checklist — C: Database / Auth

- [ ] **[C1] IDOR risk: `GET /trips/{id}` không check auth** — `backend/app/routers/trips.py`
  - Hiện tại handler `get_trip()` trả trip cho bất kỳ ai biết UUID — không kiểm tra user_id hay session
  - RLS trong Supabase protect DB calls, nhưng in-memory `_trip_store` bypass RLS hoàn toàn
  - Fix: inject `current_user = Depends(get_current_user_optional)` (tạo optional variant trong `backend/app/dependencies.py`) → nếu authenticated, verify `trip.user_id == current_user.id`; nếu guest, chỉ cho phép trip có `user_id IS NULL`

- [ ] **[C2] Guest trip mất sau server restart** — `supabase/migrations/` + `backend/app/routers/trips.py`
  - Migration 003 đã xoá `session_id` khỏi RLS → guest trip trong DB không accessible sau restart (in-memory đã mất)
  - Fix recommended: tạo `supabase/migrations/005_guest_session_rls.sql` — thêm lại policy cho guest trips: `USING (user_id IS NULL AND session_id = current_setting('app.session_id', true))`; backend SET session_id trước mỗi guest query
  - Fix alternative (simpler): persist guest trip vào localStorage full JSON làm fallback khi server không trả được

- [ ] **[C3] Cross-device login broken** — `frontend/src/lib/supabase.js`
  - Hiện tại `flowType: 'implicit'` lưu token trong URL hash và localStorage của browser — device B không thấy session của device A sau khi confirm email
  - Fix: đổi sang `flowType: 'pkce'` trong `createClient()` options
  - Verify: magic link confirm trên browser A → login thành công trên browser B (clean localStorage)
  - Đảm bảo Supabase dashboard → Auth → URL Configuration có đúng Redirect URLs (localhost:5173 + Vercel prod URL)

---

### Checklist — D: Data Quality

- [ ] **[D1] Hiển thị `distance_km` thật từ OneMap** — `backend/app/services/onemap.py` + `backend/app/models/trip.py` + `frontend/src/components/planner/TransitSegment.jsx`
  - OneMap trả `route_summary.total_distance` (walk/drive/cycle) và leg-level `distance` (PT) — hiện chưa extract hay trả về
  - Backend: thêm `"distance_km": round(summary.get("total_distance", 0) / 1000, 2)` vào return dict của `get_route()`
  - Model: thêm `distance_km: float | None = None` vào `LegResponse`
  - Frontend: dùng `leg.distance_km` trong `TransitSegment` thay vì ước tính từ duration
  - **Lưu ý:** `duration_minutes`, `fare_sgd`, `geometry`, `instructions` đều đã là real data từ OneMap API ✅ — `dwell_minutes` và `best_time_start/end` trong `places.json` là hardcoded estimates (known limitation, không fix trong phase này)

---

### Định nghĩa "Done" cho Phase 3

- [ ] Chạy app trên `/` → chỉ thấy 1 header bar, 1 logo
- [ ] Delete trip từ Home page với confirm dialog → trip biến mất khỏi list
- [ ] Date range trong TripCard không overflow trên màn hình 375px
- [ ] Sau AI planning → user thấy confirm step trước khi navigate sang trip page
- [ ] PlaceCard hiển thị ảnh thật (ít nhất 1 địa điểm không còn placeholder gradient)
- [ ] TripMap có legend giải thích màu cho các modes có trong chuyến đi
- [ ] Thay đổi `prefer_mrt=False` → backend chọn BUS thay MRT khi có thể
- [ ] `GET /trips/{id}` với JWT của user khác → trả 403
- [ ] Guest trip vẫn accessible sau server restart (hoặc fallback rõ ràng với thông báo)
- [ ] Đăng nhập bằng magic link trên device A → device B cũng đăng nhập được
- [ ] RouteCard/TransitSegment hiển thị `distance_km` thật

---

## Phase 4 — Testing & Quality
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

## Phase 5 — Production Deployment
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

## Phase 6 — Polish & Documentation
**Thời gian:** Tuần 4+
**Mục tiêu:** Production-grade quality, tài liệu đầy đủ cho giáo viên

### Checklist

- [ ] Lighthouse audit frontend: Performance ≥ 80, Accessibility ≥ 90, PWA ≥ 90 (on mobile)
- [ ] Remove `DisruptionSimulator` component khỏi production build hoàn toàn
- [ ] OpenAPI spec: export từ FastAPI `/docs` → lưu vào `docs/api.json`
- [ ] README: cập nhật với production URLs, demo screenshots, hướng dẫn cài PWA
- [ ] `docs/specs/`: review lại 3 files này, cập nhật nếu có thay đổi architecture

---

## Phase 7 — Future: Grab Deep Linking
**Thời gian:** Sau khi Phase 0–5 hoàn thành
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
4. ~~**3 agent chạy thật không?** → Phase 2~~ ✅ **Xong**
5. **UX/bug fixes trước testing?** → Phase 3 (12 vấn đề xác định sau review Phase 2)
6. **Deploy được chưa?** → Phase 5 (có thể làm trước Phase 4 nếu cần demo sớm)
7. **Tests xanh không?** → Phase 4
8. **Chất lượng tốt không?** → Phase 6

---

## Liên kết

- Mission & scope: [`mission.md`](./mission.md)
- Kiến trúc kỹ thuật: [`techstack.md`](./techstack.md)
- Business rules: [`../plans/business_rules.md`](../plans/business_rules.md)
