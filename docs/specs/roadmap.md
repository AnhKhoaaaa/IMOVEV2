# Roadmap — IMOVEV2

---

## Trạng thái hiện tại (snapshot 2026-05-28, sau Phase 6 — Phase 7+8 đang triển khai)

- Luồng E2E thông: `POST /trips` → `POST /trips/{id}/plan` → `GET /trips/{id}` → UI render ✅
- JWT auth đầy đủ; Memory Agent hoạt động; 3 agents (Planning, Adaptation, Memory) chạy thật ✅
- Smart day distribution 09:00–17:00 với transit time + opening hours ✅
- Interactive editing: optimize, add/delete place, drag-and-drop reorder ✅
- Per-user localStorage isolation đầy đủ — AuthContext, useTrip userId, migration, no flash ✅
- **Tất cả P5-BUG-1..6 và P6-BUG-1..6 đã sửa** ✅

---

## Phase 0 — E2E Demo Fix ✅ (2026-05-27)

Wired full trip creation flow. `LegResponse` schema có `instructions: list[str]` và `geometry: str | None`. `CitymapperTransitCard` ẩn step section khi instructions rỗng. `TripMap` vẽ straight line khi `geometry=null`.

---

## Phase 1 — Authentication & User Flow ✅ (2026-05-27)

JWT middleware `get_current_user` từ Supabase token. `/alerts/preferences` unblocked (501 removed). `/alerts/feedback` lấy `user_id` từ JWT thay vì request body. Supabase Auth: email/password, Magic Link (OTP), Google OAuth. Auth state persist qua `onAuthStateChange`.

---

## Phase 2 — Complete All 3 Agents + Real Routing UI ✅ (2026-05-27)

Gemini wired vào Planning Agent (`_resolve_via_gemini()` fallback). Adaptation Agent: LTA delay detection, Weather rain alert (>70%), accept-swap flow. Memory Agent: implicit feedback learning từ ≥2 records. OneMap `legGeometry.points` → polyline thật; `_build_pt_instructions()` populate `instructions[]`. `TripMap` decode `@mapbox/polyline` khi geometry != null. `DisruptionSimulator` chỉ hiện trong DEV mode.

---

## Phase 3 — UX Fixes & Data Integrity ✅ (2026-05-27)

12 fixes: `DELETE /trips/{id}` + confirm dialog. Date overflow trong TripCard. Header dedup (xoá inline `<header>` trong Home.jsx). Save-after-view confirm step (superseded bởi Phase 4). `image_url` vào 50 entries `places.json`. Map legend cho các transport modes. Smart transport theo `prefer_mrt`/`max_walk_minutes`/`budget_sgd`. IDOR fix: `GET /trips/{id}` trả 403 nếu user_id không khớp. Guest trip fallback vào localStorage. PKCE auth (`flowType: 'pkce'`). `distance_km` thật từ OneMap.

---

## Phase 4 — Planning Flow Overhaul & Smart Scheduling ✅ (2026-05-27)

Planner navigate thẳng vào Trip page sau plan (`pendingSave` qua `sessionStorage`, keyed by trip ID). Trip.jsx đọc `pendingSave` on mount → hiện nudge banner "Save →" trên mọi day tab. Smart `_distribute_days()`: simulate clock 09:00–17:00, tính transit time + opening hours. `_check_schedule_fit()` gọi Gemini khi overfull/underfull. Fixes P4-BUG-1..7 (route_durations fallback, dwell-aware opening-hours check, off-by-one, rate-limit lock, END_MIN grace period, sessionStorage persist, save banner visibility).

### Suggestions chưa làm
- **[P4-SUG-1]** `test_overfull_schedule_warning_in_result` là vacuous test.
- **[P4-SUG-2]** Manual mode hardcode `budget_sgd: 60` trong Planner.jsx:230.

---

## Phase 5 — Interactive Itinerary Editing ✅ (2026-05-27)

`POST /trips/{id}/optimize` re-run greedy sort + distribute. Add/delete place per day (`POST /places`, `DELETE /places/{id}`). Drag-and-drop reorder với `@dnd-kit` → `PATCH /reorder`. Frontend: Trash2 button, "Add place +" modal, SortableContext.

### Suggestions chưa làm
- **[P5-SUG-1]** `ReorderRequest.place_ids` nên `min_length=2`.
- **[P5-SUG-2]** Delete/drag catch errors nhưng không có user feedback khi fail.
- **[P5-SUG-3]** `setShowAddSearch(false)` trước `await addPlaceToDay` → nếu fail user không retry được.

---

## Phase 6 — Account Data Isolation ✅ (2026-05-27)

`tripsKey(userId)` → `'imove_trips_{userId}'` hoặc `'imove_trips_guest'`. Tương tự `tripDataKey(userId)`. `useSavedTrips(userId)` nhận userId prop. `onAuthStateChange` → reload đúng bucket. Logout → guest key; login → user key.
---

