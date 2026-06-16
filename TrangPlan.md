# Định hướng cải thiện giao diện trang lập kế hoạch chuyến đi IMOVE

## Mục tiêu

Trang lập kế hoạch nên được cải thiện theo phong cách **Guided Journey Builder**:

- Biến wizard bốn bước thành một hành trình trực quan, giúp người dùng luôn biết mình đang ở đâu và cần làm gì tiếp theo.
- Dùng nền sáng, xanh dương, cyan và emerald để đồng bộ với phong cách Mobility Control Center của trang chủ.
- Nhấn mạnh các lựa chọn quan trọng bằng card, icon và trạng thái chọn rõ ràng.
- Hiển thị bản tóm tắt chuyến đi liên tục nhưng không làm phân tán khỏi bước đang thực hiện.
- Tạo cảm giác AI đang hỗ trợ lập kế hoạch bằng phản hồi trạng thái rõ ràng, không lạm dụng animation.
- Giữ nguyên toàn bộ API, dữ liệu, wizard bốn bước và hành vi tạo chuyến đi hiện tại.

Nguồn component tham khảo: [21st.dev Community Components](https://21st.dev/community/components).

Các nhóm component phù hợp để tham khảo trực tiếp:

- [Form Components](https://21st.dev/community/components/s/form)
- [Card Components](https://21st.dev/community/components/s/card)
- [Sidebar Components](https://21st.dev/community/components/s/sidebar)
- [Calendar Components](https://21st.dev/community/components/s/calendar)
- [Tabs Components](https://21st.dev/community/components/s/tabs)
- [Input Components](https://21st.dev/community/components/s/input)

## Đề xuất UI cho từng khu vực

| Khu vực hiện tại | UI nên sử dụng từ 21st.dev | Từ khóa tìm kiếm |
|---|---|---|
| Header trang lập kế hoạch | Header nhỏ có breadcrumb, mô tả bước hiện tại và tiến độ tổng | `Page Header`, `Breadcrumb`, `Progress Header` |
| Thanh bốn bước | Stepper có nhãn, trạng thái hoàn thành và progress line | `Stepper`, `Progress Steps`, `Multi Step Form`, `Timeline` |
| Form thông tin cơ bản | Form card chia nhóm rõ ràng, input có icon và mô tả ngắn | `Form`, `Floating Label Input`, `Number Input`, `Input with Icon` |
| Chọn ngày và giờ | Calendar hoặc date picker nổi bật, segmented control cho chế độ ngày | `Calendar`, `Date Picker`, `Segmented Control`, `Toggle Group` |
| Tìm khách sạn | Search input có trạng thái loading, kết quả dạng suggestion card | `Search Input`, `Autocomplete`, `Command Search`, `Popover` |
| Chọn phong cách di chuyển | Selectable cards có icon, mô tả và trạng thái active | `Selectable Card`, `Radio Card`, `Feature Card`, `Choice Card` |
| Hiển thị trọng số ưu tiên | Meter hoặc progress bar nhỏ thay cho số kỹ thuật | `Progress Bar`, `Meter`, `Animated Progress` |
| Bộ lọc địa điểm | Search bar kết hợp tabs hoặc filter chips | `Search Input`, `Pill Tabs`, `Filter Tabs`, `Tags` |
| Danh sách địa điểm | Selectable image cards, badge danh mục và thời lượng | `Selectable Card`, `Image Card`, `Badge`, `Hover Card` |
| Danh sách địa điểm đã chọn | Sticky shortlist dạng timeline hoặc compact list | `Timeline`, `List Card`, `Sortable List`, `Sticky Sidebar` |
| Tóm tắt cấu hình | Sticky summary card có các số liệu chính và CTA | `Sticky Sidebar`, `Summary Card`, `Stats Card` |
| Trạng thái AI đề xuất | Alert hoặc loading card có shimmer nhẹ | `AI Loading`, `Alert`, `Skeleton`, `Spinner Loader` |
| Lỗi tạo kế hoạch | Alert card rõ nguyên nhân và cách xử lý | `Alert`, `Error State`, `Toast` |

## Bố cục trang lập kế hoạch đề xuất

### 1. Header và Journey Stepper

Thay header và dãy chấm bước hiện tại bằng một khu vực định hướng thống nhất:

- Breadcrumb nhỏ: `Home / Plan a trip`.
- Tiêu đề thay đổi theo bước, ví dụ `Tell us about your trip`.
- Stepper bốn bước gồm `Essentials`, `Hotel`, `Travel style` và `Places`.
- Mỗi bước có icon riêng, nhãn ngắn và trạng thái `Current`, `Completed` hoặc `Upcoming`.
- Cho phép quay lại bước đã hoàn thành; không nên làm các bước tương lai trông như đã có thể hoàn tất.
- Trên thiết bị di động, rút gọn thành `Step 2 of 4` cùng progress bar ngang.

Stepper chỉ nên animate khi chuyển bước. Không cần animation chạy liên tục trên đường tiến độ.

### 2. Khung Wizard Chính

Giữ bố cục hai cột trên desktop nhưng làm rõ vai trò:

- Cột trái rộng là vùng nhập liệu của bước hiện tại.
- Cột phải là sticky trip summary, luôn hiển thị kết quả các lựa chọn đã nhập.
- Mỗi bước có tiêu đề, mô tả ngắn và một card nội dung duy nhất để giảm cảm giác form rời rạc.
- Footer của wizard chứa nút `Back` và `Continue`, được giữ ổn định ở cùng vị trí giữa các bước.
- Khi người dùng chưa nhập đủ dữ liệu, nút tiếp tục vẫn hiển thị nhưng có trạng thái disabled và mô tả điều kiện còn thiếu.

Trên tablet và mobile, trip summary nên chuyển thành accordion `Trip summary` nằm phía trên footer thay vì chiếm một cột riêng.

### 3. Bước Essentials

Tổ chức thông tin cơ bản thành ba nhóm dễ quét:

- **Trip identity:** Tên chuyến đi.
- **Schedule:** Số ngày, ngày cụ thể hoặc lịch linh hoạt, giờ bắt đầu từng ngày.
- **Budget and optimization:** Ngân sách và tùy chọn tối ưu thứ tự.

Cải thiện đề xuất:

- Dùng segmented control cho `Flexible` và `Calendar`.
- Dùng date picker có range preview rõ ràng khi chọn ngày cụ thể.
- Dùng number stepper cho số ngày thay vì input số thuần.
- Hiển thị ngân sách theo định dạng `S$` ngay trong input.
- Các tùy chọn boolean nên dùng switch hoặc checkbox card có phần giải thích ngắn.

### 4. Bước Hotel

Biến tìm khách sạn thành một luồng tìm kiếm có phản hồi trực quan:

- Search input lớn có icon vị trí và loading indicator.
- Kết quả geocode hiển thị dưới dạng suggestion card gồm tên, địa chỉ và nút `Use this location`.
- Sau khi chọn, thay input bằng selected location card màu emerald.
- Có empty state khi không tìm thấy kết quả và gợi ý kiểm tra lại tên hoặc địa chỉ.
- Làm rõ đây là bước tùy chọn bằng badge `Optional` và nút `Skip for now`.

Không nên sử dụng bản đồ tương tác lớn trong bước này vì chỉ cần xác định điểm xuất phát; bản đồ lớn sẽ làm luồng wizard nặng và mất tập trung.

### 5. Bước Travel Style

Thay các card lựa chọn đơn giản bằng selectable cards có phân cấp rõ:

- Mỗi card gồm icon, tên phong cách, mô tả một dòng và một chỉ báo mức ưu tiên.
- Card đang chọn có border xanh, nền gradient nhẹ và dấu check rõ ràng.
- Các lựa chọn `Fastest`, `Cheapest`, `Least walking`, `Least transfers` và `Use profile` giữ nguyên logic hiện tại.
- Bên dưới card đang chọn, hiển thị breakdown bằng bốn progress meter cho thời gian, chi phí, đi bộ và số lần chuyển tuyến.
- Dùng nhãn `High`, `Medium`, `Low`; không hiển thị trọng số thô cho người dùng phổ thông.

Chỉ card đang hover hoặc được chọn mới có hiệu ứng nâng nhẹ. Không dùng Tilt Card vì đây là vùng ra quyết định và cần cảm giác ổn định.

### 6. Bước Places

Đây là phần cần được ưu tiên cải thiện mạnh nhất:

- Thanh tìm kiếm và filter tabs nằm cố định phía trên danh sách khi cuộn.
- Filter tabs gồm `All`, `Culture`, `Attractions`, `Nature`, `Entertainment`, `Food & Shopping`.
- Mỗi địa điểm sử dụng image card có tên, danh mục, thời lượng đề xuất và badge nổi bật.
- Trạng thái được chọn phải rõ bằng border, dấu check và nền màu; không chỉ dựa vào màu chữ.
- Nút `Auto shortlist with AI` đặt gần tiêu đề và giải thích ngắn AI sẽ dựa trên số ngày cùng phong cách di chuyển.
- Khi AI đang phân tích, dùng skeleton hoặc loading card trong vùng kết quả thay vì chỉ một dòng spinner.

Danh sách đã chọn nên là sticky shortlist:

- Hiển thị số lượng địa điểm đã chọn và số lượng tối thiểu cần thiết.
- Dùng compact cards hoặc timeline để người dùng nhìn nhanh thứ tự dự kiến.
- Có nút xóa rõ ràng và có thể cân nhắc kéo thả bằng `@dnd-kit` đã có trong dự án.
- CTA `Generate itinerary` đặt cuối shortlist và luôn nhìn thấy trên desktop.

### 7. Trip Summary Sidebar

Thay summary hiện tại bằng sticky summary card mang tính quyết định:

- Tiêu đề chuyến đi và badge trạng thái `Draft`.
- Các chỉ số chính: số ngày, ngân sách, khách sạn, phong cách và số điểm dừng.
- Mini progress hiển thị mức độ hoàn thành của wizard.
- Dòng cảnh báo nhỏ nếu thiếu dữ liệu cần thiết.
- CTA chính thay đổi theo bước: `Continue` hoặc `Generate itinerary`.

Panel `API Live Payload` là thông tin kỹ thuật, không nên xuất hiện trong giao diện người dùng thông thường. Chỉ nên hiển thị trong development mode hoặc sau một nút debug dành cho nhà phát triển.

### 8. Loading, Success và Error States

- Khi tải danh sách địa điểm, dùng card skeleton có cùng kích thước với card thật.
- Khi AI đang tạo shortlist, hiển thị các giai đoạn ngắn như `Analyzing preferences` và `Matching places`.
- Khi đang tạo kế hoạch cuối cùng, dùng modal hoặc overlay có progress rõ ràng để ngăn gửi yêu cầu nhiều lần.
- Khi thành công, chuyển thẳng đến trang chi tiết chuyến đi như hành vi hiện tại.
- Khi lỗi, alert cần nêu rõ người dùng nên sửa thông tin nào hoặc thử lại thao tác nào.

## Nguyên tắc responsive và accessibility

- Desktop dùng bố cục `main content + sticky summary`; mobile dùng một cột.
- Stepper trên mobile phải rút gọn, tránh bốn nhãn bị ép quá hẹp.
- Filter địa điểm có thể cuộn ngang trên mobile.
- Footer điều hướng nên sticky ở đáy màn hình mobile để nút tiếp tục luôn dễ tiếp cận.
- Mọi selectable card phải có `aria-pressed` hoặc radio semantics và trạng thái focus rõ.
- Không dùng màu sắc làm dấu hiệu duy nhất cho trạng thái chọn, lỗi hoặc hoàn thành.
- Tôn trọng `prefers-reduced-motion` cho progress, shimmer và chuyển bước.

## Component có thể tận dụng trong dự án

Dự án đã có một số component và dependency phù hợp, nên ưu tiên tái sử dụng:

- `frontend/src/components/ui/DateRangePicker.jsx`
- `frontend/src/components/ui/TimePicker.jsx`
- `frontend/src/components/ui/animated-glowing-search-bar.jsx`
- `frontend/src/components/ui/spotlight-card.jsx`
- `frontend/src/components/ui/skeleton.jsx`
- `frontend/src/components/ui/tabs.jsx`
- `frontend/src/components/ui/alert.jsx`
- `@dnd-kit` cho danh sách địa điểm có thể sắp xếp
- `lucide-react` cho icon nhất quán

Nên chuyển ý tưởng từ 21st.dev sang component phù hợp với React Vite JSX và hệ thống UI hiện tại, thay vì sao chép nguyên component phụ thuộc Next.js.

## Component không nên sử dụng

- **Shaders hoặc WebGL backgrounds:** Làm form khó đọc và không hỗ trợ nhiệm vụ lập kế hoạch.
- **Carousel:** Không phù hợp cho wizard và danh sách địa điểm cần so sánh.
- **Tilt Card hoặc hiệu ứng 3D mạnh:** Gây mất tập trung khi người dùng nhập liệu.
- **Animation liên tục trên toàn bộ form:** Làm giảm khả năng tập trung và hiệu năng.
- **Map toàn màn hình trong wizard:** Chiếm diện tích nhưng không cần thiết cho việc nhập cấu hình ban đầu.
- **Component chỉ dành cho Next.js:** Frontend hiện tại sử dụng React Vite JSX.
- Component yêu cầu dependency animation mới cần được cân nhắc kỹ vì dự án đã có GSAP và các utility animation hiện tại.

## Phạm vi thay đổi khi triển khai

Chỉ được thay đổi phía frontend:

- `frontend/src/pages/Planner.jsx`
- `frontend/src/components/planner/PlaceBrowser.jsx`
- Có thể thêm component mới trong `frontend/src/components/planner/`
- Có thể tận dụng hoặc mở rộng component trong `frontend/src/components/ui/`
- `frontend/src/index.css`
- Chỉ sửa `frontend/package.json` nếu component thực sự cần dependency mới

Không được thay đổi:

- Backend
- API và hợp đồng dữ liệu
- Database
- Logic tạo chuyến đi và lập lịch hiện tại
- Cấu trúc payload gửi đến API
- Luồng điều hướng đến trang chi tiết chuyến đi sau khi tạo thành công

## Thứ tự triển khai đề xuất

1. Journey Stepper và khung wizard responsive.
2. Bước Places cùng sticky shortlist.
3. Trip Summary Sidebar và CTA theo ngữ cảnh.
4. Selectable cards cho Travel Style.
5. Form Essentials và Hotel search states.
6. Loading, error và accessibility states.

Thứ tự này ưu tiên các khu vực ảnh hưởng trực tiếp nhất đến khả năng hoàn thành kế hoạch, đồng thời giữ nguyên nghiệp vụ và dữ liệu hiện tại.
