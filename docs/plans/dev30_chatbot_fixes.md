# dev30 — Chatbot fixes (audit follow-up)

Sửa các vấn đề frontend + backend tìm thấy khi audit chatbot. Ưu tiên 🔴 đỏ và 🟡 vàng;
🟢 xanh để lại đợt sau. Giữ nguyên logic nghiệp vụ; mỗi batch: code → test → commit riêng
(ghi line-range để cherry-pick).

Phạm vi file: `frontend/src/components/chat/ChatWidget.jsx`, `ChatBlocks.jsx`,
`backend/app/agents/chat_agent.py`, `backend/app/routers/chat.py`.

---

## Batch 1 — Frontend: design tokens (🔴#1, 🟡#2, 🟡#3)

**Mục tiêu:** chatbot dùng đúng design system; bỏ màu `teal` lạc tông.

- **#1** Thay toàn bộ `teal-*` → token thương hiệu:
  - Card đề xuất + nút Confirm: `bg-teal-700/800` → `bg-primary-600/hover:bg-primary-700`
    (hoặc dùng `<Button>` mặc định nếu giữ shape phù hợp — xem ghi chú nút bên dưới).
  - Header bot icon guest, Sparkles, quick-action hover: `teal-*` → `primary-*` / `slate-*`.
  - `ShieldCheck` chip: `bg-teal-50 text-teal-700` → `bg-primary-50 text-primary-600`.
- **#2** Màu thô → token state:
  - bubble alert chủ động `border-amber-200 bg-amber-50 text-amber-950` → `warning` token.
  - badge unread `bg-red-500` → `bg-danger-500`.
  - (giữ `bg-blue-600` user/send vì cả app dùng — hoặc đổi `primary-600` cho nhất quán nhẹ.)
- **#3** Chuẩn hoá radius: card/panel theo thang (panel `rounded-2xl`, control `rounded-[10px]`).
  **Giữ hình dáng nút hiện tại** (user đã chốt thích nút cũ ở Home) — chỉ sửa MÀU + radius,
  KHÔNG ép sang pill `<Button>` trừ khi user đồng ý.

**Acceptance:** `npm run build` sạch; 230/230 test; không còn class `teal-` trong ChatWidget;
review thị giác panel + card đề xuất.

---

## Batch 2 — Frontend: UX hội thoại (🔴#5, 🟡#7, 🟡#8)

- **#5** Điều hướng KHÔNG xoá hội thoại:
  - Tách effect reset: chỉ reset khi đổi **user** (đăng nhập/đăng xuất), KHÔNG reset khi đổi `tripId`.
  - Bỏ `surfacedRef.current.clear()` khỏi nhánh đổi tripId để alert đã hiển thị không bị đăng lại
    (giữ set theo phiên; nếu cần, dedupe theo `alert.id` vốn đã unique).
- **#7** Không tăng `unread` khi panel đang mở (`if (!open) setUnread(...)` cho cả nhánh phraseAlert,
  đồng bộ với nhánh companion đã làm đúng).
- **#8** Quick-actions hiển thị theo "user CHƯA gửi tin", không theo `messages.length`:
  thêm cờ `hasUserSent` (bật khi `send()` chạy) thay cho điều kiện `messages.length <= 1`.

**Acceptance:** mở widget → đăng alert chủ động → điều hướng trip rồi quay lại: hội thoại còn,
không nhân đôi alert; quick-actions không biến mất do alert; build + test xanh.

---

## Batch 3 — Backend: chống rò rỉ & vỡ state (🔴#11, 🔴#12)

> Fix triệt để (Supabase-backed pending store) NẰM NGOÀI đợt này — chỉ giảm thiểu an toàn,
> không đổi hợp đồng API.

- **#12** Giới hạn lịch sử: cắt `_chat_history[session]` về tối đa N phần tử gần nhất
  (ví dụ giữ 20 lượt) sau mỗi lượt → chặn phình bộ nhớ & giảm token gửi Gemini.
- **#12** GC theo TTL: gắn timestamp cho mỗi session (`_chat_ctx`/history/pending); dọn session
  quá hạn (vd > 2h không hoạt động) ở đầu `run_chat`/`companion_check`. Dọn `_pending_actions`
  hết hạn (vd > 30 phút).
- **#11** Thông điệp Confirm thân thiện khi pending mất (restart/hết hạn): router `/confirm`
  trả thông báo rõ "đề xuất đã hết hạn, hãy yêu cầu lại" thay vì 404 trống
  (giữ 404 status nhưng detail rõ; frontend hiển thị câu này).

**Acceptance:** test mới: history bị cắt đúng N; pending hết hạn → confirm trả thông điệp rõ;
`pytest backend/tests/test_routers/test_chat.py backend/tests/test_agents/test_chat_agent.py` xanh.

---

## Batch 4 — Backend: đúng đắn logic (🟡#13, 🟡#14, 🟡#15, 🟡#16)

- **#13** `get_weather` fallback GPS: khi model gọi thiếu `lat/lng`, dùng `ctx["gps"]`; và thêm
  một câu trong system prompt báo "đã có GPS user, gọi get_weather không cần toạ độ".
- **#14** Validate `reorder_places` ở khâu build proposal: nạp plan, kiểm mọi `place_id` thuộc
  đúng ngày đó (giống add/remove/change_leg), trả error rõ nếu lệch.
- **#15** Khi đè `_pending_actions[session]`, log/đánh dấu rằng đề xuất cũ bị thay (tránh 409 khó hiểu);
  frontend vốn chỉ giữ 1 pending nên hành vi nhất quán — chủ yếu là phòng vệ + comment.
- **#16** `/confirm`: nếu request kèm `trip_id` hiện tại của client và lệch `pending["trip_id"]`,
  trả cảnh báo (đề xuất thuộc chuyến khác) thay vì âm thầm áp lên chuyến cũ.
  *(Cần thêm field optional `trip_id` vào ChatConfirmRequest — kiểm tra model trước.)*

**Acceptance:** test "hỏi thời tiết ở đây" gọi được get_weather qua ctx gps; reorder sai ngày bị
chặn ở proposal; build + toàn bộ pytest chat xanh.

---

## Để lại đợt sau (🟢)
#4 emoji trong copy mascot · #6 gộp i18n CHAT_UI vào LanguageContext · #9 a11y dialog/focus-trap ·
#10 lưu hội thoại qua reload · #17 áp lực rate-limit Gemini (cần kiến trúc) · #18–20 (tinh chỉnh nhỏ).

## Thứ tự thực thi
Batch 1 → 2 (frontend, an toàn, đúng mạch redesign) → Batch 3 → 4 (backend).
Mỗi batch dừng lại để user duyệt trên app trước khi commit.