## Phase 7 — PT Sub-leg Detail
**Mục tiêu:** Surface dữ liệu board/alight/line thật từ OneMap qua đến UI — nền tảng cho mọi tính năng transit sau này

### Bối cảnh
OneMap trả về structured PT legs (tên ga lên/xuống, tên tuyến, stop code), nhưng `onemap.py` hiện tại flatten hết thành `instructions[]` văn bản thuần. `CitymapperTransitCard` đang hard-code `lineBadge: 'EW'` và `lineBadge: '7'` thay vì dùng dữ liệu thật.

### Checklist

**Backend:**
- [ ] `backend/app/models/trip.py`: thêm `PTSubLeg` model (`mode, route, from_name, to_name, from_stop_code, to_stop_code, duration_minutes, num_stops`)
- [ ] `backend/app/models/trip.py`: thêm `sub_legs: list[PTSubLeg] = []` vào `LegResponse`
- [ ] `backend/app/services/onemap.py`: thêm `_extract_sub_legs(legs)` — map `SUBWAY→MRT`, `TRAM→LRT`, extract `stopCode`
- [ ] `backend/app/services/onemap.py`: thêm `"sub_legs": _extract_sub_legs(itin_legs)` vào return dict của `get_route()` PT branch
- [ ] `backend/app/agents/planning_agent.py`: pass `sub_legs=route.get("sub_legs", [])` khi tạo `LegResponse`

**Frontend:**
- [ ] `CitymapperTransitCard.jsx`: derive `lineBadge` động từ `leg.sub_legs[first non-WALK].route` thay vì hard-code
- [ ] `CitymapperTransitCard.jsx`: render structured sub-leg rows khi `sub_legs` non-empty (WALK / MRT+line badge / BUS+line badge)
- [ ] Backward compat: fallback về `instructions[]` khi `sub_legs` rỗng (estimated legs)

---

## Phase 8 — Bus Arrivals + Route Comparison
**Mục tiêu:** Expose LTA bus arrivals realtime; so sánh PT/Walk/Cycle thật từ OneMap; thêm nút Taxi qua Grab deep link (placeholder, backend đầy đủ ở Phase 12)

### Bối cảnh
- `lta.get_bus_arrival()` đã implement xong nhưng chưa có endpoint API
- `TransitSegment.jsx` dropdown hiện tại dùng `duration * 0.4` fake để estimate drive time
- Drive mode bị thay bởi Taxi/Grab: frontend-only deep link, không cần backend duration

### Checklist

**Backend:**
- [ ] `backend/app/models/trip.py`: thêm `ModeResult` và `RouteComparison` models (pt, walk, cycle — không có drive)
- [ ] `backend/app/services/onemap.py`: thêm `get_all_routes()` — `asyncio.gather` 3 modes song song, `NoRouteError` → `available=False`
- [ ] `backend/app/routers/transit.py` (file mới): `GET /transit/bus-arrivals/{stop_code}` + `GET /transit/compare?from_lat=&from_lng=&to_lat=&to_lng=`
- [ ] `backend/app/main.py`: register `transit` router

**Frontend:**
- [ ] `frontend/src/services/api.js`: thêm `getBusArrivals(stopCode)` và `compareRoutes(fromLat, fromLng, toLat, toLng)`
- [ ] `frontend/src/components/transit/BusArrivalPanel.jsx` (file mới): hiển thị bus arrivals realtime, auto-refresh 30s, load indicator SEA/SDA/LSD
- [ ] `CitymapperTransitCard.jsx`: BUS sub-legs có `from_stop_code` → thêm nút "Live arrivals" mở `BusArrivalPanel`
- [ ] `frontend/src/components/planner/DayPlan.jsx`: pass `fromPlace` và `toPlace` props vào `TransitSegment`
- [ ] `TransitSegment.jsx`: khi mở dropdown → fetch `compareRoutes()` thật; show real durations + fares; thêm hàng "Taxi · Grab" với deep link `grab://open?...`; fallback về fake estimates nếu API fail

---

## Phase 9 — Testing & Quality
**Thời gian:** Tuần 5–6
**Mục tiêu:** Coverage đủ để tự tin deploy, PWA hoạt động

### Checklist

**Backend tests (pytest):**
- [ ] `tests/test_agents/test_planning_agent.py`: cover `_sort_places_greedy()`, `_distribute_days()` (với transit-aware signature mới), opening-hours validation, budget check, `NoRouteError`
- [ ] `tests/test_agents/test_adaptation_agent.py`: cover `_apply_weather_swap()`, `_reroute_mrt_legs()`, dedup logic
- [ ] `tests/test_services/test_onemap.py`: mock HTTP, cover success + `NoRouteError` + `sub_legs` extraction
- [ ] Target: ≥70% coverage cho `agents/` và `services/`

**Frontend tests (Vitest):**
- [ ] Cover 3 critical flows: (1) tạo trip, (2) xem trip với alerts, (3) accept swap
- [ ] `PlaceSearch`: test API call + render results
- [ ] `RouteCard`: test render với `geometry = null` và `geometry = "encoded_string"`

