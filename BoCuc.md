# Bố cục frontend IMOVE

Frontend của đồ án được xây dựng bằng React và có **4 trang chính** được khai báo trong `frontend/src/App.jsx`.

## 1. Trang chủ / Dashboard

- **Đường dẫn:** `/`
- **Component:** `frontend/src/pages/Home.jsx`
- **Chức năng chính:**
  - Hiển thị tổng quan các chuyến đi đã lưu.
  - Thống kê chuyến đi hôm nay, sắp tới và trạng thái dữ liệu giao thông/thời tiết.
  - Tìm kiếm chuyến đi theo tên.
  - Lọc chuyến đi theo các nhóm: tất cả, hôm nay, sắp tới, bản nháp và đã qua.
  - Mở, bắt đầu hoặc xóa một chuyến đi.
  - Chuyển nhanh sang trang tạo chuyến đi mới hoặc trang cài đặt.

## 2. Trang lập kế hoạch chuyến đi

- **Đường dẫn:** `/plan`
- **Component:** `frontend/src/pages/Planner.jsx`
- **Chức năng chính:** Hướng dẫn người dùng tạo lịch trình qua 4 bước:
  1. **Essentials:** Nhập tên chuyến đi, ngân sách, số ngày, ngày bắt đầu và giờ bắt đầu từng ngày.
  2. **Hotel Location:** Tìm và chọn khách sạn làm điểm xuất phát tùy chọn.
  3. **Travel Style:** Chọn ưu tiên định tuyến như nhanh nhất, rẻ nhất, ít đi bộ hoặc ít chuyển tuyến.
  4. **Sightseeing:** Tìm, chọn địa điểm tham quan hoặc dùng AI để gợi ý danh sách địa điểm.
- Trang có bảng tóm tắt cấu hình chuyến đi và phần xem trước payload gửi đến API.
- Sau khi tạo kế hoạch, người dùng được chuyển sang trang chi tiết chuyến đi.

## 3. Trang chi tiết và điều hướng chuyến đi

- **Đường dẫn:** `/trip/:id`
- **Component:** `frontend/src/pages/Trip.jsx`
- **Chức năng chính:**
  - Hiển thị lịch trình và bản đồ của một chuyến đi cụ thể.
  - Chuyển đổi giữa các khu vực:
    - **Overview:** Tổng quan toàn bộ lịch trình.
    - **Day 1, Day 2, ...:** Chi tiết từng ngày, các điểm đến và chặng di chuyển.
    - **Summary:** Tóm tắt, lưu hoặc xóa chuyến đi.
  - Thêm, xóa, sắp xếp lại địa điểm và cập nhật tuyến đường.
  - Thêm hoặc xóa ngày trong lịch trình.
  - Thay đổi phương tiện di chuyển và so sánh các lựa chọn.
  - Hiển thị thời gian xe buýt, cảnh báo, trạng thái mất kết nối và thông tin thời tiết.
  - Hỗ trợ chế độ di chuyển trực tiếp bằng GPS, đánh dấu đã đến và chuyển sang chặng tiếp theo.
  - Mở cửa sổ chỉnh sửa thông tin và tùy chọn của chuyến đi.

## 4. Trang cài đặt

- **Đường dẫn:** `/settings`
- **Component:** `frontend/src/pages/Settings.jsx`
- **Chức năng chính:**
  - Cấu hình mức ưu tiên cho thời gian di chuyển, chi phí, quãng đường đi bộ và số lần chuyển tuyến.
  - Đặt từng tiêu chí theo ba mức: thấp, trung bình và cao.
  - Khôi phục cấu hình mặc định và lưu cấu hình cá nhân.
  - Yêu cầu đăng nhập nếu người dùng chưa có phiên đăng nhập.

## Thành phần dùng chung

Những thành phần sau xuất hiện trên nhiều hoặc tất cả các trang, nhưng không phải là trang riêng:

- **Header:** Logo, liên kết tạo chuyến đi, liên kết cài đặt, chuyển đổi ngôn ngữ Anh/Việt và quản lý đăng nhập.
- **Auth Modal:** Cửa sổ đăng nhập/đăng ký được mở trên trang hiện tại, không có đường dẫn riêng.
- **Chat Widget:** Trợ lý chat nổi được gắn ở cấp ứng dụng và có thể xuất hiện trên mọi trang.

## Bảng tổng hợp

| Trang | Đường dẫn | Component |
|---|---|---|
| Trang chủ / Dashboard | `/` | `Home.jsx` |
| Lập kế hoạch chuyến đi | `/plan` | `Planner.jsx` |
| Chi tiết và điều hướng chuyến đi | `/trip/:id` | `Trip.jsx` |
| Cài đặt | `/settings` | `Settings.jsx` |
