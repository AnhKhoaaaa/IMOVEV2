# Plan: Trợ lý Chatbot LLM (Gemini + Vertex AI) cho IMOVEV2

## Context

IMOVEV2 đã có đầy đủ API để lập + sửa lịch trình (thêm/xoá/đổi thứ tự địa điểm, đổi
phương tiện, điều hướng theo GPS), nhưng người dùng phải tự thao tác qua UI. Mục tiêu:
thêm **một chatbot LLM** hiểu ngôn ngữ tự nhiên (Việt/Anh), **tư vấn** dựa trên dataset
địa điểm, và **đề xuất** chỉnh sửa lịch trình — nhưng **không tự ý ghi**: mọi hành động
ghi đi qua **xác nhận 2 bước**.

Kế hoạch này **bỏ qua `docs/plans/dev10_chatbot.md`** (kiến trúc cũ: backend stateless,
FE tự gọi lại REST). Thay vào đó dùng các quyết định đã chốt với người dùng:

| Hạng mục | Quyết định |
|---|---|
| Gọi tool | **In-process** — agent gọi thẳng hàm Python/route-handler, không tự gọi HTTP |
| Migrate LLM | **gemini.py sang Vertex theo cờ** — `vertexai=True` khi bật cờ, ngược lại fallback `api_key` |
| Cơ chế ghi | **Xác nhận 2 bước, server-side** — agent tạo *pending action*, user bấm xác nhận thì mới thực thi |
| Lưu hội thoại | **In-memory th
eo `session_id`** (giống `_pending_swaps`, mất khi restart) |
| Nguồn lời khuyên | **Chỉ dataset curated** (`singapore_places.json`) — không bịa địa điểm thiếu `place_id` |
| GPS | **Có gửi** `{lat,lng}` từ `useGeolocation` để xử lý "Tôi bị lạc" |
| UI | **Widget chat nổi toàn cục** (Tailwind + Radix + Lucide), tự trả lời theo ngôn ngữ user |

**Phạm vi thao tác (chốt):** (1) sửa trip hiện có — thêm/xoá/đổi thứ tự địa điểm, đổi
phương tiện, đổi tuyến khi lạc (GPS); (2) cấp ngày & tối ưu — thêm/bớt ngày, optimize;
(3) xem cảnh báo/thời tiết (read-only). **Tất cả thao tác ghi đều dùng endpoint đã có —
không tạo endpoint ghi mới.** Cảnh báo không có hàm trả nội dung sẵn → tool đọc query bảng
`lta_alerts` (Supabase, read-only) + có thể trigger `check_alerts_for_trip`.

> **Đính chính dataset:** runtime nạp `backend/app/data/singapore_places.json` (~499 POI)
> ở `routers/places.py:11` và `planning_agent.py:26`. File `places.json` (~50 POI) là file
> chết. "Curated dataset" = `singapore_places.json`.

> **Lưu ý repo:** đây đúng là IMOVEV2 (khớp `github.com/AnhKhoaaaa/IMOVEV2`), nhưng bản local
> đi sau remote ~2 commit và **chưa có git remote**. Cân nhắc thêm remote + fetch trước khi code.

---

## ⚠️ Đính chính sau review (đọc code thật — các điểm bản plan trước đã SAI)

Bản plan trước giả định sai một số chữ ký handler. Những điểm dưới đây đã được **xác minh
trực tiếp trong `routers/trips.py`** và là cơ sở cho thiết kế confirm-dispatcher bên dưới:

1. **`update_leg` (`trips.py:181`) và `switch_leg_now` (`trips.py:267`) KHÔNG nhận
   `current_user` và KHÔNG gọi `_verify_user_ownership`.** Chúng cũng trả **`LegSwapResult`**,
   không phải `TripPlan`. → Không thể tin "handler tự lo ownership" cho 2 tool này.
2. **`remove_place` (`trips.py:538`) không có `return`** → trả `None`. Phải `get_trip` sau đó.
3. Chỉ `add_place / remove_place / reorder_places / add_day / remove_day / optimize_trip`
   mới tự verify ownership (`trips.py:404, 461, 495, 548, 598, 677`).
