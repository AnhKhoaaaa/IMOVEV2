# Tài liệu Thiết kế Giao diện (Frontend UI) - Cấu hình Chuyến đi (Trip Setup)

Tài liệu này mô tả chi tiết giao diện người dùng (UI), các trường nhập liệu, luồng tương tác và ánh xạ dữ liệu sang API payload cho màn hình Lên kế hoạch (Planner Form) của ứng dụng IMOVEV2.

---

## 1. Kiến trúc Giao diện Planner (Multi-Step Form)

Form thiết lập chuyến đi được chia làm các bước rõ ràng nhằm tối ưu hóa trải nghiệm người dùng (UX):

```
[Bước 1: Essentials] ───> [Bước 2: Hotel Setup (Optional)] ───> [Bước 3: Travel Style] ───> [Bước 4: Places Select]
```

---

## 2. Chi tiết các Bước cấu hình

### Bước 1: Thông tin cơ bản (Essentials)
* **Tiêu đề**: Thiết lập thời gian & Ngân sách
* **Các thành phần giao diện**:
  * **Số ngày đi (`num_days`)**: Dropdown chọn từ `1` đến `14` ngày.
  * **Ngân sách di chuyển (`budget_sgd`)**: Input dạng số (SGD). Mặc định là `999`. Có nhãn giải thích: *"Dùng để hệ thống tính toán và đưa ra cảnh báo vượt ngân sách đi lại (MRT/Bus) thực tế."*
  * **Ngày bắt đầu (`start_date`)**: Datepicker. Dùng để đồng bộ cảnh báo thời tiết và sự cố phương tiện công cộng (LTA).
  * **Tự động tối ưu hóa thứ tự (`optimize_order`)**: Nút Toggle/Switch (Mặc định: `True`). Có tooltip giải thích: *"Bật: Tự động sắp xếp tối ưu thứ tự các điểm theo khoảng cách địa lý. Tắt: Giữ nguyên thứ tự chọn thủ công."*

---

### Bước 2: Nơi lưu trú (Hotel Setup - Cấu hình tùy chọn)
* **Tiêu đề**: Điểm xuất phát của bạn (Khách sạn/Homestay)
* **Giao diện**:
  * Một ô tìm kiếm văn bản tự do (Text Search Input) kèm kính lúp: *"Nhập tên khách sạn hoặc địa điểm bạn lưu trú tại Singapore..."*
* **Luồng hoạt động**:
  * Khi người dùng nhập text (gõ phím) $\rightarrow$ Input được **debounce (300ms)** để tránh spam API.
  * Gọi API geocode OneMap $\rightarrow$ Hiển thị danh sách kết quả gợi ý bên dưới (Autocomplete dropdown) gồm tên địa điểm và địa chỉ.
  * Người dùng click chọn một khách sạn:
    * Ghi nhận tên khách sạn (`hotel_name`), vĩ độ (`hotel_lat`), và kinh độ (`hotel_lng`).
    * Hiển thị card thông tin khách sạn đã chọn kèm nút **Xóa (Clear)** để đổi khách sạn khác.
* **Hành vi khi để trống**:
  * Đây là bước **Optional**. Nếu người dùng bỏ qua hoặc không cấu hình, chuyến đi sẽ bắt đầu trực tiếp tại địa điểm tham quan đầu tiên của ngày hôm đó lúc 09:00 (không sinh thêm chặng di chuyển rác).

---

### Bước 3: Phong cách di chuyển (Travel Style)
* **Tiêu đề**: Lựa chọn Phong cách Di chuyển
* **Giao diện**:
  * Danh sách các thẻ Preset lớn (Selectable Cards/Grid) hiển thị 5 phong cách di chuyển.
  * Người dùng chỉ được chọn **Single-select (chọn duy nhất một preset)**.
* **Các Preset lựa chọn**:
  1. ⚡ **Nhanh nhất (Fastest)**: Tối ưu hóa thời gian di chuyển, sẵn sàng chọn chặng nhanh nhất (ví dụ: MRT liên tuyến).
  2. 💰 **Tiết kiệm nhất (Cheapest)**: Tối ưu hóa giá vé rẻ nhất (ưu tiên đi Bus chặng ngắn).
  3. 🚶 **Ít đi bộ nhất (Leisure / Least Walking)**: Hạn chế cuốc bộ dưới trời nắng Singapore.
  4. 🚌 **Ít chuyển tuyến nhất (Direct / Least Transfers)**: Hạn chế việc phải đổi tàu điện hay đổi xe bus giữa đường.
  5. 👤 **Theo cấu hình cá nhân (My Preference)**:
     - Thẻ này **chỉ hiển thị nếu người dùng đã đăng nhập**.
     - Khi chọn thẻ này, hệ thống sẽ gửi tín hiệu lên backend sử dụng profile cấu hình trọng số của chính user đã lưu trong bảng `user_preferences`.

* **Ánh xạ dữ liệu gửi lên API**:
  * Mỗi Preset tương ứng với một bộ trọng số (Weights) gửi lên trường `preferences` trong payload:
    - **Fastest**: `{"duration_w": 0.70, "cost_w": 0.10, "walking_w": 0.10, "transfers_w": 0.10}`
    - **Cheapest**: `{"duration_w": 0.10, "cost_w": 0.70, "walking_w": 0.10, "transfers_w": 0.10}`
    - **Leisure**: `{"duration_w": 0.20, "cost_w": 0.10, "walking_w": 0.60, "transfers_w": 0.10}`
    - **Direct**: `{"duration_w": 0.20, "cost_w": 0.20, "walking_w": 0.10, "transfers_w": 0.50}`
    - **My Preference**: Gửi `preferences: null` hoặc một cờ đánh dấu để backend tự động lấy profile đã lưu trong DB của người dùng đó.

---

### Bước 4: Chọn địa điểm (Places Selection)
* Giữ nguyên thiết kế grid curates POIs ở Step 2/3 hiện tại, cho phép tìm kiếm và bấm chọn các địa điểm yêu thích.

---

## 3. Cấu trúc Payload gửi lên API POST `/{trip_id}/plan`

Khi người dùng hoàn tất và bấm **"Generate Plan"**, frontend sẽ gửi API request với body như sau:

```json
{
  "place_ids": ["gardens_by_the_bay", "universal_studios_singapore", "sentosa_island"],
  "optimize_order": true,
  "hotel_name": "Orchard Hotel Singapore",
  "hotel_lat": 1.3072,
  "hotel_lng": 103.8291,
  "preferences": {
    "budget_sgd": 50.0,
    "duration_w": 0.70,
    "cost_w": 0.10,
    "walking_w": 0.10,
    "transfers_w": 0.10
  }
}
```

*Nếu người dùng chọn preset **"My Preference"** và đã đăng nhập, trường `preferences` sẽ chỉ truyền các thông số cơ bản như `budget_sgd`, còn các trọng số di chuyển sẽ được backend tự động nạp từ DB.*
