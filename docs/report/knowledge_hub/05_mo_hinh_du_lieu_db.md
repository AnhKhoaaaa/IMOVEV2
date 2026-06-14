# IMOVE V2 — Mô hình dữ liệu & Database

> **Bối cảnh chung:** IMOVE V2 là web app lập kế hoạch du lịch bằng giao thông công cộng ở Singapore. Dữ liệu lưu ở **Supabase (PostgreSQL + PostGIS)**; auth & realtime cũng do Supabase đảm nhiệm. Backend có thể chạy không cần DB (fallback bộ nhớ). Migrations ở `supabase/migrations/`.

---

## 1. Tổng quan các bảng
| Bảng | Mục đích |
|---|---|
| `trips` | Một chuyến đi (metadata: số ngày, ngân sách, ngày bắt đầu, trạng thái, khách sạn, chủ sở hữu). |
| `trip_places` | Các điểm thuộc một chuyến + thứ tự theo ngày. |
| `route_legs` | Các chặng di chuyển (leg) giữa hai điểm + phương tiện + dữ liệu tuyến. |
| `lta_alerts` | Cảnh báo (tàu/bus/thời tiết/proximity) cho một chuyến — nguồn của Realtime. |
| `trip_feedback` | Đánh giá tường minh + hành vi ngầm (cho Memory Agent học). |
| `user_preferences` | Sở thích người dùng đăng nhập (hồ sơ trọng số chấm điểm — JSONB). |

## 2. Quan hệ (ERD dạng text)
```
auth.users (Supabase)
   | 1
   | 0..N
trips ----1---<  trip_places
   |  \---1---<  route_legs
   |  \---1---<  lta_alerts
   |  \---1---<  trip_feedback
user_preferences --1--1-- auth.users   (mỗi user 1 hồ sơ; chỉ khi đăng nhập)
```
- `trips.user_id` **nullable** (guest); guest định danh bằng `trips.session_id` (UUID localStorage).
- Mọi bảng con tham chiếu `trips(id)` với `on delete cascade` (xoá chuyến → xoá hết dữ liệu con).

## 3. Bảng `trips` — các cột quan trọng
| Cột | Kiểu | Ý nghĩa |
|---|---|---|
| `id` | uuid (PK) | Khoá chính. |
| `user_id` | uuid (nullable) | Chủ sở hữu nếu đăng nhập; NULL nếu guest. |
| `session_id` | text | Định danh guest (localStorage). |
| `num_days` | int | Số ngày. |
| `budget_sgd` | numeric | Ngân sách (SGD). |
| `status` | text | Vòng đời: `DRAFT | UPCOMING | HAPPENING_TODAY | PAST` (có CHECK constraint). |
| `start_date`, `end_date` | date | Mốc thời gian cho state machine. |
| `name` | text | Tên chuyến (do người dùng đặt). |
| `hotel_name`, `hotel_lat`, `hotel_lng` | text/numeric | Khách sạn = điểm neo. |

## 4. Bảng `route_legs` — các cột quan trọng
| Cột | Ý nghĩa |
|---|---|
| `id` | uuid của leg (cũng là id trong `LegResponse`). |
| `trip_id`, `day_number` | Thuộc chuyến nào, ngày nào. |
| `from_place_id`, `to_place_id` | Điểm đi/đến (text id; "hotel" cho khách sạn). |
| `transport_mode` | `BUS|METRO|CYCLE|WALK|GRAB` (dữ liệu cũ "MRT"/"LRT" được map về "METRO" khi đọc). |
| `duration_minutes`, `cost_sgd` | Thời gian & chi phí. |
| `is_estimated` | **false** = tuyến thật từ OneMap; **true** = ước lượng haversine/Grab. |
| `geometry`, `geometries[]` | Polyline mã hoá để vẽ trên bản đồ. |
| `instructions[]`, `sub_legs[]` | Hướng dẫn & chi tiết các đoạn PT (mode, route, trạm, mã trạm…). |
| `first_bus_stop_code` | Mã trạm bus đầu tiên (để gọi giờ bus realtime). |

## 5. Bảng `lta_alerts` — nguồn của Realtime
| Cột | Ý nghĩa |
|---|---|
| `id`, `trip_id` | Khoá + chuyến liên quan. |
| `alert_type` | `train_delay | weather_warning | service_unavailable | transport_alert`. |
| `affected_line` | Tuyến MRT bị ảnh hưởng (vd "East West Line"); NULL với thời tiết. |
| `message` | Nội dung hiển thị. |
| `created_at`, `resolved_at` | Thời điểm tạo / đã xử lý (NULL = còn hiệu lực). |