**E2E (Playwright):**
- [ ] Happy path: Home → Planner → tạo trip 3 địa điểm → navigate thẳng vào Day 1 → xem itinerary → Save từ Summary tab
- [ ] Auth flow: login → tạo trip → logout → login account khác → trip không hiển thị

**Load test:**
- [ ] 10 concurrent `POST /trips/{id}/plan` requests không timeout (< 30s)
- [ ] Render free tier: sau cold start, `/health` trả 200 trong < 5s

**PWA:**
- [ ] Thêm `vite-plugin-pwa` vào `vite.config.js`
- [ ] `manifest.json`: name, short_name, icons (192px + 512px), start_url, display=standalone
- [ ] Service worker: cache static assets, network-first cho API calls
- [ ] Verify installable: Chrome Android "Add to Home Screen" + Safari iOS "Add to Home Screen"

---

## Phase 10 — Production Deployment
**Thời gian:** Tuần 6
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

## Phase 11 — Polish & Documentation
**Thời gian:** Tuần 6+
**Mục tiêu:** Production-grade quality, tài liệu đầy đủ cho giáo viên

### Checklist

- [ ] Lighthouse audit frontend: Performance ≥ 80, Accessibility ≥ 90, PWA ≥ 90 (on mobile)
- [ ] Remove `DisruptionSimulator` component khỏi production build hoàn toàn
- [ ] OpenAPI spec: export từ FastAPI `/docs` → lưu vào `docs/api.json`
- [ ] README: cập nhật với production URLs, demo screenshots, hướng dẫn cài PWA
- [ ] `docs/specs/`: review lại 3 files này, cập nhật nếu có thay đổi architecture

---

## Phase 12 — Grab Deep Linking (Taxi Integration)
**Thời gian:** Sau khi Phase 0–10 hoàn thành
**Mục tiêu:** Taxi/rideshare integration đầy đủ qua Grab Deep Link — không cần Grab API key

### Bối cảnh
Phase 8 đã thêm nút "Taxi · Grab" trong `TransitSegment` như một placeholder deep link (không có backend duration estimate). Phase 12 hoàn thiện tích hợp: thêm OneMap drive mode để estimate thời gian + chi phí taxi, và di chuyển Grab helper vào `lib/`.

### Luồng hoạt động

1. Planning Agent trả về leg với `transport_mode = "TAXI"` (khi không có public transit khả dụng)
2. Backend response leg bao gồm: `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`
3. Frontend `TransitSegment`: hiển thị nút "Đặt xe qua Grab" với ETA từ OneMap drive mode
4. Click → mở deep link trên mobile / fallback web trên desktop

### Deep Link format
```
grab://open?pickup[latitude]={lat}&pickup[longitude]={lng}&pickup[address]={name}&dropoff[latitude]={lat}&dropoff[longitude]={lng}&dropoff[address]={name}
```

### Checklist

- [ ] Backend: thêm OneMap `drive` mode vào `get_all_routes()` → ETA + distance cho Taxi row
- [ ] Backend: `route_legs` schema thêm `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng` (nullable)
- [ ] Frontend: tách `buildGrabDeepLink()` từ `TransitSegment` ra `frontend/src/lib/grabDeepLink.js`
- [ ] Frontend `TransitSegment`: hiển thị ETA thật (từ OneMap drive) cạnh nút Grab
- [ ] PWA: test deep link trên Chrome Android → Grab app mở với tọa độ pre-filled
- [ ] Fallback: nếu Grab chưa cài → `window.open("https://grab.com/sg/", "_blank")`

---

## Ưu tiên khi bị overwhelm

Nếu không biết bắt đầu từ đâu, theo thứ tự này:

1. ~~**Luồng E2E thông không?** → Phase 0~~ ✅ **Xong**
2. ~~**Auth hoạt động không?** → Phase 1~~ ✅ **Xong**
3. ~~**3 agent chạy thật không?** → Phase 2~~ ✅ **Xong**
4. ~~**UX/bug fixes trước testing?** → Phase 3~~ ✅ **Xong**
5. ~~**Planning flow + smart scheduling?** → Phase 4~~ ✅ **Xong**
6. ~~**Itinerary editing?** → Phase 5~~ ✅ **Xong**
7. ~~**Account isolation?** → Phase 6~~ ✅ **Xong**
8. ~~**Sửa P5-BUG-1..6 và P6-BUG-1..6?**~~ ✅ **Xong**
9. **PT sub-leg detail + line badges thật?** → Phase 7
10. **Bus arrivals realtime + so sánh tuyến?** → Phase 8
11. **Deploy được chưa?** → Phase 10 (có thể làm trước Phase 9 nếu cần demo sớm)
12. **Tests xanh không?** → Phase 9
13. **Chất lượng tốt không?** → Phase 11

---

## Liên kết

- Mission & scope: [`mission.md`](./mission.md)
- Kiến trúc kỹ thuật: [`techstack.md`](./techstack.md)
- Business rules: [`../plans/business_rules.md`](../plans/business_rules.md)
