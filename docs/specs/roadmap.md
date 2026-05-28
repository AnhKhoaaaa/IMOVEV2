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

## Phase 3 — UX Fixes & Data Integrity ✅ HOÀN THÀNH (2026-05-27)
**Thời gian:** Tuần 3 (ngay sau Phase 2, trước Phase 4 Testing)
**Mục tiêu:** Sửa 12 vấn đề UX/bug xác định sau review Phase 2 — đảm bảo app hoạt động đúng trước khi viết test

### Context
Sau Phase 2 (3 agents + polyline UI), review thực tế phát hiện các vấn đề ảnh hưởng trực tiếp đến user flow và data integrity. Testing mà chạy trên broken behavior sẽ tạo test debt — viết test sau khi sửa bug làm hỏng coverage đã có. Phase này dọn sạch 4 nhóm vấn đề: UI (6), Backend logic (2), Database/Auth (3), Data quality (1).

---

### Checklist — A: UI / Frontend

- [x] **[A1] Nút xoá chuyến đi** — `frontend/src/pages/Home.jsx` `TripCard` không có nút xoá
  - Backend: thêm `DELETE /trips/{id}` endpoint vào `backend/app/routers/trips.py` — xoá khỏi `_trip_store`, `_trip_meta`, và Supabase (`trips`, `route_legs`, `trip_places`)
  - Frontend: confirm dialog trước khi xoá (dùng `components/ui/dialog.jsx`) → gọi `api.deleteTrip(id)` → xoá khỏi local trip list
  - Nếu user đang ở `/trip/:id` đang bị xoá → `navigate("/")`

- [x] **[A2] Date range overflow trong TripCard** — `frontend/src/pages/Home.jsx` component `DestinationThumb`
  - Span chứa dateLabel thiếu `overflow-hidden whitespace-nowrap text-ellipsis max-w-*`
  - Fix: thêm `max-w-[160px] truncate` hoặc rút ngắn format (ví dụ "27–28 May" thay vì "27 May 2026–28 May 2026")
  - Verify trên viewport 375px

- [x] **[A3] Header bar render 2 lần + logo 2 lần** — `frontend/src/App.jsx` + `frontend/src/pages/Home.jsx`
  - `App.jsx` render `<Header />` globally bên ngoài `<Routes>`; `Home.jsx` có thêm block `<header>` riêng bên trong trang với logo IMOVE lần 2
  - Fix: xoá inline `<header>` block trong `Home.jsx` — chỉ giữ `<main>` content
  - Verify trên `/`, `/plan`, `/trip/:id` — chỉ còn 1 header bar

- [x] **[A4] Nút "Lưu chuyến đi" sau AI planning** — `frontend/src/pages/Planner.jsx`
  - Hiện tại `saveTrip()` được gọi ngầm và `navigate()` chạy ngay sau `planTrip()` thành công — user không confirm
  - Fix: sau khi `planTrip()` xong, lưu kết quả vào `planResult` state và hiển thị confirmation step (tên trip có thể edit, tóm tắt số ngày/điểm dừng, nút "Lưu & Xem lịch trình")
  - Chỉ khi user click mới gọi `saveTrip()` + `navigate()` — không cần thêm route mới

- [x] **[A5] Thêm ảnh địa điểm** — `backend/app/data/places.json` + `frontend/src/components/planner/PlaceCard.jsx`
  - `places.json` không có field `image_url` — `PlaceCard` đang render placeholder gradient giả
  - Backend data: thêm `"image_url": "https://..."` vào tất cả 50 entries (dùng Wikimedia Commons / URL public domain cho Singapore attractions)
  - Backend model: thêm `image_url: str | None = None` vào `Place` model (`backend/app/models/place.py`) — không phải required field
  - Frontend: trong `PlaceCard.jsx` `ImageStrip()`, thay placeholder bằng `<img src={place.image_url} ...>` nếu có; giữ placeholder gradient làm fallback khi `image_url` là null