4. **Mọi tool ghi (trừ 2 leg-switch) gọi lại `planning_agent.plan_trip` → fetch route OneMap
   thật** → chậm (vài–vài chục giây) và có thể raise `NoRouteError / PlaceDataMissingError /
   BudgetExceededError` → handler convert thành `HTTPException(422)`. Confirm **phải bắt** lỗi này.
5. **`config.py:12` ép `gemini_api_key: str` (required)** và `gemini.py:9` khởi tạo client
   ngay khi import → bật Vertex vẫn buộc set api key giả. Phải nới Optional.
6. **`gemini.py` có HAI cơ chế rate-limit:** `_rate_limit()` (3 hàm dùng) **và** một khối lock
   inline riêng trong `suggest_places` (`gemini.py:184–188`). Refactor Vertex phải biết cả hai.
7. Frontend refresh thật là `refresh` từ `useTrip(id, …)` (**`Trip.jsx:829`**), không phải dòng
   1504 (đó chỉ là render `<AlertBanner onAdapted={refresh}>`).

**Nguyên tắc bảo mật (mới):** `/chat/confirm` **tự gọi `_verify_user_ownership(trip_id,
current_user)` cho MỌI tool ghi** TRƯỚC khi dispatch — không tin từng handler tự lo, vì
2 handler leg-switch không lo. Đây là một dòng phòng vệ tập trung, vẫn không nhân đôi logic.

---

## Backend

### 1. `config.py` (+ `.env.example`) — bật Vertex + nới api key
Sửa `config.py:12` — `gemini_api_key` thành **Optional** để Vertex không buộc api key:
```python
gemini_api_key: Optional[str] = None        # bắt buộc khi KHÔNG dùng Vertex (validate ở client init)
```
Thêm sau `config.py:37`:
```python
google_genai_use_vertexai: bool = False     # GOOGLE_GENAI_USE_VERTEXAI
google_cloud_project: Optional[str] = None  # GOOGLE_CLOUD_PROJECT
google_cloud_location: Optional[str] = None # GOOGLE_CLOUD_LOCATION
chat_model: str = "gemini-2.5-flash"        # CHAT_MODEL
```
`.env.example`: thêm 4 biến trên + `GOOGLE_APPLICATION_CREDENTIALS=` (SDK đọc trực tiếp từ env,
không cần field Settings). Ghi chú: khi `GOOGLE_GENAI_USE_VERTEXAI=true` thì `GEMINI_API_KEY`
có thể để trống.

### 2. `services/gemini.py` — client linh hoạt + hàm chat
- **Thay `gemini.py:9`** bằng init theo cờ:
  - `genai.Client(vertexai=True, project=settings.google_cloud_project, location=settings.google_cloud_location)`
    nếu `settings.google_genai_use_vertexai`;
  - ngược lại: nếu `settings.gemini_api_key` rỗng → raise `RuntimeError` rõ ràng
    ("Set GEMINI_API_KEY hoặc bật GOOGLE_GENAI_USE_VERTEXAI"); else `genai.Client(api_key=…)`.
  - Giữ nguyên toàn bộ hàm hiện có + **cả hai** cơ chế rate-limit: `_rate_limit()`/`_RATE_LIMIT_LOCK`
    **và** khối lock inline trong `suggest_places` (`gemini.py:184–188`). Test patch `_client` sau
    init nên trong suốt với refactor (tên `_client` giữ nguyên).
- **Thêm hàm mới** `generate_chat(contents, tools, system_instruction, model=None)`:
  dùng `types.GenerateContentConfig(tools=[…], system_instruction=…,
  automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))` để **tự lái
  vòng lặp tool**. **Bỏ qua rate-limit khi chạy Vertex** (`settings.google_genai_use_vertexai`
  True → không gọi `_rate_limit()`); vẫn gọi `_rate_limit()` ở chế độ api_key. Model = `settings.chat_model`.

