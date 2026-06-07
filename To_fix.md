- Viết lại thuật toán Greedy, tập trung vào: Thời gian mở cửa, Khoảng cách các điểm phải gần nhau, Chia đều Thời gian dwell_time của từng ngày.

- Kiểm tra lại optimize route đã hoạt động với các case khó hơn chưa.

- Cái mục API Payload ở planner là dạng drop down, mặc định là ẩn, khi người dùng bấm vào mới xuất hiện.
- Thêm hotel vào điểm Stop cuối cùng của ngày, Hotel này đang tự tính toán bởi OneMap hay dựa theo dữ liệu POIs?
- Thêm mục thời gian bắt đầu mỗi ngày vào Planner. để điều chỉnh thời gian.
- Ở phần chọn địa điểm du lịch, Giới hạn danh sách POIs còn tầm 20 địa điểm, không hiển thị toàn bộ 499 cái.
- Kiểm tra logic tính Gap giữa các địa điểm: Gap giữa địa điểm ban ngày và địa điểm ban đêm, gap giữa 2 địa điểm có thời gian bắt đầu quá cách xa nhau.


- Nút continue khi người dùng tới địa điểm sẽ ghi đè lên nút Arrived, không cần tạo thông báo emerald riêng.
- Khi người dùng adapt với thời tiết, hệ thống đã đổi địa điểm, kiểm tra xem đã gọi lại OneMap để tính quảng đường mới chưa, các mode phương tiện không tìm thấy hiện đang chưa được giảm opacity.
- Logic tự tính toán lại đường đi từ GPS của người dùng đến địa điểm tiếp theo, dùng khi người dùng bấm nút: I'm Lost.
=> Tôi muốn thêm tính năng hệ thống sẽ dựa vào GPS của người dùng để gọi API OneMap, nhằm tính toán lại đường đi khi người dùng đi bộ hoặc đạp xe Có 2 hướng có thể làm: Tự động trigger khi người dùng đi lệch xa điểm đến, người dùng kích hoạt khi bấm i'm Lost!

- Lựa chọn keep my order khi update route bị lỗi.
- Đang đổi mode giữa các places thì tap Day 1 bị đóng, Nút update Route xuất hiện nhưng không thể lựa chọn keep my order, trong khi  Let AI Optimize thì hiện đã optimize rồi.

- Vẽ cụ thể từng bước trong chặn:
 - cách 1: Đổi màu khi đổi phương tiện
 - Cách 2: Thêm các chấm để biết đó là trạm ga (Sẽ hơi r)


---
Luồng hoạt động đúng của user

1. [Planner] Chọn địa điểm → Plan Trip
        ↓ optimize_order=True (OneMap real routes)
   Lịch trình ban đầu có route chất lượng cao

2. [Trip / Overview] Xem lịch trình

3. [User chỉnh sửa] Add / Remove / Up / Down địa điểm trong
        ↓ Chỉ cập nhật UI local (pending state)
   Day card hiện badge "dirty", nút "Recalculate Route" xuất hiện

4. [Recalculate Route] Bấm nút → gọi PATCH /reorder
        ↓ optimize_order=False (haversine estimates)
   Route được rebuild với thứ tự user muốn
   ⚠️ Thời gian/giá chỉ là ước tính, is_estimated=true

5. [Optimise] Bấm nút Optimise → gọi POST /optimize
        ↓ optimize_order=True (OneMap real routes)
   Route được tính lại với data thật
   ✓ Thứ tự có thể bị sắp xếp lại bởi greedy algorithm

---
Vấn đề tiềm ẩn trong luồng hiện tại

Bước 5 có thể "undone" bước 3: Sau khi user vất vả reorder thủ công rồi Recalculate, nếu bấm Optimise → greedy algorithm có thể sắp xếp lại theo logic riêng của nó, bỏ qua thứ tự user đã chọn.

Haversine không đáng tin cậy cho transit: Ước tính METRO 2km = ~10 phút thực tế, nhưng nếu phải đi bộ đến ga + chờ tàu thì thực tế là 25 phút. User thấy thời gian sai cho đến khi Optimise.

Không có cảnh báo rõ ràng trên UI: Khi đang ở trạng thái haversine, không có indicator nào cho user biết "route này chưa chính xác". Đây là điểm có thể cải thiện (ví dụ: badge "Estimated routes — click Optimise for real timing" trên day card).


Người dùng chọn danh sách địa điểm -> Optimize = True -> Gọi API OneMap, sắp xếp lại toàn bộ lịch trình theo thuật toán
-> Optimize = False -> Không gọi API, Có sắp xếp địa điểm thành các ngày theo thuật toán.

Người dùng thêm/ xoá/ sắp xếp địa điểm: Bấm recalculate -> Sắp xếp lại, không gọi API OneMap, Quảng đường được tính toán ước tính
-> Bấm optimize: Khi này mới tính toán lại ngày.

Build sạch. Frontend hoàn chỉnh. Tóm tắt toàn bộ thay đổi:



---
planning_agent.py — Thêm 2 params vào plan_trip:
- force_real_routes: bool = False — khi True, dùng OneMap thay vì haversine dù optimize_order=False
- existing_real_legs: list[dict] | None = None — pre-populate route_cache/alt_cache từ các legs đã real, tránh gọi lại OneMap cho pairs đã biết

models/trip.py — Thêm existing_legs: list[dict] vào ReorderRequest; thêm mới OptimizeRequest

trips.py — reorder_places giờ luôn dùng OneMap (force_real_routes=True) + nhận existing_legs từ body; optimize_trip nhận optional body với existing_legs

Frontend tiếp theo (F1–F9) sẽ wire UI và gọi các endpoints này với đúng payload.

---
api.js
- reorderPlaces nhận thêm existingLegs = [] → gửi trong body
- optimizeRoute nhận thêm existingLegs = [] → gửi trong body

Trip.jsx
- Import thêm parseHHMM, toHHMM
- Helper computeHaversineTimes — tính thời gian ước tính từ haversine cho pending order
- State mới: keepOrderDone, confirmOptimise, updateRouteOpen
- Derived: isEstimated (từ legs), hasDirtyDays, needsRouteUpdate, pendingTimes (memo)
- addPlace/removePlace/reorderLocal → setKeepOrderDone(false) khi user edit
- handleUpdateRoute(keepOrder) — xử lý tất cả dirty days với OneMap, set keepOrderDone=true khi xong
- handleConfirmOptimise — gọi optimizeRoute với existingLegs, set keepOrderDone=true
- mapPlaces include pending places dưới dạng pins (không có polyline giả)
- Mode banner → badge ⚡ Estimated / ✓ Good To Go
- Day tabs → disabled + tooltip "Update routes first" khi needsRouteUpdate
- Header → xoá nút Sparkles cũ
- Overview → dropdown "Update Route ▾" khi Estimated, nút "Optimise Order" khi Good To Go, per-day "Recalculate" đổi thành hint text
- Confirm dialog modal trước khi gọi "Let AI Optimise"

✻ Crunched for 8m 14s