- [x] **[A6] Map legend cho màu transport mode** — `frontend/src/components/map/TripMap.jsx`
  - `MODE_STYLE` định nghĩa 6 màu (MRT=indigo, LRT=violet, BUS=emerald, WALK=orange-dashed, DRIVE=purple, CYCLE=teal-dashed) nhưng không có legend
  - Fix: thêm absolute-positioned legend box (bottom-left của map container) render chỉ các modes thực sự xuất hiện trong `legs` prop — colored swatch + mode label
  - Style nhất quán với Tailwind (`bg-white rounded-lg shadow-sm text-xs p-2`)

---

### Checklist — B: Backend Logic

- [x] **[B1] Smart transport recommendation theo user preferences** — `backend/app/agents/planning_agent.py`
  - `_primary_mode()` hiện lấy mode đầu tiên không phải WALK từ OneMap — bỏ qua hoàn toàn `prefs` (prefer_mrt, max_walk_minutes, budget_sgd) dù đã được pass vào `plan_trip()`
  - Fix (rule-based, không dùng Gemini):
    - Nếu `prefs.get("prefer_mrt") == False` và OneMap trả `MRT` → thử request lại với `mode=bus` hoặc đổi sang `BUS`
    - Nếu mode là `WALK` và `duration_minutes > prefs.get("max_walk_minutes", 20)` → upgrade lên `BUS`
    - Budget check: nếu tổng `cost_sgd` vượt `prefs.get("budget_sgd")` → cảnh báo trong `warnings[]` thay vì raise exception ngay

- [x] **[B2] Verify change transport mode trong day plan detail tab** — `frontend/src/pages/Trip.jsx` → `frontend/src/components/planner/DayPlan.jsx`
  - `Trip.jsx` đã pass `tripId={id}` xuống `<DayPlan>` — OK
  - `DayPlan.jsx` dùng `TransitSegment` (có inline dropdown riêng), không dùng `RouteCard` (dialog-based)
  - Action: verify `TransitSegment` dropdown hoạt động end-to-end (gọi `api.updateLeg()`, cập nhật UI sau khi thành công)
  - Nếu không hoạt động: refactor `DayPlan.jsx` để render `RouteCard` thay `TransitSegment` cho consistency với edit dialog

---

### Checklist — C: Database / Auth

- [x] **[C1] IDOR risk: `GET /trips/{id}` không check auth** — `backend/app/routers/trips.py`
  - Hiện tại handler `get_trip()` trả trip cho bất kỳ ai biết UUID — không kiểm tra user_id hay session
  - RLS trong Supabase protect DB calls, nhưng in-memory `_trip_store` bypass RLS hoàn toàn
  - Fix: inject `current_user = Depends(get_current_user_optional)` (tạo optional variant trong `backend/app/dependencies.py`) → nếu authenticated, verify `trip.user_id == current_user.id`; nếu guest, chỉ cho phép trip có `user_id IS NULL`

- [x] **[C2] Guest trip mất sau server restart** — `supabase/migrations/` + `backend/app/routers/trips.py`
  - Migration 003 đã xoá `session_id` khỏi RLS → guest trip trong DB không accessible sau restart (in-memory đã mất)
  - Fix recommended: tạo `supabase/migrations/005_guest_session_rls.sql` — thêm lại policy cho guest trips: `USING (user_id IS NULL AND session_id = current_setting('app.session_id', true))`; backend SET session_id trước mỗi guest query
  - Fix alternative (simpler): persist guest trip vào localStorage full JSON làm fallback khi server không trả được

- [x] **[C3] Cross-device login broken** — `frontend/src/lib/supabase.js`
  - Hiện tại `flowType: 'implicit'` lưu token trong URL hash và localStorage của browser — device B không thấy session của device A sau khi confirm email
  - Fix: đổi sang `flowType: 'pkce'` trong `createClient()` options
  - Verify: magic link confirm trên browser A → login thành công trên browser B (clean localStorage)
  - Đảm bảo Supabase dashboard → Auth → URL Configuration có đúng Redirect URLs (localhost:5173 + Vercel prod URL)

---

### Checklist — D: Data Quality

