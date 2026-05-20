# HANDOFF — Dev 2: Agent Logic

> **Đọc file này trước khi làm bất cứ việc gì.**
> File này là kênh giao tiếp giữa Dev 3 (phiên hiện tại) và Dev 2 (phiên riêng).
> Đây là nguồn sự thật duy nhất về contract giữa frontend và backend.

---

## ⚠️ GIAO THỨC CẬP NHẬT FILE NÀY

```
MỌI cập nhật phải được APPEND vào "Update Log" ở cuối file.
TUYỆT ĐỐI không xóa hoặc sửa entry cũ.
Format bắt buộc: ### [YYYY-MM-DD | DevX] Tiêu đề ngắn
```

---

## Ngữ cảnh dự án

**IMOVE** là web app lập kế hoạch di chuyển công cộng tại Singapore cho khách du lịch.

**Tech stack:**
- Backend: FastAPI · Python
- Frontend: React 18 + Tailwind + Shadcn/ui (đã hoàn thành)
- DB: Supabase (PostgreSQL + Realtime WebSocket)
- LLM: Gemini 2.5 Flash (qua `services/gemini.py`)

**Branch của Dev 2:** `dev/agent-logic`
**Dev 2 owns:**
```
backend/app/agents/          ← Business logic chính
backend/app/routers/trips.py ← HTTP wrapper cho planning + legs
backend/app/routers/alerts.py ← HTTP wrapper cho adaptation
backend/app/data/            ← places.json và dữ liệu tĩnh
```

---

## Trạng thái hiện tại (khi file này được tạo)

### Frontend (Dev 3) — ĐÃ XONG
- 77 tests pass (`npm run test`)
- Planner flow (4-step form) → gọi `POST /trips` rồi `POST /trips/{id}/plan`
- Trip page hiển thị `days[].legs[]` với RouteCard, DayPlan
- AlertBanner kết nối Supabase Realtime (`lta_alerts` table)
- Nút "Cập nhật kế hoạch" → gọi `POST /trips/{id}/adapt`
- Edit leg modal → gọi `PATCH /trips/{id}/legs/{leg_id}`

### Backend (trạng thái cần Dev 2 hoàn thành)
```python
# Các endpoint sau đang trả 501 — Dev 2 cần implement:
POST  /trips/{id}/plan        ← QUAN TRỌNG NHẤT
PATCH /trips/{id}/legs/{leg_id}
POST  /trips/{id}/adapt
```

---

## Contracts Frontend Mong Đợi — KHÔNG ĐƯỢC THAY ĐỔI

### 1. `POST /trips/{id}/plan`

**Request body** (đã định nghĩa trong `backend/app/models/trip.py`):
```json
{
  "place_ids": ["gardens-by-the-bay", "marina-bay-sands", "sentosa"],
  "optimize_order": true,
  "preferences": {
    "prefer_mrt": true,
    "max_walk_minutes": 15,
    "budget_sgd": 150
  }
}
```

**Response phải trả** (frontend đang parse theo shape này):
```json
{
  "id": "uuid-trip-id",
  "days": [
    {
      "day": 1,
      "legs": [
        {
          "id": "uuid-leg-id",
          "from_place_id": "gardens-by-the-bay",
          "to_place_id": "marina-bay-sands",
          "transport_mode": "MRT",
          "duration_minutes": 15,
          "cost_sgd": 1.80,
          "is_estimated": false
        }
      ]
    }
  ],
  "places": [
    {
      "id": "gardens-by-the-bay",
      "name": "Gardens by the Bay",
      "lat": 1.2816,
      "lng": 103.8636,
      "dwell_minutes": 180,
      "best_time_start": "08:00",
      "best_time_end": "11:00",
      "category": "nature",
      "is_outdoor": true,
      "in_curated_dataset": true
    }
  ],
  "warnings": ["Gardens by the Bay: best time 08:00–11:00, bạn đến lúc 14:00"]
}
```

