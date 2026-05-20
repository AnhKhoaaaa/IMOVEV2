# IMOVE — Kế hoạch tổng thể (High-Level Overview)

**Dự án:** Web app lập kế hoạch di chuyển công cộng cho khách du lịch tại Singapore  
**Nhóm:** 4 developers  
**Tech stack:** FastAPI · React + Leaflet.js · Supabase · Gemini 2.5 Flash · Render · Vercel

---

## 5 Bước lớn

### Bước 1 — Khởi tạo nền tảng
Cả nhóm thiết lập môi trường, tạo repo GitHub, đăng ký tài khoản dịch vụ. Kết thúc: mọi người clone repo và chạy được trên máy cá nhân.

### Bước 2 — Thiết kế Database
Thiết kế schema Supabase: bảng, RLS policies, bật Realtime cho `lta_alerts`. Nền tảng chung cho cả backend và frontend.

### Bước 3 — Xây dựng Backend & Agent Logic *(song song)*
- **Dev 1**: tầng hạ tầng — OneMap, LTA, OpenWeather, Gemini, endpoints cơ bản
- **Dev 2**: agent logic — Planning Agent → Adaptation Agent (LTA + weather) → Memory Agent

### Bước 4 — Xây dựng Frontend UI *(song song với Bước 3)*
- **Dev 3**: luồng chính — form nhập liệu, kết quả kế hoạch dạng danh sách
- **Dev 4**: bản đồ Leaflet, cảnh báo real-time (transport + thời tiết) qua Supabase Realtime

### Bước 5 — Tích hợp & Kiểm thử
Cả nhóm chạy end-to-end, kiểm tra error case theo PRD, deploy lên Render + Vercel.

---

## Ràng buộc chung cho toàn nhóm

### Anti-hallucination (TUYỆT ĐỐI)
- Không hardcode dwell time, thời gian di chuyển, chi phí — mọi giá trị phải từ `places.json` hoặc OneMap API
- Không có route → raise error rõ ràng, không fallback bằng LLM
- `is_estimated=true` trong DB → bắt buộc hiển thị badge trong UI

### File ownership (tránh conflict)
Mỗi dev chỉ commit vào vùng file của mình. Vùng shared phải báo nhóm trước khi sửa:

| Vùng shared | Ai cần báo |
|---|---|
| `backend/app/models/` | Dev 1 + Dev 2 |
| `frontend/src/services/api.js` | Dev 3 + Dev 4 |
| `supabase/migrations/` | Cả nhóm |
| `frontend/src/App.jsx` | Dev 3 + Dev 4 |

### LLM (Gemini) — 75% code / 25% LLM
- Chỉ gọi LLM khi parse input ngôn ngữ tự nhiên hoặc edge case code không xử lý được
- Mọi lời gọi Gemini phải có comment `# [LLM] lý do gọi`
- Rate limit: 15 RPM → guard trong `gemini.py` (max 1 call/4s)

### Testing
- Tính năng hoàn thành khi và chỉ khi test pass 100%
- Backend: `pytest` + `httpx.AsyncClient` (async tests)
- Frontend: Vitest + React Testing Library
- Không merge code chưa có test

**Cấu hình Vitest** (Dev 3 setup trong `vite.config.js`):
```js
test: { environment: 'jsdom', setupFiles: ['./src/setupTests.js'], globals: true }
```

### Quy trình trước mỗi PR (tất cả devs)
```bash
git fetch origin && git rebase origin/develop   # sync mới nhất
npm run test   # hoặc: pytest backend/tests/ -v  # phải 100% PASS
# Trong Claude Code:
/review                                          # code-reviewer agent kiểm tra
git push origin <branch>
# Mở PR → develop, tag 1 dev khác để human-approve
```

---

## API Keys — Phân công đăng ký & chia sẻ

**Quy tắc:** Chia theo ownership, share giá trị thực qua nhóm chat private. Không commit `.env` vào git.

| Ai đăng ký | Keys | Nguồn đăng ký |
|---|---|---|
| **Dev 2** | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | supabase.com |
| **Dev 1** | `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`, `LTA_API_KEY`, `OPENWEATHER_API_KEY` | onemap.gov.sg · datamall.lta.gov.sg · openweathermap.org |
| **Dev 2** | `GEMINI_API_KEY` | aistudio.google.com |

---

## Checkpoint sau mỗi bước

| Bước | Dấu hiệu hoàn thành |
|------|---------------------|
| 1 | `uvicorn` chạy · `npm run dev` load React · mọi người có `.env` đầy đủ |
| 2 | Query DB từ Python không lỗi · Realtime bật trên `lta_alerts` |
| 3 | `POST /trips/{id}/plan` trả kế hoạch hợp lệ · `pytest` 100% pass |
| 4 | Nhập địa điểm → kế hoạch + bản đồ · AlertBanner hiện real-time (transport + weather) |
| 5 | Tất cả error case PRD Section 5 đúng · Deploy thành công trên Render + Vercel |

---

## Thứ tự ưu tiên MVP

```
MUST HAVE:   Planning Agent flow (Bước 1→2→3 core→4 core)
SHOULD HAVE: Adaptation Agent (LTA + OpenWeather)
NICE TO HAVE: Memory Agent
```