- [x] **[D1] Hiển thị `distance_km` thật từ OneMap** — `backend/app/services/onemap.py` + `backend/app/models/trip.py` + `frontend/src/components/planner/TransitSegment.jsx`
  - OneMap trả `route_summary.total_distance` (walk/drive/cycle) và leg-level `distance` (PT) — hiện chưa extract hay trả về
  - Backend: thêm `"distance_km": round(summary.get("total_distance", 0) / 1000, 2)` vào return dict của `get_route()`
  - Model: thêm `distance_km: float | None = None` vào `LegResponse`
  - Frontend: dùng `leg.distance_km` trong `TransitSegment` thay vì ước tính từ duration
  - **Lưu ý:** `duration_minutes`, `fare_sgd`, `geometry`, `instructions` đều đã là real data từ OneMap API ✅ — `dwell_minutes` và `best_time_start/end` trong `places.json` là hardcoded estimates (known limitation, không fix trong phase này)

---

### Định nghĩa "Done" cho Phase 3

- [x] Chạy app trên `/` → chỉ thấy 1 header bar, 1 logo
- [x] Delete trip từ Home page với confirm dialog → trip biến mất khỏi list
- [x] Date range trong TripCard không overflow trên màn hình 375px
- [x] Sau AI planning → user thấy confirm step trước khi navigate sang trip page
- [x] PlaceCard hiển thị ảnh thật (ít nhất 1 địa điểm không còn placeholder gradient)
- [x] TripMap có legend giải thích màu cho các modes có trong chuyến đi
- [x] Thay đổi `prefer_mrt=False` → backend chọn BUS thay MRT khi có thể
- [x] `GET /trips/{id}` với JWT của user khác → trả 403
- [x] Guest trip vẫn accessible sau server restart (localStorage fallback đã hoạt động)
- [x] Đăng nhập bằng magic link trên device A → device B cũng đăng nhập được (PKCE)
- [x] RouteCard/TransitSegment hiển thị `distance_km` thật

---

## Phase 4 — Planning Flow Overhaul & Smart Scheduling ✅ HOÀN THÀNH (2026-05-27)
**Thời gian:** Tuần 4
**Mục tiêu:** Sửa antipattern lưu trước khi xem; phân bổ ngày thông minh theo khung 09:00–17:00 (bao gồm thời gian di chuyển và giờ mở cửa); cảnh báo LLM khi quá nhiều/ít địa điểm

### Context
Sau Phase 3, flow hiện tại lưu trip ngay sau khi planning xong — user không có cơ hội xem và điều chỉnh phương tiện trước khi lưu. Ngoài ra, `_distribute_days()` chỉ tính dwell time (cap 480 phút) mà không tính thời gian di chuyển hay giờ mở cửa, dẫn đến lịch không khả thi.

---

### Checklist — P4-A: Save-after-view flow

- [x] **`frontend/src/pages/Planner.jsx`**: Xoá `planResult` state và confirm-step render block. Sau khi `planTrip()` thành công, gọi `navigate('/trip/${tripId}', { state: { pendingSave: { name, startDate, numDays } } })` trực tiếp (cả `submitManual()` và `submitAI()`).
- [x] **`frontend/src/pages/Trip.jsx`**: Đọc `location.state?.pendingSave` on mount. Nếu có, hiển thị banner "Save Itinerary" ở Summary tab (hoặc sticky bottom bar). Click → `saveTrip(id, pendingSave)` → xoá pending state. Trip chưa lưu vẫn có thể xem/chỉnh transport mode.

### Checklist — P4-B: Smart day distribution (09:00–17:00 + opening hours)

- [x] **`backend/app/models/place.py`**: Thêm `opening_hours: Optional[str] = None`
- [x] **`backend/app/agents/planning_agent.py`**:
  - Thêm `_parse_opening_hours(s: str) -> tuple[int, int]` — parse "HH:MM-HH:MM" và "24h" → (open_min, close_min)
  - Rewrite `_distribute_days(places, num_days, route_durations: dict) -> list[list]` — simulate clock từ 09:00; add place to day nếu `arrival + dwell ≤ 17:00` AND arrival nằm trong opening_hours; nếu không → thử ngày tiếp theo; nếu không còn ngày → add warning
  - Trong `plan_trip()`: build `route_durations` dict `{(from_id, to_id): duration_min}` từ routes đã fetch, truyền vào `_distribute_days()`