> **Quy tắc `is_estimated`:**
> - `false` = dữ liệu từ OneMap API (route thật)
> - `true` = ước tính khi OneMap không trả được → frontend bắt buộc hiện badge "~ Ước tính"

> **Quy tắc `warnings`:**
> - Mảng chuỗi tiếng Việt (hoặc English đều ok)
> - Điền khi địa điểm được truy cập ngoài khung `best_time_start/end`
> - Mảng rỗng `[]` nếu không có gì

### 2. `PATCH /trips/{id}/legs/{leg_id}`

**Request body:**
```json
{ "transport_mode": "BUS" }
```

**Response:** leg object đã cập nhật (cùng shape như leg trong danh sách trên).

### 3. `POST /trips/{id}/adapt`

**Request body:**
```json
{ "alert_id": "uuid-alert-id" }
```

**Response:**
```json
{
  "adapted": true,
  "changes": ["Leg 1: MRT → BUS do tuyến MRT bị gián đoạn"],
  "updated_trip": { /* full trip object như POST /plan */ }
}
```
Frontend gọi `refresh()` sau khi nhận response — không cần emit events.

---

## Ràng buộc bắt buộc

### Anti-hallucination
- **TUYỆT ĐỐI không** hardcode `duration_minutes` hay `cost_sgd` — mọi giá trị phải từ OneMap API
- Nếu OneMap không trả được route → đặt `is_estimated: true`, dùng giá trị từ `data/places.json`
- Nếu không có route nào có thể tính → raise `NoRouteError`, router trả HTTP 422 với `detail` rõ ràng

### LLM (Gemini) — 75%/25% rule
- Chỉ gọi Gemini khi parse natural language hoặc edge case code không xử lý được
- Mọi lời gọi phải có comment: `# [LLM] lý do gọi`
- Rate limit: max 1 call/4s — guard đã có trong `services/gemini.py`, đừng bypass

### Testing
- Mọi endpoint mới phải có pytest test trong `backend/tests/`
- Test dùng `httpx.AsyncClient` (async)
- Chạy `cd backend && pytest tests/ -v` — phải 100% PASS trước khi commit

---

## Files cần đọc trước khi code

```
backend/app/models/trip.py       — TripPlanRequest, RouteLeg, Trip models
backend/app/models/place.py      — Place model (đã có in_curated_dataset field)
backend/app/models/route.py      — RouteLeg model
backend/app/services/onemap.py   — get_route(from_lat, from_lng, to_lat, to_lng)
backend/app/services/gemini.py   — call_gemini() với rate limit guard
backend/app/services/lta.py      — get_disruptions()
backend/app/database.py          — supabase_client (service_role)
backend/app/data/places.json     — ~50 POIs với dwell_minutes, best_time
```

---

## Cách giao tiếp lại với Dev 3

1. Khi xong một endpoint → cập nhật Update Log bên dưới
2. Nếu cần thay đổi contract (response shape) → **hỏi Dev 3 trước** (họ đang dùng phiên hiện tại)
3. Nếu model Pydantic cần thay đổi (shared file `models/`) → ghi rõ trong Update Log để Dev 3 cập nhật tests

---

## 📋 Update Log — APPEND ONLY

<!-- QUAN TRỌNG: Chỉ thêm mới xuống dưới. KHÔNG xóa hay sửa entry cũ. -->
<!-- Format: ### [YYYY-MM-DD | DevX] Mô tả ngắn -->

### [2026-05-20 | Dev3] Khởi tạo handoff file

- Phase 3A Frontend Core hoàn thành: 77/77 tests pass
- UI Upgrade (Shadcn/Tailwind) xong
- Backend `POST /trips/{id}/plan`, `PATCH .../legs/...`, `POST .../adapt` đang trả 501
- Contract frontend mong đợi đã được document đầy đủ ở trên
- Dev 2 có thể bắt đầu implement `planning_agent.py` ngay
