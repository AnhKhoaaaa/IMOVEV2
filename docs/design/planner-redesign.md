# planner-redesign.md — Bố cục mới trang Planner (Phase 3, theo yêu cầu user)

> Giữ wizard 4 bước + sidebar. **Logic planning giữ nguyên** (`createPlan`, state, effects). Đây là thay đổi **bố cục + trình bày**, cộng vài cải tiến nhỏ có chủ đích (đã thống nhất). Mockup: `docs/design/planner-redesign-mockup.html`.

## Nguyên tắc chung
- Mỗi bước = một "khoảnh khắc" rõ ràng: tiêu đề + mô tả ngắn, các input nhóm theo section có header + icon, khoảng thở rộng → **không bị nhạt nhoà**.
- Token đã khóa: brand blue, state pastel, pill action + shadow B, input 10px, card 16px, Plus Jakarta Sans cho tiêu đề.

---

## Bước 1 — Essentials  *(đề xuất bố cục mới)*
Chuyển từ lưới 2×2 input nhỏ → **các section dọc, mỗi input có sức nặng riêng:**

1. **Trip Name** — input **full-width, lớn (h-12)**, icon ✏️ bên trái, là "danh tính" chuyến đi → đặt trên cùng, nổi bật nhất.
2. **Transit Budget** — input full-width có **tiền tố `S$`**, cỡ lớn; kèm **chip chọn nhanh** (S$30 · S$50 · S$80) để không bị "ô số nhạt". Helper: ngân sách di chuyển/ngày.
3. **Dates Mode** — **segmented pill** `[ Linh hoạt | Theo lịch ]` (brand blue khi active):
   - *Linh hoạt* → **stepper số ngày** `−  3 ngày  +` (to, dễ bấm) thay ô number nhỏ.
   - *Theo lịch* → `DateRangePicker` inline.
4. **Daily start time** — **segmented** `[ Đồng bộ mọi ngày | Mỗi ngày riêng ]`:
   - *Đồng bộ* → **1 TimePicker lớn** áp cho tất cả ngày.
   - *Mỗi ngày* → lưới TimePicker từng ngày (như cũ).
   - *(mới)* mặc định "Đồng bộ"; data nền `dayStartTimes` giữ nguyên (sync = fill mọi phần tử).
- **Auto-optimize: ĐÃ CHUYỂN sang Bước 4.**

## Bước 2 — Hotel location  *(redesign nổi bật như B1)*
- Giữ logic geocode/debounce. Nâng cấp trình bày: ô tìm kiếm **lớn, có icon 📍**, gợi ý kết quả dạng card rõ ràng; trạng thái đã chọn = card **success (emerald) nổi bật**; nhãn "Tùy chọn" rõ. Cùng nhịp section như B1.

## Bước 3 — Travel Style
- **Giữ như cũ** (4–5 preset card + bảng phân bổ trọng số). Chỉ đồng bộ token (radius/màu/shadow, bỏ màu lệch nếu có).

## Bước 4 — Places  *(thay đổi bố cục)*
- **Main (trái, rộng):** POI search/browser dạng lưới **3 place/dòng** (hiện 2/dòng) → tận dụng không gian, chuyên nghiệp.
- **Aside (phải) xếp dọc:** ① **Summary** → ② **Selected shortlist (ngay DƯỚI summary)** → ③ **toggle Auto-optimize** (chuyển từ B1) → ④ **CTA Tạo kế hoạch** + Back.
- Redesign card POI nhất quán (token category on-brand), trạng thái chọn/bỏ rõ.

## Sidebar Config Summary (xuyên suốt)
- Giữ nội dung; đồng bộ token (bỏ inline hex `#2563eb/#94a3b8` → class). Ở B4, Selected nằm dưới summary như trên.

## Bất biến (KHÔNG đổi)
- `createPlan` payload, `api.createTrip/planTrip/saveTrip`, navigate, state machine 4 bước, AuroraBackground, AnimatedGenerateButton.
