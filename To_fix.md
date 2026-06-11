- Viết lại thuật toán Greedy, tập trung vào: Thời gian mở cửa, Khoảng cách các điểm phải gần nhau, Chia đều Thời gian dwell_time của từng ngày.

- Kiểm tra lại optimize route đã hoạt động với các case khó hơn chưa.

- Cái mục API Payload ở planner là dạng drop down, mặc định là ẩn, khi người dùng bấm vào mới xuất hiện.
- Thêm hotel vào điểm Stop cuối cùng của ngày, Hotel này đang tự tính toán bởi OneMap hay dựa theo dữ liệu POIs?
- Thêm mục thời gian bắt        đầu mỗi ngày vào Planner. để điều chỉnh thời gian.
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


Khi PT mode trả về mode Walk, ở chế độ compare mode thì thông số của PT trùng với thông số của Walk trong khi đáng lẽ phải là: unavailable.
Nút Open Grab chưa thực hiện chức năng, không điều hướng và backend cũng không trả ra thôgn báo gì.

Khi lỡ bấm start trip, thoát ra dashboard và bấm open thì tab được vào nằm trong giao diện navigate, đúng ra phải ở giao diện tuỳ chỉnh


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




Khi cập nhật kế hoạch dựa trên thời tiết, địa điểm khách sạn bị thay đổi vị trí, không còn là điểm đến cuối cùng, và vì khách sạn đã đi qua một lần nên chấm tròn trên bản đồ biến mất, đáng lẽ nó phải hiện tại khi đi từ điểm cuối về khách sạn. Đã sửa.
Logic đổi địa điểm do trời mưa ảnh hưởng đến ngày đang diễn ra hay ảnh hưởng đến tất cả các ngày? Ảnh hưởng tới tất cả nhưng đã sửa.
Kiểm tra xem nó có vô tình làm ngày 1 và ngày 2 đi cùng một địa điểm? -> Không

Khi paused trip và vào phần edit mode để chỉnh sửa và gọi optimise, hệ thống báo lỗi: Place 'hotel' not found in curated dataset -> đã sửa


Khi nào thì một chuyến đi sẽ reset lại từ điểm đầu tiên, khi nào thì nó sẽ bắt đầu tiếp từ điểm dừng trước đó?
→ Reset về Day 1 / Leg 0 xảy ra khi:

- Mở trip qua nút "Start" (nút "Start" ở thẻ "Today" trên Dashboard, hoặc nút Start trong danh sách trip) → Home.jsx gọi navigate('/trip/:id', { state: { autoStart: true } }).
- Trong Trip.jsx, khi location.state.autoStart === true:
  - tripStarted = true, editMode = false ngay từ đầu (bỏ qua giá trị cũ trong sessionStorage) → vào thẳng Live mode.
  - Một effect chạy đúng 1 lần khi data load xong (autoStartHandled, L1095-1105) ép selectedDay = trip.days[0].day, activeLegIndex = 0, activeTab = 'day-1' — tức là luôn quay về Day 1, Leg 0 dù trước đó user đã đi đến đâu.
- Khi hoàn thành toàn bộ trip: advanceLeg() (L1331-1336) khi đã đi hết leg cuối của ngày cuối → setTripStarted(false), chuyển sang tab Summary, xoá cả 2 key sessionStorage. Lần mở sau (không autoStart), tripStarted mặc định false → vào Planning mode, Day 1 được chọn mặc định.

→ Tiếp tục từ điểm dừng trước đó xảy ra khi:

- Mở trip qua nút "Open" thường (không autoStart) → location.state không có autoStart.
- tripStarted và editMode đều đọc từ sessionStorage.imove_tang dở ('true') → vào Edit mode (Paused): hiện banner vàng"Paused" + nút "Resume Trip", activeLegIndex được khôi phục từ sessionStorage.imove_active_leg_{id}.
- Bấm "Resume Trip" (resumeNavigation, L1112-1117) → editMode = false, quay lại Live mode với activeLegIndex đã khôi phục.

⚠️ Lưu ý phát sinh: selectedDay không được lưu vào sessionS1. Nếu user dừng ở giữa Day 2 rồi đóng app, lần sau mở lạibằng "Open" + "Resume Trip" sẽ quay về Day 1 nhưng activeLegIndex lại là chỉ số leg đã lưu của Day 2 → có khả năng lệch ngày/leg. Đây là một gap tiềm ẩn (không phải lỗi đã báo, chỉ phát hiện khi đọc code), tôi chưa verify bằng test thực tế.


Khi tôi test thử chế độ lên plan mới, bấm optimise route bằng cách let AI suggest, nhưng sau khi bấm xong lộ trình đã được tính toán lại nhưng vẫn hiện flag estimated, các tab day vẫn bị khoá, chỉ khi bấm lại cùng một nút thì mới mở ra, tuy thông báo là đã optimise rồi, hãy kiểm tra nguyên nhân lỗi này đến từ đâu => đã sửa, vấn đề là do OneMap quá tải

Thông báo mưa của ngày 2 khi nào sẽ được hiện lên frontend? Nếu đang là ngày 1 thì thông báo đó có hiện không? => đã sửa bằng cách gom nhóm chung các thông báo.

Về UX:
Thêm một nút để quay lại route trước đó đã lỡ ấn arrived, nút này bên cạnh nút arrived => Đã làm
Các địa điểm của day2 thì trong navigate của day1 hãy ẩn chúng đi. => đã làm

Bổ sung:
Có nên thêm cảnh báo trễ giờ?
Có, Thêm cảnh báo trễ giờ cho trường hợp người dùng ở lại quá lâu tại 1 địa điểm, và địa điểm tiếp theo sắp đóng cửa (Hỏi thêm với Agent)
Sử dụng extension để fake giờ.

LTA realtime có một số chuyến bus nhưng lại không kích hoạt. => Chưa thể tìm ra nguyên nhân, phải thêm log để chạy thử và xem xét, hãy thử chụp màn hình 1 số chuyến nếu gặp phải trường hợp này.

Update chatbot:
Chatbot LLM hiện tại có những chức năng gì, và vì sao nó biết tool nào có và tool nào có thể gọi?
Có thể thêm search the web MCP cho LLM để nó tra cứu thông tin trên mạng không?
Hoặc crawl data từ TIH của singapore để lấy thông tin về các hoạt động sắp diễn ra hoặc giá tiền của địa điểm.

Sửa về UX: Điều kiện mật khẩu đăng nhập, nhập quá nhiều thì khoá.
Tên trip không được trùng
