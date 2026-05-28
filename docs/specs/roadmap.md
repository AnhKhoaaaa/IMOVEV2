# Roadmap — IMOVEV2

> **Đọc trước khi bắt đầu Phase nào:** Theo CLAUDE.md, mọi thay đổi symbol phải chạy `gitnexus_impact()` trước, và chạy `gitnexus_detect_changes()` trước khi commit.

---

## Trạng thái hiện tại (snapshot 2026-05-27, sau Phase 6)

- Luồng E2E thông: `POST /trips` → `POST /trips/{id}/plan` → `GET /trips/{id}` → UI render ✅
- JWT auth đầy đủ; Memory Agent hoạt động; 3 agents (Planning, Adaptation, Memory) chạy thật ✅
- Smart day distribution 09:00–17:00 với transit time + opening hours ✅
- Interactive editing: optimize, add/delete place, drag-and-drop reorder ✅
- Per-user localStorage isolation ✅
- **Còn tồn tại:** bugs P5-BUG-1..6 và P6-BUG-1..6 chưa sửa (xem Phase 5 & 6)

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

### Bugs đã sửa (commit 96283a2)
- **[P5-BUG-1]** ✅ `_verify_user_ownership()` thêm vào cả 4 endpoints mới.
- **[P5-BUG-2]** ✅ `_ordered_place_ids` trả `[]` khi `legs=[]` (không crash, không dump all places); single-place days được bảo toàn qua `plan.places` fallback loop trong `add_place` và `reorder_places`.
- **[P5-BUG-3]** ✅ `add_place` trả 422 khi `body.day > num_days` thay vì silent clamp.
- **[P5-BUG-4]** ✅ `PATCH /reorder` validate `provided_ids == current_day_ids` trước khi ghi.
- **[P5-BUG-5]** ✅ Bare `except Exception` đổi thành `except (PlaceDataMissingError, NoRouteError, BudgetExceededError)` trên cả 4 endpoints.
- **[P5-BUG-6]** ✅ 23 tests mới cho 4 endpoints Phase 5 (ownership, validation, happy paths).

### Suggestions chưa làm
- **[P5-SUG-1]** `ReorderRequest.place_ids` nên `min_length=2`.
- **[P5-SUG-2]** Delete/drag catch errors nhưng không có user feedback khi fail.
- **[P5-SUG-3]** `setShowAddSearch(false)` trước `await addPlaceToDay` → nếu fail user không retry được.

---

## Phase 6 — Account Data Isolation ✅ (2026-05-27)

`tripsKey(userId)` → `'imove_trips_{userId}'` hoặc `'imove_trips_guest'`. Tương tự `tripDataKey(userId)`. `useSavedTrips(userId)` nhận userId prop. `onAuthStateChange` → reload đúng bucket. Logout → guest key; login → user key.

### Bugs chưa sửa
- **[P6-BUG-1] CRITICAL** — `handleSaveSetup` trong Trip.jsx gọi `api.saveTrip(id, merged)` thiếu `userId` → ghi vào guest bucket. Nên dùng `saveTrip` hook alias thay vì `api.saveTrip` trực tiếp.
- **[P6-BUG-2] CRITICAL** — `useTrip.js` cache (`cacheTripData`, `getCachedTripData`) không có `userId` → full itinerary của mọi user ghi vào `'imove_trip_data_guest'`. Fix: `useTrip(tripId, userId)`.
- **[P6-BUG-3] IMPORTANT** — Không có migration từ key cũ `'imove_trips'` → data loss cho existing users. Cần one-time migration trong App.jsx startup.
- **[P6-BUG-4] IMPORTANT** — Flash of empty state: `useState([])` + `useEffect` → 1 frame render empty trước khi trips load.
- **[P6-BUG-5]** Auth subscription duplicate trong Trip.jsx và Home.jsx. Nên extract `AuthContext`.
- **[P6-BUG-6]** Double-call `getSavedTrips` khi auth resolves trên Trip.jsx → flicker `savedMeta?.name`.

---

## Phase 7 — Testing & Quality
**Thời gian:** Tuần 5–6
**Mục tiêu:** Coverage đủ để tự tin deploy, PWA hoạt động

### Checklist

**Backend tests (pytest):**
- [ ] `tests/test_agents/test_planning_agent.py`: cover `_sort_places_greedy()`, `_distribute_days()` (với transit-aware signature mới), opening-hours validation, budget check, `NoRouteError`
- [ ] `tests/test_agents/test_adaptation_agent.py`: cover `_apply_weather_swap()`, `_reroute_mrt_legs()`, dedup logic
- [ ] `tests/test_services/test_onemap.py`: mock HTTP, cover success + `NoRouteError`
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

## Phase 8 — Production Deployment
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

## Phase 9 — Polish & Documentation
**Thời gian:** Tuần 6+
**Mục tiêu:** Production-grade quality, tài liệu đầy đủ cho giáo viên

### Checklist

- [ ] Lighthouse audit frontend: Performance ≥ 80, Accessibility ≥ 90, PWA ≥ 90 (on mobile)
- [ ] Remove `DisruptionSimulator` component khỏi production build hoàn toàn
- [ ] OpenAPI spec: export từ FastAPI `/docs` → lưu vào `docs/api.json`
- [ ] README: cập nhật với production URLs, demo screenshots, hướng dẫn cài PWA
- [ ] `docs/specs/`: review lại 3 files này, cập nhật nếu có thay đổi architecture

---

## Phase 10 — Future: Grab Deep Linking
**Thời gian:** Sau khi Phase 0–8 hoàn thành
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
2. ~~**Auth hoạt động không?** → Phase 1~~ ✅ **Xong**
3. ~~**3 agent chạy thật không?** → Phase 2~~ ✅ **Xong**
4. ~~**UX/bug fixes trước testing?** → Phase 3~~ ✅ **Xong**
5. ~~**Planning flow + smart scheduling?** → Phase 4~~ ✅ **Xong**
6. ~~**Itinerary editing?** → Phase 5~~ ✅ **Xong**
7. ~~**Account isolation?** → Phase 6~~ ✅ **Xong**
8. ~~**Sửa P5-BUG-1..6?**~~ ✅ **Xong** — còn P6-BUG-1,2,3 (critical)
9. **Deploy được chưa?** → Phase 8 (có thể làm trước Phase 7 nếu cần demo sớm)
10. **Tests xanh không?** → Phase 7
11. **Chất lượng tốt không?** → Phase 9

---

## Liên kết

- Mission & scope: [`mission.md`](./mission.md)
- Kiến trúc kỹ thuật: [`techstack.md`](./techstack.md)
- Business rules: [`../plans/business_rules.md`](../plans/business_rules.md)
