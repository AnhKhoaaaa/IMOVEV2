# IMOVE V2 — Tổng quan sản phẩm

> **Bối cảnh chung:** IMOVE V2 là web app lập kế hoạch du lịch bằng giao thông công cộng ở Singapore cho khách du lịch. Backend FastAPI + các AI agent (Planning, Adaptation, Memory, Chat) → frontend React 18 → Supabase (DB + Auth + Realtime) → Gemini 2.5 Flash. Ràng buộc: ~75% code quy tắc, ~25% LLM.

---

## 1. Vấn đề (Problem Statement)
Khách du lịch ở Singapore muốn dùng MRT/bus để tham quan nhưng gặp 3 khó khăn:
1. **Lập lịch thủ công mệt:** phải tự tra giờ mở cửa, thời gian di chuyển, chia điểm ra từng ngày hợp lý.
2. **Khó chọn phương tiện:** giữa MRT, bus, đi bộ, xe đạp, Grab — cái nào tốt hơn tuỳ từng chặng và sở thích.
3. **Lịch cứng nhắc khi có sự cố:** Singapore mưa bất chợt (hỏng điểm ngoài trời), MRT có thể gián đoạn (hỏng cả chuỗi di chuyển). App thường không tự điều chỉnh.

## 2. Tầm nhìn sản phẩm (Product Vision)
Một **trợ lý lập kế hoạch chuyến đi đa tác tử (multi-agent)**: người dùng chọn vài địa điểm + số ngày + ngân sách; hệ thống tự **lập lịch tối ưu**, **gợi ý phương tiện theo sở thích & ngữ cảnh**, và **chủ động đề xuất điều chỉnh** khi thời tiết/giao thông thay đổi.

## 3. Người dùng mục tiêu (Target Users)
- **Khách du lịch nước ngoài** tới Singapore, ưu tiên giao thông công cộng (chính).
- Hỗ trợ **song ngữ Việt–Anh** (giao diện qua `LanguageContext`; chatbot tự nhận diện ngôn ngữ người dùng).
- **Không bắt buộc đăng nhập:** khách (guest) dùng được toàn bộ lập lịch + điều chỉnh; chỉ tính năng **ghi nhớ sở thích** (Memory Agent) và **chatbot** mới cần đăng nhập.

## 4. Các loại người dùng/tác nhân (Actors)
- **Guest:** lập lịch, điều chỉnh, đổi phương tiện; danh tính qua `session_id` (UUID lưu ở localStorage). Không lưu sở thích lâu dài.
- **Authenticated user:** mọi thứ của guest + lưu/đồng bộ chuyến đi theo tài khoản + Memory Agent học sở thích + dùng chatbot.
- **Tác nhân hệ thống (tự động):** `APScheduler` chạy nền trong backend — kiểm tra cảnh báo MRT mỗi **2 phút**, thời tiết mỗi **30 phút**.

## 5. Tính năng cốt lõi (Core Features)
1. **Lập lịch tự động nhiều ngày** từ danh sách điểm + ngân sách; khách sạn làm **điểm neo** (mỗi ngày xuất phát & quay về khách sạn).
2. **Gợi ý điểm bằng AI** theo sở thích (travel styles) và loại nhóm (group type) — Gemini chọn & sắp xếp điểm.
3. **Chọn phương tiện thông minh cho từng chặng** bằng *chấm điểm đa tiêu chí có trọng số* (thời gian, chi phí, đi bộ, số lần chuyển tuyến), tự điều chỉnh theo mưa/giờ cao điểm.
4. **So sánh phương tiện** (MRT/Bus/Walk/Cycle/Grab) ngay trên giao diện; có **deeplink mở app Grab**.
5. **Đổi phương tiện một chặng:** ở chế độ kế hoạch (dùng dữ liệu đã nạp sẵn) và **đổi trực tiếp theo GPS** khi đang đi ("I'm lost").
6. **Điều chỉnh chủ động (adaptation):**
   - *Mưa:* đề xuất đổi điểm ngoài trời → điểm trong nhà gần nhất.
   - *Gián đoạn MRT:* tự định tuyến lại chặng MRT sang bus.
7. **Cảnh báo thời gian thực** đẩy về trình duyệt qua **Supabase Realtime (WebSocket)** — không cần client hỏi liên tục (polling).
8. **Giờ xe bus thực tế** từ LTA (đếm ngược chuyến kế tiếp tại trạm).
9. **Trợ lý hội thoại (Chatbot)** song ngữ; sửa lịch theo **quy trình hai bước: đề xuất → người dùng xác nhận**.
10. **Ghi nhớ & học sở thích** (Memory Agent) cho người đã đăng nhập, từ cả đánh giá tường minh lẫn hành vi ngầm.

## 6. Điểm sáng tạo (Innovation Highlights)
- **Kiến trúc đa tác tử + ràng buộc 75/25:** quyết định *deterministic* dùng code (rẻ, kiểm thử được); chỉ dùng LLM ở những chỗ ngôn ngữ tự nhiên/mơ hồ.
- **"Không ước lượng giả" (No fake estimates):** mọi lỗi API ngoài đều ném exception có kiểu rõ ràng (`NoRouteError`, `LTAUnavailableError`, `WeatherUnavailableError`); khi buộc phải ước lượng (đường nhanh không gọi API thật) thì **đánh dấu `is_estimated=True`** để UI hiển thị minh bạch.
- **Quy trình đồng thuận người dùng (User Consent Flow):** Adaptation Agent và Chat Agent **không bao giờ tự sửa** lịch — luôn tạo đề xuất, chờ người dùng chấp nhận mới ghi.
- **Mô hình giá Grab tự xây** khi OneMap không hỗ trợ chế độ lái xe (theo bảng giá Grab Singapore 2026).
- **Chạy được cả khi không có Supabase:** backend có cơ chế fallback bộ nhớ để demo offline vẫn hoạt động.

## 7. Phạm vi dữ liệu
- Tập điểm tham quan được **tuyển chọn sẵn (~50 POI)**: `backend/app/data/singapore_places.json` — mỗi điểm có toạ độ, loại, giờ mở cửa, thời gian lưu lại gợi ý (dwell), khung giờ nên thăm, có ở ngoài trời hay không.
- Khách sạn không nằm trong tập tuyển chọn — người dùng nhập tự do, geocode qua OneMap.

## 8. Ràng buộc kỹ thuật quan trọng (để hiểu các quyết định thiết kế)
- **Gemini rate limit:** tối đa ~1 lời gọi / 4 giây (≤15 RPM) → có guard chung trong `services/gemini.py`.
- **Render free tier ngủ đông sau ~15 phút:** có endpoint `GET /health` để ping giữ sống.
- **Số liệu định tuyến thật chỉ lấy từ OneMap;** không bịa số khi API fail.
