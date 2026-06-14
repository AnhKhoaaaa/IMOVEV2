# dev28 — Date picker + Time picker nâng cấp & Confirm dialog xoá

## Bối cảnh & quyết định người dùng
- ✅ Đồng ý **range date picker** (demo `docs/design-samples/date-range-picker-demo.html`) → thay `<input type="date">` native.
- ✅ Nâng cấp **time picker** trong tab Planner (đang là `<input type="time">` native).
- ❌ **KHÔNG** làm trung tâm thông báo/chuông — alert tiếp tục sống trong chat (giữ nguyên `ChatWidget` + `AlertActionCard`). Không đụng phần thông báo.
- ✅ Sửa **warning khi xoá plan** — hiện dùng `window.confirm()` (không theo design) → dialog có style.

## Nguồn (skills)
- redesign-skill: "native date = lazy default", "no window.confirm/alert", "skeleton/empty/error states".
- design-taste-frontend §4.5 (states + tactile), §4.6 (label trên input), §6.B (reduced motion).

## Phụ thuộc mới
- `react-day-picker` ^9 (kéo theo `date-fns` nội bộ). Cài vào `frontend/package.json`. Không bỏ dependency nào.

## Thành phần xây mới (tái dùng)
1. `frontend/src/components/ui/DateRangePicker.jsx`
   - Bọc `react-day-picker` (DayPicker), hỗ trợ `mode="range"` và `mode="single"`.
   - `disabled={{ before: today }}` (chặn quá khứ), `today` highlight, readout "N ngày · 14–16 Jun".
   - Style bằng Tailwind v4 + token màu trung tính hiện có (chưa chốt palette → dùng slate/ink, đổi token sau).
   - Tôn trọng `prefers-reduced-motion` (đã bật toàn cục).
2. `frontend/src/components/ui/TimePicker.jsx`
   - Button hiển thị giờ (icon đồng hồ) → popover listbox các mốc 05:00–23:30 (bước 30’), chọn bằng chuột/bàn phím, đánh dấu mốc đang chọn, đóng khi click ngoài/Esc.
   - Props: `value`, `onChange`, `className`. A11y: `role="listbox"`, focus management.
3. `frontend/src/components/ui/ConfirmDialog.jsx`
   - Modal xác nhận: tiêu đề + mô tả + nút Huỷ (ghost) + nút hành động phá huỷ (đỏ). Backdrop, Esc đóng, focus vào nút Huỷ, `aria-modal`.
   - Dùng lại pattern overlay của `TripSetupModal` cho nhất quán.

## Điểm tích hợp
### A. Date picker
- **TripSetupModal** (`dateMode === 'specific'`): thay 2 ô start/end bằng `DateRangePicker mode="range"`; set `startDate`+`endDate`; suy `numDays` từ range. Nhánh `flexible` giữ stepper số ngày như cũ.
- **Planner** (mode Calendar, `!flexible`): thay ô start date bằng `DateRangePicker`.
  - Vì Planner có ô `numDays` độc lập (driver cho day-cards + per-day times), dùng **range** đồng bộ 2 chiều: chọn range → set `startDate` và `setNumDays(nights+1)`; đổi `numDays` thủ công → end suy lại = start + numDays-1. Effect sync `dayStartTimes` (L195-202) tự chạy theo `numDays`. Không phá per-day times.

### B. Time picker
- **Planner**: thay từng `<input type="time">` per-day (L540) bằng `TimePicker`.
- **TripSetupModal**: thay ô "Daily start time" (`<input type="time">` L278) bằng `TimePicker` (đồng bộ trải nghiệm).

### C. Confirm dialog xoá
- **Home.jsx** (`deleteTrip`, ~L241): bỏ `window.confirm`, mở `ConfirmDialog` (key i18n `homeDeleteConfirm`).
- **Trip.jsx** (`onDelete`, L1707): bỏ `window.confirm`, mở `ConfirmDialog` (key i18n `tripDeleteConfirm`).
- Thêm key i18n phụ nếu cần: tiêu đề dialog + nhãn nút (`confirmDeleteTitle`, `confirmDeleteBtn`, `cancelBtn`) VI/EN.

## KHÔNG đụng tới
- Phần thông báo (chat/alert), màu thương hiệu (palette chưa chốt — chỉ dùng token trung tính), `motion-footer`.

## Kiểm thử
1. `npm install` (react-day-picker) — không lỗi.
2. `npm run build` — pass.
3. `npm test` — bộ test hiện có pass; cập nhật test nếu chạm `Planner.test.jsx`/`Trip.test.jsx` (date/time/delete).
4. Kiểm tra mắt: chọn range chặn quá khứ, đếm ngày đúng; time picker mở/chọn; xoá plan hiện dialog đẹp, Esc/Huỷ/Cancel hoạt động; VI–EN đúng chữ.

## Commit (nhóm để cherry-pick)
- (A) build: add react-day-picker
- (B) feat(ui): DateRangePicker + TimePicker + ConfirmDialog
- (C) feat(planner): wire date range + time picker (Planner + TripSetupModal)
- (D) feat(trip/home): styled delete ConfirmDialog + i18n keys