### 3. `models/chat.py` (mới) — hợp đồng API
```python
class Gps(BaseModel): lat: float; lng: float
class ChatRequest(BaseModel):
    session_id: str; message: str
    trip_id: Optional[str] = None; gps: Optional[Gps] = None
class ProposedAction(BaseModel): tool: str; preview: str; args: dict
class ChatResponse(BaseModel):
    reply: str
    proposed_action: Optional[ProposedAction] = None
    pending_action_id: Optional[str] = None
class ChatConfirmRequest(BaseModel):
    session_id: str; pending_action_id: str; confirm: bool = True
class ChatConfirmResponse(BaseModel):
    reply: str; executed: bool; trip: Optional[TripPlan] = None
```

### 4. `agents/chat_agent.py` (mới) — orchestration function-calling
**Store in-memory** (giống `trips.py:27-31`, mất khi restart):
```python
_chat_history: dict[str, list]   = {}   # session_id -> Gemini contents
_pending_actions: dict[str, dict] = {}  # session_id -> {id, tool, args, trip_id, preview}
```
+ `reset()` cho test.

**Tool registry (Gemini FunctionDeclaration):**
- *Read (exec in-process ngay):* `get_current_trip()`, `search_places(query)`,
  `get_curated_places()`, `compare_routes(from_lat,from_lng,to_lat,to_lng)`,
  `get_bus_arrivals(stop_code)`, `get_trip_alerts()` (query `lta_alerts` + trigger
  `check_alerts_for_trip`), `get_weather(lat,lng)` (`openweather.get_current_weather`/`get_forecast`).
- *Write (KHÔNG exec — dựng pending action):* `add_place(place_id,day)`,
  `remove_place(place_id)`, `reorder_places(day,place_ids)`,
  `change_leg_mode(leg_id,transport_mode)`, `switch_leg_now(leg_id,new_mode)`,
  `add_day()`, `remove_day(day)`, `optimize_trip()`.

**Vòng lặp `run_chat(...)` (≤4 lượt Gemini):**
1. Nạp history theo `session_id`, append message user.
2. Lặp ≤4: gọi `gemini.generate_chat`:
   - read tool → `_execute_read_tool` (in-process, lazy-import services), feed kết quả lại, lặp tiếp.
   - write tool → `_build_pending_action` (validate rẻ: curated-set qua `get_curated_place`,
     leg tồn tại trong plan, **`trip_id` phải có** — xem guardrail dưới), lưu
     `_pending_actions[session_id]`, **dừng** và trả proposal.
   - chỉ text → reply cuối, dừng.
3. Hết 4 lượt không có text → fallback nhã nhặn, không mutate.

**Guardrail tool ghi khi không có trip đang mở:** mọi tool ghi yêu cầu `trip_id` không rỗng.
Nếu `trip_id is None` (user đang ở Home/Planner, chưa mở `/trip/:id`) → trả **tool-error**
("Hãy mở một lịch trình trước khi chỉnh sửa") để model trả lời nhã, **không** dựng pending với
`trip_id=None` (sẽ 404 ở confirm).

**Read executor tái dùng (không viết lại logic):**
- `routers/places.py::_CURATED` + search (`places.py:21-29`); `planning_agent.get_all_places()`
  (`planning_agent.py:72`) / `get_curated_place()` (`planning_agent.py:67`)
- `get_current_trip` → gọi `trips.get_trip(trip_id, current_user)` (`trips.py:144`, trả `TripPlan`,
  enforce 403 cho user đăng nhập)
- `compare_routes` → `services/onemap.get_all_routes` (`onemap.py:100`);
  `get_bus_arrivals` → `services/lta.get_bus_arrival` (`lta.py:29`)
- `get_weather` → `services/openweather.get_current_weather`/`get_forecast` (`openweather.py:16,56`)
- `get_trip_alerts` → đọc `lta_alerts` từ Supabase (read) + `adaptation_agent.check_alerts_for_trip`
  (`adaptation_agent.py:694`)

**System prompt:** "hướng dẫn viên Singapore của app IMOVE; phát hiện ngôn ngữ tin nhắn mới
nhất của user và trả lời đúng ngôn ngữ đó; chỉ gợi ý địa điểm có trong dataset (không bịa
place_id); mọi thay đổi lịch trình PHẢI gọi tool đề xuất, KHÔNG được tuyên bố đã làm xong."

