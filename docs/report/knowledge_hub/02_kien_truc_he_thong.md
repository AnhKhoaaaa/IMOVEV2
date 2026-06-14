# IMOVE V2 — Kiến trúc hệ thống

> **Bối cảnh chung:** IMOVE V2 là web app lập kế hoạch du lịch bằng giao thông công cộng ở Singapore. Backend FastAPI + các AI agent (Planning, Adaptation, Memory, Chat) → frontend React 18 → Supabase (DB + Auth + Realtime) → Gemini 2.5 Flash. Ràng buộc: ~75% code quy tắc, ~25% LLM.

---

## 1. Technical Stack (Tech stack)
| Tầng | Công nghệ | Vai trò |
|---|---|---|
| **Frontend (FE)** | React 18 + Vite, React Router, Tailwind/shadcn-style UI, Leaflet (bản đồ), Supabase JS client | Wizard lập lịch nhiều bước, bản đồ tuyến, UI cảnh báo realtime, chatbot |
| **Backend (BE)** | Python + FastAPI, APScheduler (job nền), httpx (HTTP bất đồng bộ), Pydantic (models) | API + 4 agent + scheduler |
| **Database/Auth/Realtime (DB)** | Supabase: PostgreSQL + PostGIS, Auth (JWT), Realtime (WebSocket), Row-Level Security | Lưu trip/legs/alerts/preferences; đẩy cảnh báo realtime; tìm điểm trong nhà gần nhất bằng PostGIS |
| **AI** | Google Gemini 2.5 Flash (qua API key hoặc Vertex AI service account) | Parse ngôn ngữ tự nhiên, gợi ý điểm, viết cảnh báo, chatbot function-calling |
| **API dữ liệu ngoài** | OneMap (định tuyến + geocode SG), LTA DataMall (cảnh báo tàu + giờ bus), OpenWeather | Nguồn dữ liệu thật |

## 2. Kiến trúc phân tầng (Layered architecture)
Backend tách bạch trách nhiệm theo tầng; mỗi tầng chỉ gọi xuống tầng dưới:

```
HTTP request
   |
   v
routers/   -> Chỉ xử lý HTTP: nhận request, kiểm tra quyền, trả lỗi. KHÔNG chứa logic nghiệp vụ.
   |
   v
agents/    -> Logic nghiệp vụ (75% rule-based): lập lịch, điều chỉnh, ghi nhớ, chatbot.
   |
   v
services/  -> Vỏ bọc API ngoài: OneMap, LTA, OpenWeather, Gemini + dịch vụ chấm điểm (scoring).
   |
   v
models/    -> Cấu trúc dữ liệu (Pydantic) dùng chung cho mọi tầng.
```

Quy tắc gọi (trích từ code thật):
- `routers/places.py` → `services/onemap.py` (tra cứu/geocode, không cần agent).
- `routers/trips.py` → `agents/planning_agent.py` → `services/onemap.py` + `services/gemini.py`.
- `routers/alerts.py` + scheduler → `agents/adaptation_agent.py` → `services/lta.py` + `services/openweather.py`.
- `routers/chat.py` → `agents/chat_agent.py` → gọi lại `services/gemini.py` và **các handler trong `routers/trips.py`** (khi người dùng xác nhận).

## 3. Bốn AI Agent (vai trò)
> Lưu ý độ chính xác: tài liệu cũ `CLAUDE.md` ghi "3 agents" và "4 routers"; **code thực tế có 4 agent** (thêm Chat) và `main.py` đăng ký **7 router** (health, places, trips, alerts, transit, preferences, chat).

| Agent | File | Trách nhiệm | Dùng LLM? |
|---|---|---|---|
| **Planning** | `agents/planning_agent.py` | Lập lịch: chia điểm vào ngày, lấy tuyến, chọn phương tiện | Ít — chỉ ở mép (đoán tên điểm, viết cảnh báo) |
| **Adaptation** | `agents/adaptation_agent.py` | Phát hiện sự cố (mưa/MRT) & đề xuất điều chỉnh | Không — 100% rule-based |
| **Memory** | `agents/memory_agent.py` | Học sở thích từ feedback (chỉ user đăng nhập) | Không |
| **Chat** | `agents/chat_agent.py` | Trợ lý hội thoại; điều phối các agent khác qua function-calling | Có — Gemini là bộ não hội thoại |

## 4. Sơ đồ ngữ cảnh (C4 Level 1 — Context)
```
            +---------------------------+
            |   Khách du lịch (browser) |
            +-------------+-------------+
                          | HTTPS
                          v
            +---------------------------+        +------------------+
            |     Hệ thống IMOVE V2      |<------>|  Supabase        |
            | (FastAPI + React + Agents)|  R/W   |  DB+Auth+Realtime |
            +--+----+----+----+---------+   WS   +---------+--------+
               |    |    |    |                            |
               v    v    v    v                            | push alert realtime
          OneMap  LTA  Weather Gemini                      v
        (routing)(tàu/bus)(OpenWeather)(LLM)        về browser người dùng
```

