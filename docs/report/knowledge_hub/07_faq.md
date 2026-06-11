# IMOVE V2 — Câu hỏi thường gặp (FAQ)

> **Bối cảnh chung:** IMOVE V2 là web app lập kế hoạch du lịch bằng giao thông công cộng ở Singapore. Backend FastAPI + các AI agent (Planning, Adaptation, Memory, Chat) → frontend React 18 → Supabase (DB + Auth + Realtime) → Gemini 2.5 Flash. Ràng buộc: ~75% code quy tắc, ~25% LLM. File này tổng hợp Hỏi–Đáp để tra cứu nhanh.

---

## Tổng quan

**Hỏi: IMOVE V2 là gì?**
Đáp: Một web app giúp khách du lịch ở Singapore tự động lập lịch tham quan bằng giao thông công cộng (MRT/bus), gợi ý phương tiện theo sở thích, và chủ động đề xuất điều chỉnh khi trời mưa hoặc MRT gián đoạn.

**Hỏi: "Multi-agent" (đa tác tử) nghĩa là gì ở đây?**
Đáp: Logic nghiệp vụ chia thành các module độc lập gọi là agent: **Planning** (lập lịch), **Adaptation** (điều chỉnh), **Memory** (học sở thích), **Chat** (trợ lý hội thoại). Mỗi agent một trách nhiệm.

**Hỏi: Vì sao gọi là "75% code, 25% LLM"?**
Đáp: Các quyết định chắc chắn (xếp lịch, chấm điểm, định tuyến) được giải bằng **code quy tắc** vì rẻ và kiểm thử được. Chỉ những việc ngôn ngữ tự nhiên/mơ hồ (đoán tên điểm, viết cảnh báo, gợi ý điểm, chatbot) mới dùng **Gemini (LLM)**.

## Người dùng & quyền

**Hỏi: Có bắt buộc đăng nhập không?**
Đáp: Không. Khách (guest) dùng được toàn bộ lập lịch + điều chỉnh + đổi phương tiện. Chỉ **ghi nhớ sở thích** (Memory Agent) và **chatbot** mới cần đăng nhập.

**Hỏi: Guest được phân biệt thế nào?**
Đáp: Qua `session_id` (UUID lưu ở localStorage trình duyệt). Người đăng nhập phân biệt qua `user_id` từ JWT của Supabase.

**Hỏi: Người khác có xem được chuyến của tôi không?**
Đáp: Không. Có RLS ở Supabase + kiểm tra quyền sở hữu ở backend (`_verify_user_ownership` / `_verify_session_ownership`), trả lỗi 403 nếu không khớp.

## Lập lịch

**Hỏi: Lịch trình được tạo như thế nào?**
Đáp: Planning Agent chia điểm vào từng ngày bằng thuật toán **greedy theo quỹ thời gian** (mỗi ngày 09:00–17:00, tôn trọng giờ mở cửa, không nhồi hết vào ngày 1), rồi lấy tuyến và chọn phương tiện tốt nhất cho từng chặng.

**Hỏi: Khách sạn có vai trò gì?**
Đáp: Là **điểm neo** — mỗi ngày xuất phát từ khách sạn và quay về khách sạn buổi tối.

**Hỏi: Vì sao có lúc số liệu là "ước lượng"?**
Đáp: Khi người dùng thêm/bớt/đổi thứ tự điểm liên tục, hệ thống dùng ước lượng haversine **tức thì** (đánh dấu `is_estimated=True`) để khỏi chờ API. Tuyến thật từ OneMap chỉ lấy khi bấm **Optimize Route**.

**Hỏi: Có dùng thuật toán tối ưu toàn cục (TSP) không?**
Đáp: Không. Với 2–8 điểm/ngày, greedy "chọn điểm gần nhất" cho kết quả đủ tốt, chạy tức thì và dễ giải thích — phù hợp ràng buộc rate-limit và trải nghiệm realtime.

## Chọn & đổi phương tiện

**Hỏi: Phương tiện "tốt nhất" được chọn dựa trên gì?**
Đáp: Chấm điểm 4 tiêu chí có trọng số — **thời gian, chi phí, thời gian đi bộ, số lần chuyển tuyến** — với trọng số điều chỉnh theo sở thích người dùng và ngữ cảnh (mưa, giờ cao điểm).