- [x] **`backend/tests/test_agents/test_planning_agent.py`**: Cập nhật `test_distribute_days_splits_correctly` (signature mới); thêm test transit-aware distribution và opening-hours validation

### Checklist — P4-C: LLM over/under-fill warning

- [x] **`backend/app/agents/planning_agent.py`**: Thêm `_check_schedule_fit(days_schedule, route_durations) -> tuple[str|None, str]` — phát hiện overfull (end > 17:30) hoặc underfull (total < 4h); nếu có issue → gọi Gemini
- [x] **`backend/app/services/gemini.py`**: Thêm `generate_schedule_warning(days_summary: list, issue_type: str) -> str` — dùng existing rate-limit guard; trả về cảnh báo tự nhiên với số ngày cụ thể
- [x] Test: mock Gemini, verify warning xuất hiện trong `result.warnings` khi overfull

### Định nghĩa "Done" cho Phase 4

- [x] Plan trip → navigate thẳng vào Day 1 tab (không qua confirm step)
- [x] Summary tab hiện nút "Save Itinerary" khi trip chưa được lưu
- [x] Trip với 10 địa điểm, 2 ngày → phân bổ đúng theo 09:00–17:00 với transit time
- [x] Place có opening_hours "07:00-10:00" không được xếp vào buổi chiều
- [x] Khi nhét quá nhiều địa điểm → `result.warnings` có cảnh báo từ Gemini

### Bugs phát hiện qua code review — chưa sửa

> Phát hiện 2026-05-27 sau code review tự động (3 subagents).

**Critical:**
- [x] **[P4-BUG-1] `_distribute_days` dùng fallback 15 phút cho pair thiếu trong `route_durations`** — Fixed: after `_distribute_days`, `plan_trip` on-demand fetches any pairs created by best-effort reassignment and updates `route_durations` before passing to `_check_schedule_fit`.
- [x] **[P4-BUG-2] Opening-hours check không tính dwell time** — Fixed: condition changed from `oh_open <= arrival <= oh_close` to `oh_open <= arrival and (arrival + dwell) <= oh_close`. Test: `test_opening_hours_check_includes_dwell_time`.
- [x] **[P4-BUG-3] Off-by-one trong best-effort fallback** — Fixed: `prev_id` is now computed before `days[best_day].append(place)`, eliminating the fragile `[-2]` index.

**Important:**
- [x] **[P4-BUG-4] `_RATE_LIMIT_LOCK` giữ lock qua `asyncio.sleep`** — Fixed: extracted `_rate_limit()` helper using slot-reservation pattern; lock released before sleep. Test: `test_rate_limit_lock_not_held_during_sleep`.
- [x] **[P4-BUG-5] `END_MIN=1020` (17:00) vs `1050` (17:30) trong `_check_schedule_fit`** — Fixed: added comment explaining 30-min grace period; added 3 boundary-zone tests (17:00, 17:30, 17:31).
- [x] **[P4-BUG-6] `pendingSave` bị mất khi user refresh trang** — Fixed: `pendingSave` persisted to `sessionStorage` keyed by trip ID on Planner→Trip navigation; cleared on save.
- [x] **[P4-BUG-7] Save banner invisible khi arrive từ Planner** — Fixed: nudge banner with "Save →" button shown on every day tab when `pendingSave` is set; clicking jumps to Summary tab.

**Suggestions:**
- [ ] **[P4-SUG-1]** `test_overfull_schedule_warning_in_result` là vacuous test — không assert warning string, chỉ check `result.warnings` là list. Cần controlled dwell data để guarantee overfull.
- [ ] **[P4-SUG-2]** Manual mode hardcode `budget_sgd: 60` trong `Planner.jsx:230` — AI mode dùng pace-based budget (35/60/100). Nên đồng nhất.

---