### 5. `routers/chat.py` (mới) + đăng ký `main.py`
- `POST /chat` (Depends `get_current_user`) → dựng context (trip_id, gps, current_user,
  session_id) → `chat_agent.run_chat(...)` → `ChatResponse`.
- `POST /chat/confirm` (Depends `get_current_user`) → tra `_pending_actions[session_id]`; sai id
  → 409, không có → 404 (giống `accept_swap` `trips.py:761-765`). Nếu `confirm=false` → xoá pending.
  Nếu `confirm`:
  1. **Verify ownership tập trung:** `_verify_user_ownership(pending.trip_id, current_user)`
     (`trips.py:886`) — áp cho **mọi** tool ghi, vá lỗ hổng `change_leg_mode`/`switch_leg_now`.
  2. **Dispatch in-process** bằng route-handler có sẵn (bảng dưới), bọc `try/except HTTPException`.
     - Thành công → xoá pending, **luôn `get_trip(trip_id, current_user)`** để chuẩn hoá về
       `TripPlan`, trả `ChatConfirmResponse(executed=True, trip=…, reply=…)`.
     - `HTTPException` (422 NoRoute/Budget/PlaceMissing, …) → **không** xoá pending (cho phép thử
       lại), trả `ChatConfirmResponse(executed=False, reply=<giải thích theo ngôn ngữ user>)`.
- Đăng ký: `main.py:8` import `chat`, thêm `app.include_router(chat.router, prefix="/chat")` sau `:46`.

**Dispatch confirm → handler (đã xác minh chữ ký — lưu ý cột "ownership" và "kiểu trả"):**
| tool | gọi in-process | handler tự verify ownership? | chuẩn hoá |
|---|---|---|---|
| `add_place` | `trips.add_place(trip_id, AddPlaceRequest(place_id,day), current_user)` | ✅ (`:598`) | `get_trip` |
| `remove_place` | `trips.remove_place(trip_id, place_id, current_user)` (trả `None`) | ✅ (`:548`) | `get_trip` |
| `reorder_places` | `trips.reorder_places(trip_id, ReorderRequest(day,place_ids), current_user)` | ✅ (`:677`) | `get_trip` |
| `change_leg_mode` | `trips.update_leg(trip_id, leg_id, LegUpdateRequest(transport_mode))` (trả `LegSwapResult`) | ❌ → confirm tự verify | `get_trip` |
| `switch_leg_now` | `trips.switch_leg_now(trip_id, leg_id, LiveSwitchRequest(new_mode,current_lat,current_lng))` (trả `LegSwapResult`) | ❌ → confirm tự verify | `get_trip` |
| `add_day` | `trips.add_day(trip_id, current_user)` (`:444`) | ✅ (`:461`) | `get_trip` |
| `remove_day` | `trips.remove_day(trip_id, day_num, current_user)` (`:486`) | ✅ (`:495`) | `get_trip` |
| `optimize_trip` | `trips.optimize_trip(trip_id, OptimizeRequest(), current_user)` (`:390`) | ✅ (`:404`) | `get_trip` |

> **Vì confirm luôn `_verify_user_ownership` ở bước (1) cho mọi dòng, hai dòng ❌ vẫn được bảo vệ.**
> Handler tự lo phần còn lại: validate curated (`:611`), cập nhật `_trip_store`, persist Supabase
> (`_persist_trip_plan` `:924`) — **không nhân đôi logic**. `Depends` chỉ kích hoạt khi qua framework;
> gọi trực tiếp chỉ nhận `current_user` như tham số thường.

---

## Frontend

### 6. `services/api.js` — thêm 2 hàm (sau `:77`)
```js
sendChat: (body) => request('/chat', { method: 'POST', body: JSON.stringify(body) }),
confirmChatAction: (body) => request('/chat/confirm', { method: 'POST', body: JSON.stringify(body) }),
```
Tự kế thừa JWT qua `authHeader()` (`api.js:17-30`).