**Hỏi: Có những phương tiện nào?**
Đáp: `BUS`, `METRO` (MRT), `CYCLE` (xe đạp), `WALK` (đi bộ), `GRAB`. GRAB không tham gia chấm điểm; chỉ được đề xuất khi chặng ≥2km mà không có phương tiện công cộng.

**Hỏi: "Switch now" khác "đổi phương tiện" thường ở chỗ nào?**
Đáp: "Đổi phương tiện" (PATCH leg) dùng dữ liệu đã nạp sẵn ở chế độ kế hoạch. "Switch now" định tuyến lại **từ vị trí GPS hiện tại** khi bạn đang đi (dành cho lúc bị lạc).

## Điều chỉnh & cảnh báo

**Hỏi: App tự điều chỉnh khi trời mưa thế nào?**
Đáp: Nếu dự báo mưa > 70% và chuyến có điểm ngoài trời, Adaptation Agent **đề xuất** đổi điểm ngoài trời sang điểm trong nhà gần nhất (≤5km, tìm bằng PostGIS). Người dùng phải đồng ý mới áp dụng.

**Hỏi: Khi MRT gián đoạn thì sao?**
Đáp: Adaptation Agent định tuyến lại chặng MRT sang bus (chiến lược "thử PT → hậu kiểm → ép bus nếu vẫn dính tuyến lỗi"). Nếu không có bus, giữ chặng cũ và đánh dấu cần lưu ý.

**Hỏi: Cảnh báo đến trình duyệt bằng cách nào?**
Đáp: Qua **Supabase Realtime (WebSocket)** — backend insert vào bảng `lta_alerts`, Supabase đẩy ngay tới client. Không có polling phía client.

**Hỏi: App có tự ý sửa lịch của tôi không?**
Đáp: Không bao giờ. Mọi thay đổi từ Adaptation Agent và Chatbot đều là **đề xuất**, chỉ áp dụng sau khi bạn xác nhận (User Consent Flow).

## Chatbot

**Hỏi: Chatbot làm được gì?**
Đáp: Trả lời câu hỏi về chuyến/địa điểm/thời tiết/giờ bus (read-only) và **đề xuất** sửa lịch (thêm/xoá điểm, đổi thứ tự, đổi phương tiện, thêm/bớt ngày, tối ưu). Mọi sửa đổi cần bạn bấm xác nhận.

**Hỏi: Chatbot có nói tiếng Việt không?**
Đáp: Có. Nó tự nhận diện ngôn ngữ tin nhắn mới nhất và trả lời bằng đúng ngôn ngữ đó (Việt hoặc Anh).

**Hỏi: Chatbot có bịa địa điểm không?**
Đáp: Không. Nó bị ràng buộc chỉ gợi ý điểm có trong tập dữ liệu tuyển chọn (dùng công cụ tra cứu, không tự bịa place_id).

## Kỹ thuật & vận hành

**Hỏi: Dữ liệu lưu ở đâu?**
Đáp: Supabase (PostgreSQL + PostGIS). Các bảng chính: `trips`, `trip_places`, `route_legs`, `lta_alerts`, `trip_feedback`, `user_preferences`.

**Hỏi: Backend chạy được khi không có database không?**
Đáp: Có. Có cơ chế fallback bộ nhớ tiến trình (`_trip_store`, `_trip_meta`) để demo offline — dữ liệu mất khi restart.

**Hỏi: Dùng những API ngoài nào?**
Đáp: OneMap (định tuyến + geocode Singapore), LTA DataMall (cảnh báo tàu + giờ bus), OpenWeather (thời tiết), Google Gemini (LLM).

**Hỏi: Vì sao có endpoint `/health`?**
Đáp: Backend dự kiến chạy trên Render free tier (ngủ đông sau ~15 phút). `/health` dùng để ping giữ server tỉnh.

**Hỏi: Chạy dự án thế nào?**
Đáp: Backend: `cd backend && uvicorn app.main:app --reload` (đặt `.env` trong `backend/`). Frontend: `cd frontend && npm install && npm run dev` (localhost:5173). Test: `pytest tests/ -v` (BE), `npm test` (FE).

**Hỏi: Tài liệu cũ nói "3 agents, 4 routers" — có đúng không?**
Đáp: Không còn đúng. Code hiện tại có **4 agent** (thêm Chat) và **7 router** (health, places, trips, alerts, transit, preferences, chat). Hãy tin theo code.
