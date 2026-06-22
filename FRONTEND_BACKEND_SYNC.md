# Ghi Chú Đồng Bộ Frontend Sau Khi Backend Fix Ownership

## Bối Cảnh

Những thay đổi chính ở backend:

- Backend không còn tin `user_id` frontend gửi lên khi tạo trip.
- Trip của user đăng nhập bắt buộc phải có Supabase JWT đúng chủ mới được xem/sửa/xóa.
- Feedback bắt buộc đăng nhập và phải đúng chủ trip.
- Migration `020_lta_alerts_owner_policy.sql` giới hạn `lta_alerts`: chỉ chủ của trip liên quan mới đọc được alert.


## Quan Trọng: Chưa Có Blocker Frontend Ngay

`frontend/src/services/api.js` hiện đã tự gắn Supabase access token vào header:

```txt
Authorization: Bearer <token>
```

Vì vậy flow user đã đăng nhập nhiều khả năng vẫn chạy bình thường sau khi backend deploy.

## Các Phần Frontend Cần Đồng Bộ

### 1. Xử Lý `401` Và `403` Cho Đẹp

File có khả năng cần sửa:

- `frontend/src/services/api.js`
- `frontend/src/pages/Trip.jsx`
- `frontend/src/pages/Planner.jsx`
- `frontend/src/hooks/useTrip.js`

Backend giờ có thể trả:

- `401`: user chưa đăng nhập hoặc token không hợp lệ.
- `403`: user đã đăng nhập nhưng không phải chủ của trip.

Nên xử lý UI như sau:

- Hiện thông báo dễ hiểu, ví dụ: "Bạn không có quyền truy cập trip này."
- Clear màn hình/state trip hiện tại.
- Điều hướng về `/`, trang login, hoặc Home thay vì để UI cũ đứng im.

Ghi chú:

Đây chủ yếu là cần đồng bộ UX. Backend đã chặn API nguy hiểm rồi.

### 2. Reset UI Khi Logout

File có khả năng cần sửa:

- `frontend/src/contexts/AuthContext.jsx`
- `frontend/src/components/layout/Header.jsx`
- `frontend/src/pages/Planner.jsx`
- `frontend/src/pages/Trip.jsx`
- `frontend/src/components/chat/ChatWidget.jsx`

Vấn đề hiện tại:

Nếu user đang tạo/xem trip rồi logout, React state có thể vẫn hiện màn hình trip cũ.

Nên xử lý:

- Khi Supabase báo event `SIGNED_OUT`, reset planner/trip/chat state.
- Điều hướng về `/` hoặc hiện login modal.
- Dừng các background call sau khi logout, ví dụ:
  - `checkAlerts`
  - `updateLocation`
  - chat calls
  - feedback calls

Ghi chú bảo mật:

Frontend reset UI không phải lớp bảo vệ chính. Backend mới là lớp chặn API. Phần này giúp UI không gây hiểu nhầm cho user.

### 3. Bỏ `user_id` Khỏi Request Tạo Trip

File có khả năng cần sửa:

- `frontend/src/pages/Planner.jsx`

Hiện tại frontend có gửi đại khái:

```js
user_id: user?.id ?? null
```

Backend mới đã bỏ qua field này và lấy user thật từ JWT.

Nên cleanup:

- Xóa `user_id` khỏi body khi gọi create trip.
- Việc này không gấp, vì backend đã an toàn rồi.

### 4. Cập Nhật Cache/State Khi User Thay Đổi

File có khả năng cần sửa:

- `frontend/src/hooks/useTrip.js`
- `frontend/src/services/api.js`

Rủi ro:

Trip data có cache theo user key, nhưng hook vẫn có thể giữ state cũ nếu user logout/login khi page chưa unmount.

Nên xử lý:

- Khi `user?.id` thay đổi, clear trip state cũ hoặc refetch lại.
- Nếu refetch trả `401/403`, không fallback sang cache cũ của user trước.

### 5. Feedback Giờ Bắt Buộc Login

File có khả năng cần sửa:

- `frontend/src/components/adaptation/AlertActionCard.jsx`

Backend mới bắt buộc `/alerts/feedback` phải có user đăng nhập và đúng chủ trip.

Nên xử lý:

- Nếu chưa đăng nhập, ẩn nút feedback hoặc hiện "Vui lòng đăng nhập để gửi feedback."
- Nếu feedback bị `401/403`, hiện message nhỏ, không show raw error.

### 6. Supabase Alert Realtime Phụ Thuộc Migration

File có khả năng cần sửa:

- `frontend/src/hooks/useAlerts.js`
- `frontend/src/components/adaptation/AlertActionCard.jsx`
- `frontend/src/pages/Trip.jsx`

Sau khi chạy migration `020_lta_alerts_owner_policy.sql`, client chỉ đọc được alert của trip mà user đăng nhập sở hữu.

Nên xử lý:

- Chỉ subscribe alert khi có user session.
- Sau logout nếu alert query/subscription rỗng thì xem là bình thường.
- Không giả định `lta_alerts` còn public read.

## PWA / Mobile Install

Phần này chưa nằm trong fix backend hiện tại.

Nếu làm PWA sẽ đụng đến frontend, cần coordinate riêng:

- `frontend/package.json`
- `frontend/vite.config.js`
- `frontend/index.html`
- icon 192x192 và 512x512
- service worker / manifest setup

Cách user cài trên iOS:

- Mở web bằng Safari.
- Bấm Share.
- Bấm "Add to Home Screen".

Android thường dễ hơn, Chrome có thể hiện install prompt sau khi PWA setup đầy đủ.

## Checklist Test Sau Khi Deploy Backend Và Chạy Migration

- Đăng nhập và tạo trip mới.
- Mở `/trip/<id>` khi đang login.
- Logout, refresh `/trip/<id>`, đảm bảo không hiện private trip data.
- Đăng nhập bằng account khác, mở `/trip/<id>` của user đầu tiên, phải bị access denied.
- Gửi feedback khi đang login đúng chủ trip, phải thành công.
- Gửi feedback khi logout, UI nên yêu cầu login hoặc block.
- Kiểm tra Console/Network không có lỗi CORS bất thường.
- Nếu có `401/403`, UI phải xử lý đẹp, không để user kẹt ở màn hình cũ.

## Ghi Chú Để Tránh Conflict

Dev frontend nên tránh sửa các file backend trong pass này.

Backend files đã thay đổi:

- `backend/app/routers/trips.py`
- `backend/app/routers/chat.py`
- `backend/app/routers/alerts.py`
- `backend/tests/test_routers/test_alerts.py`
- `backend/tests/test_routers/test_trip_authorization.py`
- `supabase/migrations/020_lta_alerts_owner_policy.sql`

Frontend files có khả năng cần đụng đến sau:

- `frontend/src/services/api.js`
- `frontend/src/contexts/AuthContext.jsx`
- `frontend/src/components/layout/Header.jsx`
- `frontend/src/pages/Planner.jsx`
- `frontend/src/pages/Trip.jsx`
- `frontend/src/hooks/useTrip.js`
- `frontend/src/hooks/useAlerts.js`
- `frontend/src/components/chat/ChatWidget.jsx`
- `frontend/src/components/adaptation/AlertActionCard.jsx`
