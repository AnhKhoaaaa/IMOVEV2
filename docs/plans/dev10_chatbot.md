# dev10 — LLM Chatbot (Gemini 2.5 Flash + Vertex AI)

## Context

IMOVEV2 đã có API surface đầy đủ để sửa lịch trình, nhưng người dùng phải thao tác thủ
công qua UI. dev10 thêm một **chatbot LLM** có thể phân tích yêu cầu ngôn ngữ tự nhiên
(tiếng Việt/Anh), tư vấn, và **đề xuất** thay đổi lịch trình: đổi/thêm/xóa địa điểm,
đổi phương tiện, chỉ đường lại khi đi lạc (GPS).

LLM **không tự ý sửa** — mọi hành động ghi đi qua **confirm-before-execute** (tái dùng
pattern `adapt → accept-swap`): chatbot trả về một *proposed action*, frontend hiện
preview, user bấm "Áp dụng" thì FE mới gọi endpoint ghi **đã tồn tại**.

### Quyết định đã chốt
| Hạng mục | Lựa chọn |
|---|---|
| Model | **Gemini 2.5 Flash** |
| Serving | **Vertex AI** (dùng $200 GCP credit, gỡ giới hạn 15 RPM) |
| Cơ chế ghi | **Confirm-before-execute** (LLM đề xuất → user áp dụng) |
| Lịch sử hội thoại | **Stateless** — frontend gửi lại `messages[]` mỗi lượt |
| Scope tools | Đổi địa điểm · Đổi phương tiện · Chỉ đường GPS · Tư vấn (read-only) |
| Chat UI | **Do frontend làm** — backend chỉ cấp hợp đồng API (xem §HandOffFrontend) |

## Nguyên tắc thiết kế

- **Không tạo endpoint ghi mới.** `/chat` chỉ *phân tích + đề xuất*. Hành động ghi tái
  dùng endpoint sẵn có; `proposed_action` mô tả đúng method+path+body của endpoint đó.
- **Read tools chạy server-side ngay** trong vòng lặp function-calling; **write tools
  KHÔNG chạy**, chỉ trả về dưới dạng `proposed_action`.
- **Bound vòng lặp tool** (≤4 lượt gọi Gemini/1 request) để giới hạn latency & chi phí.
- **Stateless**: không migration, không bảng chat, không xử lý auth mới.

---

## Các thay đổi (backend)

### 1. Config — bật Vertex AI
`backend/app/config.py` + `backend/.env.example`
```
google_genai_use_vertexai: bool = False     # GOOGLE_GENAI_USE_VERTEXAI
google_cloud_project: Optional[str] = None   # GOOGLE_CLOUD_PROJECT
google_cloud_location: Optional[str] = None  # GOOGLE_CLOUD_LOCATION (vd: asia-southeast1)
chat_model: str = "gemini-2.5-flash"
```
`.env.example` thêm các biến trên + `GOOGLE_APPLICATION_CREDENTIALS=` (service-account JSON).

### 2. Client init linh hoạt (AI Studio ↔ Vertex)
`backend/app/services/gemini.py`
```python
if settings.google_genai_use_vertexai:
    _client = genai.Client(vertexai=True,
                           project=settings.google_cloud_project,
                           location=settings.google_cloud_location)
else:
    _client = genai.Client(api_key=settings.gemini_api_key)
```
Giữ nguyên `_rate_limit()` guard và toàn bộ hàm hiện có.

### 3. Models cho chat (stateless)
`backend/app/models/chat.py` (mới) — xem shape đầy đủ trong HandOffFrontend §Chatbot.
- `ChatMessage`, `ChatRequest`, `ProposedAction`, `ChatResponse`

### 4. Chat agent — orchestration function-calling
`backend/app/agents/chat_agent.py` (mới)

Tool registry:
- *Read* (auto-exec): `search_places(query)`, `get_current_trip()`,
  `compare_routes(from_lat,from_lng,to_lat,to_lng)`, `get_bus_arrivals(stop_code)`
