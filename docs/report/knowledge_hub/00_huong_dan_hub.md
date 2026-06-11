# IMOVE V2 — Hướng dẫn dùng Knowledge Hub (NotebookLM)

> **Bối cảnh chung (đọc 1 lần):** IMOVE V2 là một **web app lập kế hoạch du lịch bằng giao thông công cộng ở Singapore** dành cho khách du lịch. Kiến trúc: **FastAPI backend** với các **AI agent** (Planning, Adaptation, Memory, Chat) → **React 18 frontend** → **Supabase** (Database + Auth + Realtime) → **Google Gemini 2.5 Flash** (LLM). Ràng buộc cốt lõi: **~75% logic bằng code quy tắc, ~25% bằng LLM**.

---

## 1. Hub này là gì?
Đây là tập hợp các tài liệu được biên soạn để upload **trực tiếp lên NotebookLM**, tạo thành một "trung tâm tra cứu" (knowledge hub) cho cả nhóm. Bất kỳ thành viên nào — kể cả người không code — đều có thể **đặt câu hỏi bằng ngôn ngữ tự nhiên** và NotebookLM sẽ trả lời dựa trên các tài liệu này (có trích nguồn).

## 2. Danh sách nguồn (sources) và nên hỏi gì ở đâu
Mỗi file dưới đây là **một nguồn độc lập, tự chứa đủ ngữ cảnh**. Khi hỏi NotebookLM, bạn không cần biết file nào — nhưng bảng này giúp bạn hiểu phạm vi:

| File | Nội dung | Hỏi khi bạn muốn biết… |
|---|---|---|
| `00_huong_dan_hub.md` (file này) | Cách dùng hub + câu hỏi mẫu | "Hub này có gì? Hỏi thế nào?" |
| `01_tong_quan_san_pham.md` | Vấn đề, tầm nhìn, người dùng, tính năng | "App giải quyết vấn đề gì? Ai dùng? Có tính năng gì?" |
| `02_kien_truc_he_thong.md` | Tech stack, các tầng, 4 agent, luồng dữ liệu, triển khai | "App được xây bằng gì? Các thành phần kết nối ra sao?" |
| `03_thuat_toan_logic_nghiep_vu.md` | Thuật toán lập lịch, chấm điểm phương tiện, điều chỉnh, học sở thích, chatbot | "Lịch trình được tạo thế nào? Chọn phương tiện ra sao?" |
| `04_tham_chieu_api.md` | Mọi endpoint của backend (method, path, input, output) | "Endpoint X làm gì? Gọi thế nào?" |
| `05_mo_hinh_du_lieu_db.md` | Bảng database, quan hệ, vòng đời chuyến đi, migrations | "Dữ liệu lưu ở đâu? Bảng nào chứa gì?" |
| `06_tham_chieu_frontend.md` | Trang, component, hook, gọi API phía client | "Màn hình nào làm gì? Component X ở đâu?" |
| `07_faq.md` | Câu hỏi thường gặp dạng Hỏi–Đáp | Tra nhanh các thắc mắc phổ biến |
| `08_thuat_ngu.md` | Từ điển thuật ngữ | "Leg là gì? Dwell là gì? PostGIS để làm gì?" |
| `breakdown.md` (ở thư mục `docs/report/`) | Phân rã theo **tư duy tính toán** để viết báo cáo | "CT pillar nào thể hiện ở đâu trong code?" |

> **Khuyến nghị upload:** đưa **tất cả** các file `.md` trong `docs/report/knowledge_hub/` **và** file `docs/report/breakdown.md` vào cùng một notebook trên NotebookLM.

## 3. Quy ước trong toàn bộ hub
- Ngôn ngữ: **tiếng Việt**, giữ nguyên **thuật ngữ kỹ thuật tiếng Anh** (vì code và API dùng tiếng Anh).
- Đường dẫn file luôn tính từ gốc repo, ví dụ `backend/app/agents/planning_agent.py`.
- Nhãn `[CODE]` = logic giải bằng quy tắc (deterministic); `[LLM]` = phần dùng Gemini.
- Mọi mô tả bám theo **mã nguồn thực tế tại nhánh `main`**. Nếu tài liệu cũ (vd `CLAUDE.md`) khác với code, tin theo code.

## 4. Câu hỏi mẫu để thử NotebookLM
**Cho người mới / không code:**
- "Tóm tắt IMOVE V2 trong 5 câu cho người chưa biết gì."
- "Người dùng không đăng nhập có dùng được không? Khác gì người đã đăng nhập?"
- "App tự điều chỉnh lịch khi trời mưa như thế nào?"

**Cho người viết báo cáo:**
- "Liệt kê các tính năng cốt lõi và điểm sáng tạo (innovation)."
- "Decomposition được áp dụng ở đâu trong dự án?"
- "Tech stack gồm những gì cho FE, BE, DB, AI?"

**Cho người code / tích hợp:**
- "Endpoint nào dùng để đổi phương tiện của một chặng?"
- "Thuật toán chia điểm vào từng ngày hoạt động ra sao?"
- "Bảng `route_legs` có những cột nào và cột `is_estimated` nghĩa là gì?"
- "Chatbot đảm bảo không tự ý sửa lịch bằng cách nào?"

## 5. Lưu ý quan trọng khi đọc câu trả lời của NotebookLM
- NotebookLM **chỉ trả lời dựa trên các nguồn đã upload**; nếu thiếu thông tin, nó sẽ nói không tìm thấy thay vì bịa.
- Các tài liệu này mô tả **kiến trúc & hành vi**, không phải bản sao đầy đủ của code. Khi cần chi tiết dòng-lệnh, hãy mở đúng file nguồn được trích dẫn.
- Một số giá trị (ngưỡng, hằng số) được nêu kèm để tra cứu nhanh; nếu code thay đổi, cập nhật lại tài liệu rồi upload lại.