## Phase 5 — Interactive Itinerary Editing ✅ HOÀN THÀNH (2026-05-27)
**Thời gian:** Tuần 4–5
**Mục tiêu:** Cho phép user tái cấu trúc lịch sau khi xem: tối ưu global, thêm/xoá địa điểm theo ngày, kéo-thả sắp xếp lại

### Context
Sau Phase 4, user thấy lịch trước khi lưu. Phase này cho phép họ chỉnh sửa cấu trúc (thêm/xoá/sắp xếp địa điểm) mà không cần lập lịch lại từ đầu. "Optimize Route" chuyển thành global action ở Overview tab.

---

### Checklist — P5-A: Global Optimize Route (Overview tab)

- [x] **`backend/app/routers/trips.py`**: Thêm `POST /{trip_id}/optimize` — đọc plan hiện tại, re-run `_sort_places_greedy()` + `_distribute_days()` với place list hiện có, cập nhật `_trip_store`, trả về `TripPlan` mới
- [x] **`frontend/src/services/api.js`**: Thêm `optimizeRoute: (id) => request('/trips/${id}/optimize', { method: 'POST' })`
- [x] **`frontend/src/pages/Trip.jsx`**: Thêm nút "Optimize Route" (với loading state) vào Overview tab; on success → `refresh()`

### Checklist — P5-B: Add/Delete place per day (thay thế per-day optimize)

- [x] **`frontend/src/components/planner/DayPlan.jsx`**: Xoá nút "Optimize route" (`<RotateCcw>`) hiện không hoạt động; thêm `<Trash2>` button trên mỗi place item; thêm "Add place +" button cuối mỗi ngày (mở `PlaceSearch` modal)
- [x] **`backend/app/routers/trips.py`**:
  - `DELETE /{trip_id}/places/{place_id}` — xoá place khỏi plan, tính lại legs cho ngày đó
  - `POST /{trip_id}/places` body `{ place_id, day }` — chèn place vào ngày chỉ định, fetch route legs với hàng xóm
- [x] **`frontend/src/services/api.js`**: Thêm `addPlaceToDay`, `removePlaceFromDay`

### Checklist — P5-C: Drag-and-drop reordering