> **Cơ chế dedup:** trước khi insert, backend kiểm tra cùng `alert_type`(+`affected_line`) chưa được tạo trong **10 phút** gần nhất. Frontend (`useAlerts`) cũng dedup theo `alert_type` để không hiện trùng.

## 6. Vòng đời chuyến đi (state machine)
```
DRAFT  ->  UPCOMING  ->  HAPPENING_TODAY  ->  PAST
(nháp)    (sắp tới)      (đang diễn ra)        (đã qua)
```
- Frontend suy ra trạng thái từ `start_date` + `num_days` (hàm `computeTripStatus` trong `frontend/src/lib/tripUtils.js`): chưa tới → `upcoming`; đang trong khoảng → `today`; đã qua → `past`; không có ngày → `draft`.
- **Scheduler chỉ poll trip `HAPPENING_TODAY`** (tự động cảnh báo); trip `UPCOMING` dùng `check-alerts` theo yêu cầu.

## 7. PostGIS — tìm điểm trong nhà gần nhất
- RPC `find_nearest_indoor(input_lat, input_lng, exclude_ids)` (thêm ở migration 007, sửa ở 008): dùng chỉ mục không gian KNN, kiểm giờ mở cửa ngay trong DB, trả 0 hoặc 1 điểm.
- Adaptation Agent gọi RPC này trước; nếu lỗi → fallback quét haversine trên JSON `singapore_places.json`.

## 8. Danh sách migrations (lịch sử tiến hoá schema)
| File | Nội dung chính |
|---|---|
| `001_initial_schema.sql` | Bảng gốc + index + RLS cơ bản. |
| `002_rls_patch.sql`, `003_security_patch.sql` | Vá bảo mật RLS. |
| `004_schema_code_alignment.sql` | Đồng bộ schema với code. |
| `004_trip_status_lifecycle.sql` | Đổi status sang `DRAFT/UPCOMING/HAPPENING_TODAY/PAST` + thêm `start_date/end_date`. |
| `005_user_preferences_weighted_scoring.sql` | Hồ sơ trọng số (profile JSONB). |
| `006_lta_alerts_index.sql` | Index cho alerts. |
| `007_places_postgis.sql`, `008_fix_find_nearest_indoor.sql` | PostGIS + RPC tìm điểm trong nhà. |
| `009_places_image_url.sql`, `010_places_google_enrichment.sql` | Ảnh + làm giàu dữ liệu Google Places. |
| `011_route_legs_geometry_instructions.sql`, `012_route_legs_transit_detail.sql` | Thêm cột geometry/instructions/sub_legs cho leg. |
| `013_cleanup_stale_trip_data.sql` | Dọn dữ liệu cũ. |
| `014_trip_hotel_details.sql` | Cột khách sạn cho trips. |
| `015_trip_name.sql` | Cột tên chuyến. |

## 9. Bảo mật dữ liệu (RLS & ownership)
- **RLS** bật trên `trips`, `user_preferences`, `lta_alerts`: chủ sở hữu theo `user_id = auth.uid()` hoặc `session_id`.
- Backend kiểm tra thêm ở tầng router: `_verify_user_ownership` (user) và `_verify_session_ownership` (guest) → trả `403` nếu không khớp.
- Supabase client backend dùng **service_role key** (`backend/app/database.py`); frontend dùng **anon key** (`frontend/src/lib/supabase.js`).

## 10. Ghi/đọc dữ liệu — lưu ý
- **Ghi (`_persist_trip_plan`):** mỗi lần lập lại lịch sẽ **xoá sạch rồi insert lại** `route_legs` + `trip_places` của chuyến → tránh hàng "ma" tích tụ.
- **Đọc (`_fetch_trip_from_db`):** dựng lại `TripPlan` đầy đủ (kể cả polyline, sub_legs) từ DB sau khi server restart; khách sạn được tái tạo từ bảng `trips`.
- **Lưu ý:** trường `alternatives` của mỗi leg (dữ liệu các phương tiện thay thế) **chỉ ở bộ nhớ, không lưu DB** → sau restart, lần đổi mode đầu tiên có thể phải gọi OneMap lại.
