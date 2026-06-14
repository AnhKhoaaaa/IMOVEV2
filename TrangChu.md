# Định hướng cải thiện giao diện trang chủ IMOVE

## Mục tiêu

Trang chủ nên được cải thiện theo phong cách **Mobility Control Center**:

- Nền xanh navy kết hợp xanh dương, cyan và emerald.
- Sử dụng họa tiết bản đồ, tuyến đường và điểm dừng.
- Có chuyển động nhẹ để thể hiện dữ liệu giao thông đang hoạt động.
- Giao diện sinh động nhưng vẫn rõ ràng và dễ thao tác.
- Giữ nguyên toàn bộ API, dữ liệu và hành vi hiện tại.

Nguồn component tham khảo: [21st.dev Community Components](https://21st.dev/community/components).

## Đề xuất UI cho từng khu vực

| Khu vực hiện tại | UI nên sử dụng từ 21st.dev | Từ khóa tìm kiếm |
|---|---|---|
| Hero giới thiệu IMOVE | Hero nền gradient có hiệu ứng grid hoặc spotlight, CTA nổi bật | `Animated Hero`, `Spotlight Hero`, `Grid Background`, `Gradient Background` |
| Bốn ô thống kê | Bento grid với số liệu động | `Bento Grid`, `Stats Card`, `Animated Counter`, `Number Ticker` |
| Thông báo chuyến đi hôm nay | Announcement banner có pulse indicator | `Announcement`, `Alert Banner`, `Notification Banner` |
| Bộ lọc chuyến đi | Animated tabs có sliding indicator | `Animated Tabs`, `Pill Tabs`, `Segmented Control` |
| Thanh tìm kiếm | Search input có hiệu ứng focus và phím tắt | `Search Input`, `Command Search`, `Expandable Input` |
| Danh sách chuyến đi | Spotlight hoặc hover card | `Spotlight Card`, `Hover Card`, `Glowing Card`, `Tilt Card` |
| Trạng thái chuyến đi | Badge có chấm trạng thái động | `Animated Badge`, `Status Badge`, `Pulse Badge` |
| Trạng thái đang tải | Skeleton card thay cho spinner đơn giản | `Skeleton`, `Card Skeleton`, `Shimmer Loader` |
| Không có chuyến đi | Empty state có minh họa và CTA | `Empty State` |

## Bố cục trang chủ đề xuất

### 1. Hero Dashboard

Thay phần hero trắng hiện tại bằng hero tối có:

- Tiêu đề và mô tả ở bên trái.
- Hai nút hành động chính: `Plan a new trip` và `Preferences`.
- Bên phải là bản đồ tuyến đường cách điệu hoặc Bento Stats.
- Các điểm bản đồ có hiệu ứng pulse nhẹ.
- Họa tiết tuyến đường chạy phía sau.

Dự án đã có sẵn các utility CSS có thể tận dụng:

- `home-dark-grid`
- `home-hero-map`
- `home-card-map`

Nên tận dụng các utility này thay vì thêm một thư viện animation lớn.

### 2. Quick Statistics Bento

Thay khung bốn ô thống kê hiện tại bằng Bento Grid:

- **Today:** Số chuyến đi cần bắt đầu.
- **Upcoming:** Số chuyến đi sắp tới.
- **Live services:** Trạng thái LTA và thời tiết.
- **Alerts:** Số cảnh báo cần xử lý.

Chỉ nên chạy animation cho số liệu khi trang vừa tải. Không nên để toàn bộ card chuyển động liên tục.

### 3. Today Trip Banner

Nếu có chuyến đi hôm nay, sử dụng announcement banner nổi bật:

- Chấm xanh pulse.
- Tên chuyến đi.
- Thời gian bắt đầu.
- Nút `Start navigation`.
- Có thể thêm hiệu ứng nền chạy nhẹ từ trái sang phải.

### 4. Trip Toolbar

Kết hợp tabs và thanh tìm kiếm thành một toolbar thống nhất:

- Animated tabs cho `All`, `Today`, `Upcoming`, `Drafts` và `Past`.
- Số lượng chuyến đi hiển thị trong badge nhỏ.
- Search input có hiệu ứng focus.
- Trên thiết bị di động, thanh tìm kiếm nằm dưới tabs và tabs có thể cuộn ngang.

### 5. Trip Cards

Đây là phần nên được ưu tiên cải thiện mạnh:

- Có thể sử dụng Spotlight Card với hiệu ứng vừa phải.
- Nền tối hoặc gradient bản đồ nhẹ.
- Status badge ở góc trên.
- Hiển thị tên chuyến đi và thời gian.
- Có route progress nhỏ thể hiện số ngày hoặc số điểm dừng.
- Hiển thị các số liệu `Days`, `Stops` và `Alerts`.
- Nút chính `Open trip`.
- Nút xóa chỉ hiện rõ khi hover để giảm nhiễu giao diện.

Không nên dùng hiệu ứng Tilt Card quá mạnh vì danh sách có nhiều card và có thể gây khó chịu khi sử dụng.

### 6. Empty State và Loading State

- Khi chưa có chuyến đi, sử dụng Empty State có minh họa tuyến đường và nút tạo chuyến đi.
- Khi đang lấy chi tiết chuyến đi, sử dụng Card Skeleton thay vì spinner phủ lên card.

## Component không nên sử dụng

- **Shaders hoặc WebGL backgrounds:** Đẹp nhưng nặng và không cần thiết cho dashboard.
- **Carousel:** Không phù hợp vì người dùng cần nhìn thấy nhiều chuyến đi cùng lúc.
- **Animation liên tục trên mọi card:** Làm trang rối và giảm hiệu năng.
- **Component chỉ dành cho Next.js:** Frontend hiện tại sử dụng React Vite JSX.
- Component yêu cầu `framer-motion` cần được cân nhắc kỹ vì dự án hiện chưa cài thư viện này.

## Phạm vi thay đổi khi triển khai

Chỉ được thay đổi phía frontend:

- `frontend/src/pages/Home.jsx`
- `frontend/src/index.css`
- Có thể thêm component mới trong `frontend/src/components/home/`
- Chỉ sửa `frontend/package.json` nếu component thực sự cần dependency mới

Không được thay đổi:

- Backend
- API và hợp đồng dữ liệu
- Database
- Logic nghiệp vụ và cấu trúc dữ liệu hiện tại

## Thứ tự triển khai đề xuất

1. Hero Dashboard.
2. Trip Cards.
3. Trip Toolbar.
4. Loading State và Empty State.
5. Quick Statistics Bento.

Thứ tự này ưu tiên các thay đổi tạo khác biệt thị giác lớn nhất nhưng vẫn giữ nguyên nghiệp vụ hiện tại.
