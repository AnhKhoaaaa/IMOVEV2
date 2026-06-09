- Khi bấm vào preferences, yêu cầu người dùng cần phải đăng nhập trước. Vậy thì ở giao diện này nên có thêm nút để bấm vào đăng nhập luôn. Chú ý thêm: Icon lớn trong trang Settings hiện chỉ dùng để trang trí, không có hành động. Có nên xóa icon trang trí  này?

Đề xuất: giữ trang Settings và thêm nút đăng nhập để người dùng hiểu lợi ích của Preferences trước khi đăng nhập.

- Đăng nhập bằng google chưa hoạt động. 
Bị lỗi {"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}

- Các scoring weights nên cho người dùng 3 mức: Thấp, Trung bình, Cao. Không nên hiện phần trăm. 

- Đối với một người dùng, tính năng constraint có thể sẽ không được sài nhiều, gây khó khăn đối với người dùng. Nên có một hướng cải thiện 

- Khi bật VI thì chưa hiển thị tiếng Việt cho toàn bộ ứng dụng.

- Khi vào chế độ Itinerary Builder
+ Có khung api live payload đang hiện ra các dòng code chạy bên trong. Có thể xóa hoặc bỏ luôn.
+ Khi người dùng nhập chữ số từ bàn phím Days thì ứng dụng hiển thị 3 con số trong khi người dùng chỉ nhập 1 số. Ví dụ: nhập 1, ứng dụng hiện 001. Tôi muốn ẩn đi các con số 0 đằng trước. 
+ Tương tự đối với phần preferences, Travel Style đang hiện ra phần trăm đối với từng mục lựa chọn. Điều này gây bối rối đối với người dùng. Nên có 3 chế độ : Thấp, Trung bình, Cao. 
+ Đối với tab Sightseeing, khi người dùng xem thêm các địa điểm thì trang càng ngày càng dài xuống do đó khi người dùng muốn lướt lên trên thì phải kéo lên rất lâu. Nên có một nút "go to top" để người dùng quay lại trên cùng.

- Ở trong giao diện nơi có các tab như Overview, Day 1, Day 2, ... Summary 
+ Bấm vào mục thay đổi phương tiện trong mục Day 1, Day 2, ... sẽ hiện ra các phương án thay thế. Khi người dùng di chuyển chuột đến phương án thay thế thì có hiển thị hướng dẫn di chuyển nhưng khi di chuyển chuột ra khỏi các phương án thay thế và chọn phương tiện đi đến địa điểm cho chuyến khác nên tắt đi các mục hiển thị thay đổi phương tiện di chuyển đã bật.
+ Nút kế bên nú thay đổi phương tiện là gì? Có tác dụng gì? Chưa thể nhận thấy sự thay đổi nào khi bấm vào nút này. 
+ Các icon con số đang hiện thị trên map mang ý nghĩa gì? Chưa thể giúp người dùng hiểu rõ.
+ Nên có thanh kéo ra kéo vô giữa danh sách các địa điểm trong ngày và bản đồ, giúp người dùng dễ dàng di chuyển qua lại giữa 2 tab này.

---

# PHIÊN BẢN HỆ THỐNG HOÁ (improved)

> Tổng hợp & cấu trúc lại feedback của tester. Mỗi mục gồm: mô tả rõ ràng, **Effort** (công sức), **Benefit** (lợi ích người dùng), và **Đề xuất** (có nên sửa / mức ưu tiên).
> Thang đo: Thấp / Trung bình / Cao.

## A. Xác thực & Trang Settings

### A1. Thêm nút Đăng nhập ngay trong trang Preferences/Settings
- **Mô tả:** Khi bấm Preferences, app yêu cầu đăng nhập nhưng không có lối đăng nhập tại chỗ. Cần thêm nút "Đăng nhập" ngay trên màn hình này, kèm mô tả ngắn lợi ích của Preferences để người dùng hiểu *tại sao* nên đăng nhập trước khi đăng nhập.
- **Effort:** Thấp · **Benefit:** Cao (giảm ma sát, tăng tỉ lệ đăng nhập)
- **Đề xuất:** ✅ NÊN SỬA — ưu tiên cao. Quick win.

### A2. Xóa icon trang trí lớn trong trang Settings
- **Mô tả:** Icon lớn hiện chỉ trang trí, không có hành động, gây hiểu nhầm có thể bấm được. → Xóa bỏ.
- **Effort:** Thấp · **Benefit:** Thấp (gọn giao diện, bớt gây nhầm)
- **Đề xuất:** ✅ NÊN SỬA — gộp làm chung với A1.

### A3. Đăng nhập bằng Google chưa hoạt động
- **Mô tả:** Lỗi `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`. Đây là **lỗi cấu hình**, không phải lỗi code: provider Google chưa được bật trong Supabase Auth (cần bật provider + cấu hình OAuth Client ID/Secret trong Supabase dashboard).
- **Effort:** Thấp (cấu hình dashboard, không sửa code) · **Benefit:** Cao (tính năng đang hỏng hoàn toàn)
- **Đề xuất:** ✅ NÊN SỬA — ưu tiên cao. Nếu chưa kịp cấu hình, nên ẩn nút Google để tránh lỗi phơi ra người dùng.

## B. Đa ngôn ngữ (i18n)

### B1. Bật VI nhưng chưa dịch toàn bộ ứng dụng
- **Mô tả:** Khi chọn tiếng Việt, nhiều phần UI vẫn là tiếng Anh → i18n chưa phủ hết chuỗi.
- **Effort:** Cao (rà soát & bổ sung bản dịch cho toàn bộ chuỗi, cả nội dung động) · **Benefit:** Trung bình–Cao (tùy đối tượng; app hướng tới khách du lịch nên EN có thể là mặc định chính)
- **Đề xuất:** ⚠️ NÊN SỬA nhưng ưu tiên trung bình. Cân nhắc: hoàn thiện dần, hoặc tạm ẩn toggle VI cho tới khi phủ đủ để tránh trải nghiệm nửa vời.

## C. Itinerary Builder — input & artifact lập trình

### C1. Xóa khung "API live payload" hiển thị code chạy bên trong
- **Mô tả:** Khung debug lộ payload/code nội bộ ra giao diện người dùng. → Xóa hoặc ẩn ở môi trường production.
- **Effort:** Thấp · **Benefit:** Cao (artifact dev rò rỉ ra UI, trông thiếu chuyên nghiệp & có thể lộ thông tin)
- **Đề xuất:** ✅ NÊN SỬA — ưu tiên cao. Quick win.

### C2. Ô nhập "Days" hiển thị số 0 thừa phía trước (nhập 1 → hiện 001)
- **Mô tả:** Input số bị padding leading zeros. Cần chuẩn hoá: bỏ số 0 đứng đầu, chỉ hiển thị đúng số người dùng nhập.
- **Effort:** Thấp · **Benefit:** Trung bình (lỗi hiển thị gây bối rối)
- **Đề xuất:** ✅ NÊN SỬA — quick win.

### C3. Tab Sightseeing — thêm nút "Go to top"
- **Mô tả:** Khi "xem thêm" địa điểm, trang dài ra liên tục, cuộn lại đầu trang rất mất công. Thêm nút nổi "Lên đầu trang".
- **Effort:** Thấp · **Benefit:** Trung bình (tiện dụng rõ rệt với danh sách dài)
- **Đề xuất:** ✅ NÊN SỬA — quick win. (Có thể cân nhắc thêm pagination/infinite-scroll sau.)

## D. Preferences / Scoring

### D1. Scoring weights & Travel Style: bỏ phần trăm, dùng 3 mức Thấp/Trung bình/Cao
- **Gộp từ:** mục 3, mục 6 (Travel Style %), mục 8 — cùng một vấn đề.
- **Mô tả:** Hiển thị phần trăm cho từng tiêu chí gây bối rối. Thay bằng 3 mức rời rạc: Thấp / Trung bình / Cao (mapping nội bộ sang hệ số tương ứng).
- **Effort:** Trung bình (đổi UI control + ánh xạ giá trị; logic chấm điểm backend giữ nguyên) · **Benefit:** Cao (dễ hiểu hơn nhiều cho người dùng phổ thông)
- **Đề xuất:** ✅ NÊN SỬA — ưu tiên cao.

### D2. Tính năng Constraint (checkbox: avoid bus, strongly minimize fee...)
- **Mô tả (đã làm rõ với bạn):** Các constraint dạng checkbox quá cứng nhắc và mang tính tiêu cực; lựa chọn phương tiện ở Singapore vốn không nhiều nên các ràng buộc này phần lớn không cần thiết và chưa đủ rõ ràng.
- **Hướng:** Nếu **không** cải tiến được thành cá nhân hoá có ý nghĩa cho từng người → **bỏ constraint**, chỉ đánh giá bằng hệ số (scoring weights ở D1). Nếu cải tiến được thành tuỳ chọn cá nhân hoá hữu ích → giữ.
- **Effort:** Bỏ = Thấp · Cải tiến thành cá nhân hoá = Cao · **Benefit:** Trung bình (đơn giản hoá luồng, bớt rối)
- **Đề xuất:** ✅ NÊN SỬA theo hướng **bỏ** (đơn giản hoá), trừ khi có kế hoạch cá nhân hoá rõ ràng. Ưu tiên trung bình.

## E. Trip view (tabs Overview / Day 1 / Day 2 / Summary & Map)

### E1. Panel "đổi phương tiện" không tự đóng khi chuyển sang chặng khác
- **Mô tả:** Bấm "thay đổi phương tiện" ở một chặng sẽ mở danh sách phương án thay thế; hover vào phương án có hiện hướng dẫn di chuyển. Nhưng khi rời chuột và thao tác sang chặng khác, các panel/tooltip đã mở trước đó vẫn còn → nhiều panel mở cùng lúc gây rối. Cần tự đóng panel cũ khi mở/chuyển chặng khác (chỉ giữ 1 panel active).
- **Effort:** Trung bình (quản lý state "chặng đang mở") · **Benefit:** Trung bình–Cao (giảm lộn xộn rõ rệt)
- **Đề xuất:** ✅ NÊN SỬA — ưu tiên trung bình.

### E2. Nút bí ẩn kế bên nút "đổi phương tiện" — không rõ chức năng
- **Mô tả:** Có một nút cạnh nút đổi phương tiện, bấm vào không thấy thay đổi gì. Cần **điều tra trong code** để xác định chức năng → rồi quyết định: thêm nhãn/tooltip làm rõ, sửa nếu đang lỗi, hoặc xóa nếu vô dụng.
- **Effort:** Thấp–Trung bình (cần điều tra trước) · **Benefit:** Trung bình
- **Đề xuất:** ⚠️ CẦN ĐIỀU TRA trước khi quyết. (Chưa rõ về mặt kỹ thuật — không phải mơ hồ ngữ nghĩa.)

### E3. Icon số trên bản đồ chưa rõ ý nghĩa
- **Mô tả:** Các marker đánh số trên map không giải thích ý nghĩa (thứ tự điểm đến trong ngày?). Cần làm rõ mối liên hệ số trên map ↔ thứ tự trong danh sách (đồng bộ số, highlight khi hover, hoặc thêm legend).
- **Effort:** Trung bình · **Benefit:** Trung bình (tăng khả năng đọc bản đồ)
- **Đề xuất:** ✅ NÊN SỬA — ưu tiên trung bình.

### E4. Thanh kéo (resizer) giữa danh sách địa điểm và bản đồ
- **Mô tả:** Thêm divider kéo được để chỉnh tỉ lệ giữa danh sách trong ngày và bản đồ, dễ chuyển qua lại.
- **Effort:** Trung bình–Cao (split pane co giãn, xử lý responsive) · **Benefit:** Trung bình (nice-to-have)
- **Đề xuất:** 🟡 CÓ THỂ LÀM SAU — ưu tiên thấp.

---

## Bảng tổng hợp ưu tiên

| # | Vấn đề | Effort | Benefit | Ưu tiên |
|---|--------|--------|---------|---------|
| A3 | Bật Google login (cấu hình Supabase) | Thấp | Cao | 🔴 Cao |
| C1 | Xóa khung API live payload (debug) | Thấp | Cao | 🔴 Cao |
| A1 | Nút đăng nhập + giải thích lợi ích trong Settings | Thấp | Cao | 🔴 Cao |
| D1 | Bỏ %, dùng 3 mức Thấp/TB/Cao (weights + Travel Style) | TB | Cao | 🔴 Cao |
| C2 | Sửa leading zeros ở ô Days | Thấp | TB | 🟠 TB |
| C3 | Nút "Go to top" ở Sightseeing | Thấp | TB | 🟠 TB |
| A2 | Xóa icon trang trí Settings | Thấp | Thấp | 🟠 TB |
| E1 | Tự đóng panel đổi phương tiện cũ | TB | TB–Cao | 🟠 TB |
| E3 | Làm rõ ý nghĩa marker số trên map | TB | TB | 🟠 TB |
| D2 | Bỏ constraint, chỉ dùng hệ số | Thấp (bỏ) | TB | 🟠 TB |
| B1 | Hoàn thiện i18n tiếng Việt | Cao | TB–Cao | 🟡 Thấp–TB |
| E2 | Làm rõ nút bí ẩn (cần điều tra) | Thấp–TB | TB | 🟡 Điều tra |
| E4 | Resizer giữa list & map | TB–Cao | TB | 🟡 Thấp |

**Quick wins làm trước (effort thấp, benefit cao/TB):** A3, C1, A1, A2, C2, C3.