- [x] **`frontend/package.json`**: Thêm `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- [x] **`frontend/src/components/planner/DayPlan.jsx`**: Bọc place timeline items trong `<SortableContext>` + `useSortable()`; on drag-end → `api.reorderPlaces(tripId, day, newPlaceIds)`
- [x] **`backend/app/routers/trips.py`**: `PATCH /{trip_id}/reorder` body `{ day: int, place_ids: list[str] }` — tính lại legs theo thứ tự mới
- [x] **`frontend/src/services/api.js`**: Thêm `reorderPlaces: (tripId, day, placeIds) => request(...)`
- [ ] (Phase 5.2 optional) Cross-day drag: kéo place sang ngày khác — `PATCH /{trip_id}/move-place` body `{ place_id, from_day, to_day, position }`

### Định nghĩa "Done" cho Phase 5

- [x] Click "Optimize Route" ở Overview → days re-render với thứ tự tối ưu mới
- [x] Xoá 1 địa điểm khỏi Day 2 → legs của Day 2 cập nhật (leg nối 2 địa điểm xung quanh)
- [x] Thêm địa điểm mới vào Day 1 → leg mới xuất hiện
- [x] Kéo địa điểm lên trên → legs tính lại theo thứ tự mới

### Bugs phát hiện qua code review — chưa sửa

> Phát hiện 2026-05-27 sau code review tự động (3 subagents).

**Critical:**
- [ ] **[P5-BUG-1] 4 endpoints mới thiếu ownership check** — `trips.py:207-388`. `/optimize`, `POST /places`, `DELETE /places/{id}`, `PATCH /reorder` không gọi `_verify_session_ownership`. Bất kỳ caller biết `trip_id` UUID đều có thể ghi đè plan người khác. Các endpoint cũ (`adapt_trip`, `update_location`) đã có guard này.
- [ ] **[P5-BUG-2] `_ordered_place_ids` crash + logic sai** — `trips.py:515-525`. (a) `IndexError` khi `legs=[]` VÀ `places=[]` vì code access `places[0]`. (b) Hàm nhận `plan.places` (toàn bộ trip) thay vì places của 1 ngày → fallback path trả về **tất cả** places của trip, corrupt day map cho add/reorder operations.

**Important:**
- [ ] **[P5-BUG-3] `day` out-of-range bị clamp ngầm** — `trips.py:309`. `min(body.day, num_days)` silently clamp thay vì trả 422 với message rõ ràng. `AddPlaceRequest` có `ge=1` nhưng không có upper bound.
- [ ] **[P5-BUG-4] `PATCH /reorder` không validate place_ids thuộc đúng ngày** — `trips.py:362`. Nếu client gửi IDs từ ngày khác hoặc IDs giả, `days_map[body.day]` bị replace; plan_trip redistribute theo corrupted order. Cũng: nếu client gửi subset của place_ids → các places còn lại bị xóa ngầm khỏi ngày đó.
- [ ] **[P5-BUG-5] Bare `except Exception` trên 4 endpoints** — `trips.py:231` và tương đương. Convert tất cả exceptions (kể cả 500 errors) thành 422 với `str(e)`. Endpoint `/plan` xử lý đúng với specific exception types — cần replicate.
- [ ] **[P5-BUG-6] Zero test cho 4 endpoint Phase 5** — Không có test nào cho optimize, add place, delete place, reorder. Đặc biệt cần test: 2-place minimum enforcement khi delete, out-of-range day, reorder với subset IDs, `_ordered_place_ids` edge cases.

**Suggestions:**
- [ ] **[P5-SUG-1]** `ReorderRequest.place_ids` có `min_length=1` → nên là `min_length=2` (reorder 1 place là no-op).
- [ ] **[P5-SUG-2]** Delete button và `handleDragEnd` catch errors với empty catch block → user không có feedback khi operation fail.
- [ ] **[P5-SUG-3]** Add-place flow: `setShowAddSearch(false)` trước `await api.addPlaceToDay(...)` → nếu fail, panel đã đóng, user không thể retry.

---

## Phase 6 — Account Data Isolation ✅ HOÀN THÀNH (2026-05-27)
**Thời gian:** Tuần 5
**Mục tiêu:** Mỗi tài khoản có kho lưu trữ itinerary riêng; đăng nhập tài khoản khác không thấy trip của tài khoản cũ

### Context
`api.js` dùng key cố định `'imove_trips'` cho tất cả user → toàn bộ trip của mọi người dùng trên cùng browser bị trộn lẫn. Backend đã isolate bằng `user_id` + JWT; frontend cần theo.

---

### Checklist — P6-A: Per-user localStorage key

- [x] **`frontend/src/services/api.js`**:
  - Thay `TRIPS_KEY = 'imove_trips'` bằng function `tripsKey(userId) => userId ? 'imove_trips_${userId}' : 'imove_trips_guest'`
  - Tương tự cho `TRIP_DATA_KEY`: `tripDataKey(userId)`
  - Tất cả `getSavedTrips`, `saveTrip`, `deleteSavedTrip`, `getCachedTripData`, `cacheTripData` nhận thêm param `userId?: string`
- [x] **`frontend/src/hooks/useSavedTrips.js`**: Nhận `userId` prop; truyền xuống tất cả `api.*` calls
- [x] **`frontend/src/pages/Home.jsx`**: Truyền `authUser?.id` vào `useSavedTrips(authUser?.id)`; `onAuthStateChange` → `reload()` tự động load đúng kho của user mới

### Checklist — P6-B: Auth state change cleanup

- [x] Khi logout (event `SIGNED_OUT`) → `useSavedTrips` reload với `userId=null` (guest key) — trips của user cũ tự ẩn, không bị xoá
- [x] Khi login (event `SIGNED_IN`) → reload với `userId` mới — chỉ thấy trips của user đó
- [x] Verify: login A → lưu 2 trips → logout → login B → trip list rỗng → logout → login A → 2 trips còn nguyên

### Định nghĩa "Done" cho Phase 6

- [x] Login user A, lưu trip X → logout → login user B → Home page không có trip X
- [x] Logout → Home page hiển thị guest trips (key khác)
- [x] Login lại user A → trip X xuất hiện trở lại

### Bugs phát hiện qua code review — chưa sửa

> Phát hiện 2026-05-27 sau code review tự động (3 subagents).

**Critical:**
- [ ] **[P6-BUG-1] `handleSaveSetup` gọi `api.saveTrip(id, merged)` thiếu `userId`** — `Trip.jsx`. Ghi vào `'imove_trips_guest'` thay vì user bucket. `useSavedTrips` đã có `save` callback closes over `authUserId` — nên dùng `saveTrip(id, merged)` (hook alias) thay vì `api.saveTrip` trực tiếp.
- [ ] **[P6-BUG-2] `useTrip.js` cache không isolated** — `useTrip.js:22,27,45,48` + `Home.jsx:89`. `cacheTripData` và `getCachedTripData` gọi không có `userId` → toàn bộ offline cache (full itinerary: legs, costs, transport modes) ghi vào `'imove_trip_data_guest'` cho mọi user. User B có thể đọc itinerary của User A qua offline fallback path. Fix: `useTrip(tripId, userId)`, thread userId qua 4 call sites; `TripCard` nhận `userId` từ Home.
- [ ] **[P6-BUG-3] Không có migration từ key cũ `'imove_trips'`** — Data loss cho tất cả existing users sau upgrade. Cần one-time migration trong `App.jsx` startup: copy `'imove_trips'` → `'imove_trips_guest'` nếu chưa có guest key; tương tự cho `'imove_trip_data'` → `'imove_trip_data_guest'`.

**Important:**
- [ ] **[P6-BUG-4] Flash of empty state** — `useSavedTrips.js:6-17`. Init `useState([])` + `useEffect` → 1 frame render empty trước khi trips load. Old lazy-init pattern tránh điều này; cần middle-path: init đồng bộ với null key, reload khi authUserId resolve.
- [ ] **[P6-BUG-5] Auth subscription duplicated trong Trip.jsx và Home.jsx** — Mỗi page tự subscribe `supabase.auth.onAuthStateChange`. Cleanup đúng (không leak) nhưng scale kém khi có page thứ 3+. Nên extract `AuthContext` dùng chung.
- [ ] **[P6-BUG-6] Double-call `getSavedTrips` khi auth resolves trên Trip.jsx** — `Trip.jsx:71-102`. Mount với `authUserId=null` → `savedMeta` effect đọc guest key, set null. Auth resolves → `savedMeta` effect chạy lại với user key. Hai localStorage reads + hai `setSavedMeta` calls → flicker trên `savedMeta?.name`. Fix: init savedMeta bên trong `.then()` callback của getSession.

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
2. **Smoke test thật với OneMap** → Chạy backend + frontend, tạo 1 trip thật trước demo
3. ~~**Auth hoạt động không?** → Phase 1 (JWT wiring + unblock 501)~~ ✅ **Xong**
4. ~~**3 agent chạy thật không?** → Phase 2~~ ✅ **Xong**
5. ~~**UX/bug fixes trước testing?** → Phase 3 (12 vấn đề xác định sau review Phase 2)~~ ✅ **Xong**
6. **Planning flow + smart scheduling?** → Phase 4 (save-after-view + 09:00–17:00 distribution)
7. **Itinerary editing?** → Phase 5 (optimize route global, add/delete/drag)
8. **Account isolation?** → Phase 6 (per-user localStorage)
9. **Deploy được chưa?** → Phase 8 (có thể làm trước Phase 7 nếu cần demo sớm)
10. **Tests xanh không?** → Phase 7
11. **Chất lượng tốt không?** → Phase 9

---

## Liên kết

- Mission & scope: [`mission.md`](./mission.md)
- Kiến trúc kỹ thuật: [`techstack.md`](./techstack.md)
- Business rules: [`../plans/business_rules.md`](../plans/business_rules.md)
