# Các thay đổi

## Backend

- Sửa luồng tạo trip để không còn lỗi `Internal Server Error` khi Supabase local bị chặn hoặc không ghi được dữ liệu.
- Bổ sung fallback lưu trip trong bộ nhớ cho môi trường demo/local.
- Căn lại luồng lưu và đọc itinerary từ Supabase: `trips`, `trip_places`, `route_legs`.
- Sửa API cập nhật phương tiện của từng chặng để cập nhật được trong UI và không crash nếu phần ghi feedback phụ bị lỗi.
- Chặn tạm các API Memory Agent cần đăng nhập thật: `/alerts/feedback` và `/alerts/preferences` trả `501` cho đến khi có JWT Supabase.
- Sửa Memory Agent để không ghi feedback khi chưa có `user_id` hợp lệ.
- Sửa Planning Agent:
  - Không tạo thời gian/chi phí giả khi route thất bại.
  - Nếu public transit không có route cho hai điểm gần nhau, thử route đi bộ thật từ OneMap.
  - Không che lỗi OneMap auth thành lỗi route chung chung.
- Sửa OneMap service:
  - Gửi `date/time` cho cả route `walk`.
  - Hiển thị rõ nội dung lỗi auth/routing từ OneMap.

## Frontend

- Căn lại contract với backend trong `frontend/src/services/api.js`.
- Giới hạn mode phương tiện theo backend hỗ trợ: `MRT`, `LRT`, `BUS`, `WALK`.
- Sửa Planner để tạo itinerary ổn định với danh sách địa điểm curated.
- Sửa Auth modal để không crash khi Supabase Auth chưa cấu hình.
- Sửa realtime alerts để tự bỏ qua khi Supabase chưa cấu hình.
- Sửa Alert UI để hiểu các loại alert backend trả về: `train_delay`, `bus_cancellation`, `transport_alert`, `weather_warning`, `service_unavailable`.
- Sửa map itinerary:
  - Không crash khi thiếu tọa độ, không có leg, hoặc chỉ có một địa điểm.
  - Có placeholder khi không đủ dữ liệu bản đồ.
  - Tooltip hiển thị mode, thời gian, chi phí và trạng thái estimated.
- Sửa nested button trong card transit để tránh lỗi HTML/accessibility.
- Sửa dialog đổi phương tiện để có mô tả hợp lệ.

## Database

- Thêm migration `supabase/migrations/004_backend_contract_alignment.sql`.
- Migration bổ sung các cột backend đang dùng cho trip places, route legs, alerts và feedback.
- Thêm index hỗ trợ đọc route legs và unresolved alerts.
- Thêm RLS/policy cần thiết cho guest trip và realtime alerts.

## Tests

- Bổ sung/sửa test backend cho:
  - Trips router.
  - Planning Agent.
  - Memory Agent.
  - OneMap service.
  - Alerts router.
- Bổ sung/sửa test frontend cho:
  - Planner.
  - Trip page.
  - Header/Auth.
  - DayPlan/RouteCard.
  - TripMap.

## Kết quả kiểm thử gần nhất

- Backend: `101 passed, 4 skipped`.
- Frontend: `61 passed`.
- Frontend build: thành công.
- Build frontend có cảnh báo chunk-size của Vite, chưa phải lỗi chặn demo.
- Supabase integration tests được skip khi không có env thật.

## Lưu ý khi nhóm chạy lại

- Backend cần `backend/.env` có OneMap email/password thật, nếu không `Create Itinerary` sẽ báo lỗi OneMap auth.
- Frontend chạy ở `http://127.0.0.1:5173`.
- Backend chạy ở `http://127.0.0.1:8000`.
- Các file log/report sinh tự động khi test không cần đưa lên GitHub.