- *Write* (đề xuất, không exec): `replace_place(day,old_place_id,new_place_id)`,
  `add_place(day,place_id)`, `remove_place(place_id)`,
  `change_transport(leg_id,transport_mode)`, `reroute_from_gps(leg_id,new_mode)`

System prompt: hướng dẫn viên Singapore; trả lời bằng **ngôn ngữ của user**; chỉ đề xuất
write action khi user yêu cầu rõ; giải thích ngắn gọn.

Vòng lặp: gọi Gemini → read tool thì exec rồi feed kết quả lại (≤4 lượt) → write tool thì
dựng `ProposedAction` rồi dừng → không function_call thì trả `reply`.

**Tái dùng (không viết lại logic):**
- `app.agents.planning_agent.get_all_places()` / `get_curated_place()` — search/validate id
- Logic dựng `TripPlan` mà `GET /trips/{id}` dùng — `get_current_trip`
- `app.routers.transit` / `app.services.onemap` — `compare_routes`
- `app.services.lta` — `get_bus_arrivals`
- `app.routers.trips._verify_session_ownership` — kiểm tra sở hữu

Mapping write tool → endpoint (đưa vào `ProposedAction.endpoint.steps[]`):
| Tool | Endpoint áp dụng (đã tồn tại) |
|---|---|
| `replace_place` | `DELETE /trips/{id}/places/{old}` → `POST /trips/{id}/places {place_id:new, day}` |
| `add_place` | `POST /trips/{id}/places { place_id, day }` |
| `remove_place` | `DELETE /trips/{id}/places/{place_id}` |
| `change_transport` | `PATCH /trips/{id}/legs/{legId} { transport_mode }` |
| `reroute_from_gps` | `POST /trips/{id}/legs/{legId}/switch-now { new_mode, current_lat, current_lng }` |

### 5. Chat router
`backend/app/routers/chat.py` (mới) + đăng ký trong `backend/app/main.py`
- `POST /chat` → `ChatResponse`. Verify ownership nếu có `session_id`.
- **Không** có endpoint ghi — việc áp dụng do FE gọi endpoint cũ.

### 6. Tài liệu frontend
`docs/plans/HandOffFrontend.md` §Chatbot — hợp đồng API + luồng confirm + GPS.

---

## Files tóm tắt

| File | Action |
|---|---|
| `backend/app/config.py` | + 4 settings Vertex/model |
| `backend/.env.example` | + biến Vertex + GOOGLE_APPLICATION_CREDENTIALS |
| `backend/app/services/gemini.py` | client init linh hoạt AI Studio↔Vertex |
| `backend/app/models/chat.py` | **mới** |
| `backend/app/agents/chat_agent.py` | **mới** |
| `backend/app/routers/chat.py` | **mới** |
| `backend/app/main.py` | đăng ký chat router |
| `backend/tests/test_agents/test_chat_agent.py` | **mới** |
| `docs/plans/HandOffFrontend.md` | + §Chatbot |

---

## Verification

1. **Unit (mock Gemini)** — pattern `test_gemini.py`:
   - Tư vấn thuần → `reply`, `proposed_action=None`, không mutate
   - Read tool `search_places` → exec, kết quả vào `read_results`
   - Write tool `change_transport` → `proposed_action` đúng endpoint, **không** mutate trip
   - `reroute_from_gps` thiếu GPS → trả lỗi nhã nhặn yêu cầu bật định vị
   - Vòng lặp tool cap ≤4 lượt
   ```
   cd backend && pytest tests/test_agents/test_chat_agent.py -v
   ```
2. **Regression**: `cd backend && pytest tests/ -v`
3. **Smoke thật (tốn credit)**: `GOOGLE_GENAI_USE_VERTEXAI=true` + service account →
   `POST /chat` với trip thật: "đổi đoạn đi bộ thành tàu" → `change_transport`;
   "quán ăn gần Merlion" → `reply` + `read_results`.
4. **Impact check** trước khi sửa `gemini.py`: `gitnexus_impact(target="Settings", direction="upstream")`.