## 5. Sơ đồ thành phần (C4 Level 2 — Container)
```
FRONTEND (React + Vite)
  - Pages: Home / Planner / Trip / Settings
  - services/api.js   (NƠI DUY NHẤT gọi backend)
  - hooks: useTrip (nạp trip), useAlerts (Realtime WebSocket), useSavedTrips
  - components: planner/, map/, adaptation/, auth/, chat/, layout/
        |  REST (qua api.js)            ^  WebSocket (Supabase Realtime, qua useAlerts)
        v                               |
BACKEND (FastAPI)                        |
  - routers/ : health, places, trips, alerts, transit, preferences, chat
  - agents/  : Planning, Adaptation, Memory, Chat
  - services/: onemap, lta, openweather, gemini, scoring
  - APScheduler: poll LTA (2'), poll weather (30')
        |  đọc/ghi
        v
DATABASE: Supabase Postgres + PostGIS  <----------------+
                                                        (FE subscribe trực tiếp qua WebSocket)
```

## 6. Luồng dữ liệu chính (data flow)
**Lập lịch (happy path):**
1. FE `POST /trips` tạo chuyến (lấy `trip_id`).
2. FE `POST /trips/{id}/plan` với danh sách `place_ids`, khách sạn, `optimize_order`.
3. Planning Agent chia điểm vào ngày → lấy tuyến (OneMap, song song) → chấm điểm chọn phương tiện → dựng các *leg* → (tuỳ chọn) gọi Gemini viết cảnh báo lịch.
4. Backend trả `TripPlan`; lưu vào Supabase (best-effort) + cache bộ nhớ.

**Cảnh báo realtime:**
1. APScheduler (hoặc endpoint check-alerts) phát hiện sự cố → `insert` vào bảng `lta_alerts` (có dedup 10 phút).
2. Supabase Realtime đẩy bản ghi mới qua WebSocket → hook `useAlerts` ở FE hiện banner.
3. Người dùng bấm "điều chỉnh" → backend tạo *đề xuất* → người dùng chấp nhận → mới ghi DB.

## 7. Bảo mật & quyền sở hữu
- **Auth:** JWT của Supabase; backend trích `user_id` qua `dependencies.get_current_user` (trả `None` nếu là guest) hoặc `require_current_user` (bắt buộc đăng nhập, dùng cho preferences & chat).
- **Quyền sở hữu trip:** kiểm tra ở router bằng `_verify_user_ownership` (theo `user_id`) và `_verify_session_ownership` (theo `session_id` cho guest).
- **RLS (Row-Level Security)** ở Supabase: mỗi user/session chỉ truy cập dữ liệu của mình.

## 8. Hai chế độ chạy của backend (quan trọng để hiểu khi đọc code)
- **Có Supabase:** dữ liệu lưu/đọc từ DB; trip phục hồi được sau khi server restart (`_fetch_trip_from_db`).
- **Không có Supabase:** fallback **bộ nhớ tiến trình** (`_trip_store`, `_trip_meta`, `_pending_swaps`) để demo offline vẫn chạy (mất khi restart).

## 9. Triển khai (Deployment)
- **Backend:** dự kiến chạy trên **Render free tier** (ngủ đông sau ~15' → cần ping `GET /health`). Chạy dev: `cd backend && uvicorn app.main:app --reload`.
- **Frontend:** build tĩnh Vite (`npm run build`); cấu hình `VITE_API_BASE_URL` trỏ về backend (rỗng → dùng Vite dev proxy, tránh CORS).
- **Cấu hình:** backend đọc `.env` trong thư mục `backend/` qua `pydantic_settings` (khoá OneMap, LTA, OpenWeather, Gemini, Supabase). Gemini có 2 chế độ: API key hoặc Vertex AI.
- **CORS:** cho `localhost:5173/5174` + `frontend_url` production.
- **Migrations:** `supabase/migrations/` đánh số 001→015 (gồm PostGIS, RLS, vòng đời trip, làm giàu dữ liệu Google).

## 10. Các file backend then chốt (để mở khi cần)
- `backend/app/main.py` — khởi tạo FastAPI, đăng ký 7 router, khởi động scheduler.
- `backend/app/config.py` — settings từ `.env`.
- `backend/app/database.py` — khởi tạo Supabase client (service_role key).
- `backend/app/agents/planning_agent.py` — trái tim lập lịch (`plan_trip`).
- `backend/app/services/scoring.py` — chấm điểm chọn phương tiện.
