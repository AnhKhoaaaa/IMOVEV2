- Viết lại thuật toán Greedy, tập trung vào: Thời gian mở cửa, Khoảng cách các điểm phải gần nhau, Chia đều Thời gian dwell_time của từng ngày.

- Kiểm tra lại optimize route đã hoạt động với các case khó hơn chưa.

- Cái mục API Payload ở planner là dạng drop down, mặc định là ẩn, khi người dùng bấm vào mới xuất hiện.
- Thêm hotel vào điểm Stop cuối cùng của ngày, Hotel này đang tự tính toán bởi OneMap hay dựa theo dữ liệu POIs?
- Thêm mục thời gian bắt đầu mỗi ngày vào Planner. để điều chỉnh thời gian.
- Ở phần chọn địa điểm du lịch, Giới hạn danh sách POIs còn tầm 20 địa điểm, không hiển thị toàn bộ 499 cái.
- Kiểm tra logic tính Gap giữa các địa điểm: Gap giữa địa điểm ban ngày và địa điểm ban đêm, gap giữa 2 địa điểm có thời gian bắt đầu quá cách xa nhau.
- Logic tự tính toán lại đường đi từ GPS của người dùng đến địa điểm tiếp theo, dùng khi người dùng bấm nút: I'm Lost.



3. Trip.test.jsx — chưa sửa (11 tests)

Tôi đang chuẩn bị sửa nhóm này. Các vấn đề:

┌──────────────────────────────────┬──────────────────────────────────────────────────────────────────────┬─────────────────────────────────────┐
│               Test               │                                Vấn đề                                │              Hướng sửa              │
├──────────────────────────────────┼──────────────────────────────────────────────────────────────────────┼─────────────────────────────────────┤
│ shows loading skeleton           │ Tìm aria-label="Loading trip" nhưng <main> trong Trip.jsx không có   │ Thêm aria-label="Loading trip" vào  │
│                                  │ label đó                                                             │ Trip.jsx                            │
├──────────────────────────────────┼──────────────────────────────────────────────────────────────────────┼─────────────────────────────────────┤
│ renders day by day board, opens  │ Click button[name=/Day by day/i] — tab này không còn tồn tại, UI mới │ Bỏ bước click "Day by day", click   │
│ map view, allows changing        │  là Overview | Day 1 | Summary trực tiếp                             │ thẳng "Day 1"                       │
│ transport mode (3 tests)         │                                                                      │                                     │
├──────────────────────────────────┼──────────────────────────────────────────────────────────────────────┼─────────────────────────────────────┤
│                                  │ Tìm button dismiss warnings — warnings banner mới không có nút       │ Thêm dismiss button vào Trip.jsx,   │
│ dismisses warnings banner        │ dismiss                                                              │ hoặc bỏ test (phụ thuộc ý định của  │
│                                  │                                                                      │ bạn)                                │
├──────────────────────────────────┼──────────────────────────────────────────────────────────────────────┼─────────────────────────────────────┤
│ shows multiple warnings joined   │ Expect 'Warning A · Warning B' nhưng mỗi warning là <p> riêng        │ Sửa test hoặc sửa render logic      │
│ by separator                     │                                                                      │                                     │
├──────────────────────────────────┼─────────────────────────────────────────┼─────────────────────────────────────┤
│ Compare modes, Arrived/Continue  │ Sau Start Trip, DOM khn: test trước đó  │ Thêm sessionStorage.clear() vào     │
│ (5 tests)                        │ ghi imove_trip_startednStorage, test    │ beforeEach của các describe block   │
│                                  │ sau khởi tạo với tripStarted=true nên "Start Trip" không render      │ liên quan                           │
└──────────────────────────────────┴──────────────────────────────────────────────────────────────────────┴─────────────────────────────────────┘

---
Câu hỏi trước khi tiếp tục:

Với 2 test về warnings (dismisses warnings banner và shows eparator) — UI mới không có dismiss button và không join
bằng ·. Tôi cần biết bạn muốn:
- Sửa Trip.jsx để khôi phục dismiss button + join separator (giữ behavior cũ), hay
- Sửa test để match UI mới (không có dismiss, warnings riêng từng dòng)?
