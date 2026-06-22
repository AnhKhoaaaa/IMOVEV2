# Tóm Tắt Backend Security Fix

## Mục Tiêu Chung

Mục tiêu của đợt sửa này là làm cho backend kiểm tra quyền truy cập trip chặt hơn.

Trước đó frontend có thể vẫn hiển thị dữ liệu cũ sau khi logout, nhưng vấn đề quan trọng hơn là backend phải chắc chắn rằng:

- User chỉ được xem/sửa/xóa trip của chính mình.
- User không thể giả mạo `user_id` của người khác.
- Dữ liệu alert và feedback không bị đọc/ghi nhầm qua trip của người khác.

Nói ngắn gọn: frontend có thể hiển thị nhầm UI, nhưng backend không được phép trả hoặc sửa dữ liệu riêng tư nếu user không có quyền.

## 1. Không Tin `user_id` Do Frontend Gửi Lên

### Vấn đề cũ

Khi tạo trip, frontend có gửi `user_id` trong request body.

Nếu backend tin trực tiếp giá trị này thì một client xấu có thể tự sửa request và gửi `user_id` của người khác.

Ví dụ ý tưởng:

```json
{
  "user_id": "id-cua-nguoi-khac"
}
```

Nếu backend lưu theo `user_id` này thì dữ liệu có thể bị gắn sai chủ.

### Đã sửa gì

Backend không dùng `user_id` trong body nữa.

Thay vào đó, backend lấy user thật từ Supabase JWT trong header:

```txt
Authorization: Bearer <token>
```

Nếu có token hợp lệ, trip được gắn với user trong token. Nếu không có token, trip được xem là guest trip.

### Mục đích

Đảm bảo user không thể tự khai "tôi là ai" từ phía frontend.

Backend phải tự xác minh user dựa trên token đã được Supabase xác thực.

## 2. Bắt Buộc Đúng Chủ Trip Mới Được Xem/Sửa/Xóa

### Vấn đề cũ

Một số endpoint trip chưa bắt buộc kiểm tra owner đầy đủ.

Điều này nguy hiểm vì nếu ai đó biết hoặc đoán được `trip_id`, họ có thể thử gọi API như:

```txt
GET /trips/<trip_id>
PATCH /trips/<trip_id>/legs/<leg_id>
DELETE /trips/<trip_id>
```

Nếu backend không kiểm tra "trip này thuộc user nào", dữ liệu riêng tư có thể bị lộ hoặc bị sửa.

### Đã sửa gì

Backend thêm kiểm tra ownership cho các thao tác quan trọng trên trip:

- Lập kế hoạch trip.
- Xem trip.
- Đổi transport mode của leg.
- Switch leg theo vị trí hiện tại.
- Adapt trip.
- Update location.
- Xóa trip.
- Accept swap.
- Check alerts.
- Các thao tác optimize/add/remove/reorder/day vốn đã có kiểm tra owner thì tiếp tục dùng cùng logic chặt hơn.

Logic mới:

- Nếu trip có `user_id`, request phải có JWT đúng user đó.
- Nếu thiếu JWT hoặc JWT thuộc user khác, backend trả `403 Access denied`.
- Guest trip hiện vẫn được giữ tương thích để tránh phải sửa frontend ngay.

### Mục đích

Ngăn người khác đọc/sửa/xóa trip không thuộc về họ.

Đây là lớp bảo vệ chính. Dù frontend có lỗi hiển thị, backend vẫn không cho thao tác trái quyền.

## 3. Chatbot Cũng Phải Truyền Thông Tin User Khi Sửa Trip

### Vấn đề cũ

Chatbot có thể gọi trực tiếp các hàm sửa trip ở backend.

Nếu các lời gọi nội bộ này không truyền `current_user`, handler sửa trip không đủ thông tin để kiểm tra quyền.

### Đã sửa gì

Các hành động chatbot như:

- đổi mode của leg
- switch leg now

đã truyền `current_user` vào handler trip.

### Mục đích

Đảm bảo mọi đường sửa trip đều đi qua cùng một kiểm tra quyền, kể cả khi thao tác đến từ chatbot.

Không để chatbot trở thành đường vòng bỏ qua security check.

## 4. Feedback Bắt Buộc Đăng Nhập Và Đúng Chủ Trip

### Vấn đề cũ

Endpoint feedback trước đó cho phép request không đăng nhập vẫn gửi feedback với một `trip_id`.

Điều này không nghiêm trọng bằng đọc/sửa trip, nhưng vẫn không đúng về bảo mật vì feedback thuộc dữ liệu của user/trip.

### Đã sửa gì

Backend hiện yêu cầu:

- User phải đăng nhập.
- User phải là chủ của trip.

Nếu không đúng thì backend trả lỗi thay vì ghi feedback.

### Mục đích

Ngăn user lạ hoặc request không đăng nhập ghi dữ liệu vào trip của người khác.

Đồng thời giúp Memory Agent học từ feedback đúng user hơn.

## 5. Supabase Alert Không Còn Public Read

### Vấn đề cũ

Policy cũ của bảng `lta_alerts` cho phép đọc công khai:

```sql
for select using (true)
```

Nghĩa là client có thể đọc alert mà không cần kiểm tra chủ trip.

Alert có thể chứa thông tin liên quan lịch trình, thời gian hoặc địa điểm, nên không nên public.

### Đã sửa gì

Đã thêm migration mới:

```txt
supabase/migrations/020_lta_alerts_owner_policy.sql
```

Migration này bỏ policy public read và thay bằng policy chỉ cho chủ trip đọc alert.

### Mục đích

Đảm bảo alert chỉ được đọc bởi user sở hữu trip liên quan.

Lưu ý: phải chạy migration này trên Supabase thật thì production database mới được bảo vệ.

## 6. Test Được Bổ Sung

### Đã thêm gì

Đã bổ sung test cho các case bảo mật:

- Tạo trip không được giả mạo `user_id`.
- Trip có chủ không cho request thiếu JWT truy cập.
- Trip có chủ không cho user khác truy cập.
- Chủ trip vẫn truy cập được bình thường.
- Guest trip vẫn giữ tương thích.
- Feedback thiếu login bị chặn.
- Feedback của user khác bị chặn.

### Mục đích

Giữ cho lỗi cũ không bị quay lại trong các lần sửa sau.

Nếu sau này ai đó vô tình bỏ ownership check, test sẽ giúp phát hiện.

## File Đã Sửa / Thêm

Backend files:

- `backend/app/routers/trips.py`
- `backend/app/routers/chat.py`
- `backend/app/routers/alerts.py`

Test files:

- `backend/tests/test_routers/test_alerts.py`
- `backend/tests/test_routers/test_trip_authorization.py`

Supabase migration:

- `supabase/migrations/020_lta_alerts_owner_policy.sql`

## Việc Cần Làm Sau Khi Merge/Deploy

- Deploy backend lên Render.
- Chạy migration `020_lta_alerts_owner_policy.sql` trên Supabase.
- Test lại:
  - login tạo trip
  - mở trip đúng user
  - logout rồi refresh trip
  - login user khác mở trip cũ
  - gửi feedback đúng user
  - kiểm tra Network không có lỗi CORS bất thường

## Phần Chưa Sửa Trong Đợt Này

Các phần sau thuộc frontend/mobile nên chưa sửa trong backend pass này:

- Logout rồi UI vẫn còn màn hình trip cũ.
- UI xử lý `401/403` chưa đẹp.
- PWA/mobile install.
- Guest trip security chặt hơn bằng guest token/session proof.

Những phần này nên xử lý ở frontend pass sau để tránh conflict.
