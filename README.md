# IMOVE

Web app lập kế hoạch di chuyển bằng phương tiện công cộng cho khách du lịch tại Singapore, vận hành theo kiến trúc multi-agent.

## Mô tả

IMOVE cho phép user nhập danh sách địa điểm du lịch và nhận về kế hoạch di chuyển theo ngày — bao gồm phương tiện, thời gian, chi phí — có khả năng thích nghi khi kế hoạch thay đổi và học từ phản hồi qua nhiều chuyến đi.

**Đối tượng:** Solo traveler hoặc nhóm nhỏ (2–4 người) ít kinh nghiệm với Singapore, đã có danh sách địa điểm muốn đến và số ngày cụ thể.

---

## Tính năng cốt lõi

### Agent 1 — Planning Agent *(trước chuyến đi)*
- Nhận danh sách địa điểm → geocode qua OneMap API
- User chọn: tối ưu thứ tự hoặc giữ thứ tự tự nhập
- Output: kế hoạch theo ngày với phương tiện, thời gian, chi phí mỗi chặng
- Hiển thị trên bản đồ tích hợp + tab danh sách có thể chỉnh sửa từng chặng
- Cảnh báo mềm khi conflict lịch (sai thời điểm lý tưởng)

### Agent 2 — Adaptation Agent *(trong chuyến đi)*
- **Trigger tự động:** LTA DataMall phát hiện delay/hủy tuyến → cảnh báo chủ động
- **Trigger thủ công:** User bấm "Thay đổi kế hoạch" → agent tính lại lộ trình
- **Trigger thời tiết:** Mưa > 70% → gợi ý thay địa điểm ngoài trời bằng địa điểm trong nhà

### Agent 3 — Memory Agent *(persistent)*
- Học từ rating từng chặng và hành động chỉnh sửa của user
- Lưu preference vào user profile (yêu cầu đăng ký), áp dụng cho các chuyến sau
- Guest mode hoạt động không cần tài khoản

---

## Tech Stack

| Layer | Công nghệ |
|---|---|
| Backend + Agent Orchestration | FastAPI |
| Frontend | React + Leaflet.js |
| Database + Auth | Supabase (free tier) |
| LLM | Gemini 2.5 Flash |
| Backend Hosting | Render (free tier) |
| Frontend Hosting | Vercel |

### External APIs

| API | Dùng cho | Chi phí |
|---|---|---|
| OneMap API (SLA) | Geocoding, routing đa phương tiện | Miễn phí |
| LTA DataMall | Real-time bus/MRT, cảnh báo sự cố | Miễn phí |
| OpenWeather API | Dự báo thời tiết | Miễn phí (1000 calls/day) |
| data.gov.sg | Tọa độ, giờ mở cửa địa điểm | Miễn phí, static |

---

## Cấu trúc dự án

```
IMOVEV2/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── models/          # Pydantic models (shared contract)
│   │   ├── routers/         # FastAPI routers
│   │   ├── agents/          # Planning / Adaptation / Memory agents
│   │   ├── services/        # OneMap, LTA, Gemini, OpenWeather clients
│   │   └── data/
│   │       └── places.json  # Curated dataset ~50 POIs Singapore
│   ├── requirements.txt
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── lib/             # Supabase client
│   │   ├── services/        # Centralized API calls
│   │   ├── hooks/           # useAlerts (Realtime), useTrip
│   │   ├── components/      # layout / map / planner / adaptation / auth
│   │   └── pages/           # Home / Planner / Trip
│   ├── package.json
│   ├── vite.config.js
│   └── .env.example
│
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
│
├── PRD.md
└── IMOVE_TechStack.md
```

---

## Nguyên tắc Anti-Hallucination (bắt buộc)

| Tình huống | Hành vi |
|---|---|
| Địa điểm không trong curated dataset | Báo lỗi: thiếu dữ liệu dwell time |
| OneMap không tìm được route | Báo lỗi: không có public transport khả dụng |
| Budget không đủ | Báo lỗi: vượt ngân sách, gợi ý điều chỉnh |
| LTA DataMall API down | Báo: Adaptation Agent tạm vô hiệu |
| Estimate không chắc chắn | Hiển thị badge "~" / "Ước tính" trong UI |

---

## Cài đặt

### Backend

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# Điền API keys vào .env

uvicorn app.main:app --reload
# → http://localhost:8000/health
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env
# Điền VITE_API_BASE_URL và VITE_SUPABASE_URL vào .env

npm run dev
# → http://localhost:5173
```

---

## Phân công nhóm

| Dev | Branch | Phụ trách |
|-----|--------|-----------|
| Dev 1 | `dev/backend-infra` | Infrastructure + External APIs (OneMap, LTA, Gemini, OpenWeather) |
| Dev 2 | `dev/agent-logic` | Agent Logic (Planning / Adaptation / Memory) |
| Dev 3 | `dev/frontend-core` | Core UI Flow (Input form, list view, auth) |
| Dev 4 | `dev/frontend-map` | Map + Realtime (Leaflet, Supabase Realtime) |