### 7. `components/chat/ChatWidget.jsx` (mới) — widget nổi toàn cục
- FAB cố định `fixed bottom-5 right-5 z-50` + panel; style theo `AlertBanner.jsx`
  (rounded, border, `animate-slide-up`), `cn` từ `lib/utils`, icon Lucide.
- State: `messages[]`, `input`, `loading`, `pending` ({proposed_action, pending_action_id}).
- Context: `useLang()` (lang — `LanguageContext.jsx:23`), `useGeolocation()` (`position` `{lat,lng}`
  — `useGeolocation.js:4,23`), `session_id` từ `localStorage` (đã đặt ở `Planner.jsx:245`),
  `trip_id` suy từ `useLocation()` regex `/trip/:id` (có thể `null` ở Home/Planner).
- Gửi: `api.sendChat({session_id, message, trip_id, gps: position})`.
- Có `proposed_action` → render **thẻ preview** + nút **Xác nhận**/**Huỷ**. Xác nhận →
  `api.confirmChatAction(...)`; **hiển thị spinner trong lúc chờ** (confirm có thể mất vài–vài chục
  giây do re-fetch OneMap). `executed=true` + có `trip` → bắn `CustomEvent('imove:trip-updated',
  {detail: trip})`. `executed=false` → hiển thị `reply` (lỗi nhã), giữ thẻ để thử lại.
- Chuỗi UI (tiêu đề, placeholder, nút, thông báo "mở lịch trình trước") thêm key EN/VI vào
  `LanguageContext.jsx`.

### 8. `App.jsx` — mount widget 1 lần
Chèn `<ChatWidget />` giữa `<Header />` (`:18`) và `<Routes>` (`:19`) — nằm trong
`LanguageProvider`+`AuthProvider`.

### 9. `pages/Trip.jsx` — nghe refresh
Thêm `useEffect` lắng `window` event `imove:trip-updated` → gọi `refresh()` lấy từ
`useTrip(id, user?.id ?? null)` (**`Trip.jsx:829`**) để cập nhật lịch sau khi xác nhận.
(Lưu ý: dòng 1504 chỉ là render `<AlertBanner onAdapted={refresh}>`, không phải điểm tích hợp.)

---

## Testing

Theo convention `tests/test_services/test_gemini.py` (patch `gemini._client`) và
`tests/test_routers/conftest.py` (ép `supabase=None`, reset store). Thêm fixture clear
`chat_agent._chat_history`/`_pending_actions`.

**`tests/test_agents/test_chat_agent.py` (mới):**
1. Tư vấn thuần → `reply`, `proposed_action=None`, không mutate.
2. Read tool `search_places` → exec in-process, reply text, không pending.
3. Write tool `add_place` → tạo pending + `pending_action_id`, **`_trip_store` không đổi**
   (spy `trips.add_place` không được await).
4. Loop cap: Gemini luôn trả function-call → gọi Gemini ≤4 lần, fallback không raise.
5. "Tôi bị lạc" + `gps=None` → tool-error → reply xin bật định vị, không crash.
6. `add_place` id ngoài curated → từ chối pending, reply giải thích.
7. **Write tool khi `trip_id=None` → tool-error "mở lịch trình trước", không dựng pending.**

**`tests/test_routers/test_chat.py` (mới)** (TestClient, override auth kiểu `test_trips.py:17-26`):
8. `POST /chat` happy path (patch `run_chat`) → 200, đúng shape.
9. `POST /chat/confirm` thực thi thật: seed `_pending_actions` + `_trip_store`/`_trip_meta`
   (fixture kiểu `test_trips.py:31-58`), patch `planning_agent.plan_trip` → `trips.add_place`
   chạy thật, pending bị xoá, trả `trip` là `TripPlan`.
10. Sai `pending_action_id` → 409; không có → 404.
11. **User B xác nhận trip user A → 403 cho MỌI tool ghi** — gồm cả `change_leg_mode` và
    `switch_leg_now` (verify bước (1) ở confirm, không phụ thuộc handler). ← test then chốt cho lỗ hổng đã vá.
12. **Confirm khi handler raise `HTTPException(422)`** (patch `plan_trip` raise `NoRouteError`) →
    `ChatConfirmResponse(executed=False)`, pending **không** bị xoá, HTTP status 200.

**Regression:** `cd backend && pytest tests/ -v`.

---

## Risks / edge cases
- **Ownership leg-switch (đã vá):** `update_leg`/`switch_leg_now` không tự verify → confirm phải tự
  gọi `_verify_user_ownership` cho mọi tool. Đây là rủi ro bảo mật chính bản plan cũ bỏ sót.
- **Confirm chậm + có thể fail:** mỗi confirm ghi (trừ leg-switch) gọi OneMap thật → vài–vài chục
  giây, có thể raise 422 → confirm bắt `HTTPException`, FE hiển thị spinner + giữ thẻ để thử lại.
- **GPS null/stale:** `gps` optional; tool điều hướng phải trả tool-error khi thiếu toạ độ để
  model xin bật định vị (không gọi OneMap với coord None).
- **Không có trip đang mở:** `trip_id=None` → tool ghi trả tool-error, không dựng pending.
- **Mất state khi Render restart:** `_chat_history`/`_pending_actions` bay sau 15' idle →
  pending cũ confirm sẽ 404, FE cần đề xuất lại. Trip vẫn phục hồi từ Supabase (`_fetch_trip_from_db`).
- **Rate-limit:** api_key mode worst-case 4×4s=16s (cap 4 lượt giới hạn); Vertex mode bỏ guard.
  Lock dùng chung không đụng → planning/adaptation vẫn được bảo vệ 15 RPM. Nhớ refactor giữ **cả hai**
  cơ chế (`_rate_limit()` + lock inline trong `suggest_places`).
- **Vertex vs api key:** `gemini_api_key` nới Optional; client init raise rõ ràng nếu thiếu cả hai.
- **Guest (user_id=None):** vẫn dùng được; pending keyed theo `session_id`; ownership chỉ
  enforce cho user đăng nhập (`_verify_user_ownership` return sớm khi `current_user=None`,
  `trips.py:886-888`). Bề mặt rủi ro guest-sửa-guest là rủi ro nền sẵn có (giảm nhẹ nhờ `trip_id` uuid4).
- **1 pending/session:** đề xuất mới ghi đè cũ; confirm id cũ → 409.

---

## Verification (end-to-end)
1. **Unit:** `cd backend && pytest tests/test_agents/test_chat_agent.py tests/test_routers/test_chat.py -v`
2. **Regression:** `cd backend && pytest tests/ -v` (xác nhận refactor `gemini.py` + thêm router không vỡ).
3. **Frontend build:** `cd frontend && npm run build`.
4. **GitNexus:** chạy `npx gitnexus analyze` để làm mới index (đang stale: "FTS indexes missing"),
   rồi `gitnexus_detect_changes()` trước khi commit.
5. **Smoke thật (tốn credit):** đặt `GOOGLE_GENAI_USE_VERTEXAI=true` + service account →
   `uvicorn app.main:app --reload`, mở widget với trip thật:
   - "đổi đoạn đi bộ thành tàu" → proposal `change_leg_mode` → Xác nhận → lịch cập nhật.
   - User B đăng nhập confirm trip của user A → **403** (kiểm chứng ownership đã vá).
   - "quán ăn gần Merlion" → reply + read `search_places`, không mutate.
   - "tôi bị lạc" (bật GPS) → `compare_routes`/`switch_leg_now` đề xuất điều hướng.

## Files
**Mới:** `backend/app/models/chat.py`, `backend/app/agents/chat_agent.py`,
`backend/app/routers/chat.py`, `backend/tests/test_agents/test_chat_agent.py`,
`backend/tests/test_routers/test_chat.py`, `frontend/src/components/chat/ChatWidget.jsx`.
**Sửa:** `backend/app/config.py`, `backend/.env.example`, `backend/app/services/gemini.py`,
`backend/app/main.py`, `frontend/src/services/api.js`, `frontend/src/App.jsx`,
`frontend/src/contexts/LanguageContext.jsx`, `frontend/src/pages/Trip.jsx`.
