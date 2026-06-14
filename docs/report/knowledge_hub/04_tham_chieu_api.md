# IMOVE V2 — Tham chiếu API (Backend Endpoints)

> **Bối cảnh chung:** IMOVE V2 là web app lập kế hoạch du lịch bằng giao thông công cộng ở Singapore. Backend là FastAPI; tất cả endpoint được liệt kê dưới đây. Frontend gọi backend tập trung qua `frontend/src/services/api.js`. Auth dùng JWT của Supabase (header `Authorization: Bearer <token>`); guest không cần token.

---

## 0. Quy ước chung
- Base URL cấu hình qua `VITE_API_BASE_URL` ở frontend (rỗng → dùng Vite dev proxy).
- Lỗi trả về dạng `{ "detail": "..." }`. Mã thường gặp: `401` (chưa đăng nhập), `403` (không sở hữu), `404` (không thấy), `422` (dữ liệu/định tuyến không hợp lệ), `503` (API ngoài/DB không khả dụng).
- "Yêu cầu auth?" = endpoint có cần JWT không. **Optional** = chạy được cho guest, nhưng nếu có token sẽ cá nhân hoá.
- 7 router đăng ký trong `backend/app/main.py`: `health`, `places` (prefix `/places`), `trips` (`/trips`), `alerts` (`/alerts`), `transit` (`/transit`), `preferences` (`/users`), `chat` (`/chat`).

---

## 1. Health
| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Trả `{status, timestamp}`. Dùng để ping giữ server Render không ngủ đông. |

## 2. Places (`/places`) — tra cứu địa điểm
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/places/curated` | Không | Trả toàn bộ ~50 điểm tuyển chọn (list `Place`). |
| GET | `/places/search?q=...` | Không | Tìm điểm theo tên/loại/keyword (substring, không phân biệt hoa thường). |
| GET | `/places/geocode?q=...` | Không | Geocode địa chỉ/tên tự do qua OneMap → `{lat, lng, address}`. Dùng cho ô nhập khách sạn. `404` nếu không tìm thấy. |
| POST | `/places/ai-suggest` | Không | Body `{num_days, travel_styles[], group_type}` → Gemini gợi ý → trả `{suggested_place_ids[]}` (đã lọc bỏ ID bịa). |

## 3. Trips (`/trips`) — lập & quản lý chuyến đi (router lớn nhất)
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/trips` | Optional | Tạo chuyến. Body `{session_id, user_id?, num_days, budget_sgd, start_date?, end_date?, name?}` → `{trip_id}`. |
| POST | `/trips/{id}/plan` | Optional | **Lập lịch.** Body `{place_ids[≥2], optimize_order, preferences?, hotel_name?, hotel_lat?, hotel_lng?}` → `TripPlan`. Lỗi `422` nếu thiếu dữ liệu điểm / không có tuyến / vượt ngân sách. |
| GET | `/trips/{id}` | Optional | Lấy `TripPlan` (cache bộ nhớ → DB → `404`). `403` nếu không sở hữu. |
| PATCH | `/trips/{id}/legs/{leg_id}` | Không* | **Đổi phương tiện** một chặng (chế độ kế hoạch). Body `{transport_mode}` → `LegSwapResult`. `422` nếu mode không có tuyến. |
| POST | `/trips/{id}/legs/{leg_id}/switch-now` | Không* | **Đổi phương tiện trực tiếp theo GPS.** Body `{new_mode, current_lat, current_lng}` → `LegSwapResult` (có `routed_from_current_position`). |
| POST | `/trips/{id}/optimize` | Optional | Lập lại lịch có gọi OneMap thật (`optimize_order=True`). Body optional `{existing_legs[]}` để tái dùng tuyến đã biết. |
| POST | `/trips/{id}/days` | Optional | Thêm 1 ngày (num_days += 1), append ngày trống. |
| DELETE | `/trips/{id}/days/{day_num}` | Optional | Bớt 1 ngày → lập lại lịch với num_days−1. `422` nếu chỉ còn 1 ngày. |
| POST | `/trips/{id}/places` | Optional | Thêm điểm vào 1 ngày. Body `{place_id, day}` → `TripPlan`. `422` nếu day ngoài phạm vi / điểm không trong tập tuyển chọn. |
| DELETE | `/trips/{id}/places/{place_id}` | Optional | Xoá điểm + lập lại các ngày bị ảnh hưởng. `422` nếu còn <2 điểm. |
| PATCH | `/trips/{id}/reorder` | Optional | Đổi thứ tự điểm trong 1 ngày. Body `{day, place_ids[], existing_legs?}`. `422` nếu danh sách không khớp đúng các điểm của ngày đó. |
| DELETE | `/trips/{id}` | — | Xoá chuyến (cả cache lẫn DB). |
| POST | `/trips/{id}/adapt` | — | Xin **đề xuất** điều chỉnh cho 1 alert. Body `{alert_id, session_id?}` → `AdaptResponse` (chưa ghi DB). |
| POST | `/trips/{id}/accept-swap` | — | **Chấp nhận** đề xuất đang chờ → ghi DB + resolve alert. Body `{alert_id, session_id?}`. |
| POST | `/trips/{id}/location` (204) | — | Cập nhật GPS để kiểm tra proximity LTA. Body `{lat, lng, session_id?}`. |
| POST | `/trips/{id}/check-alerts` | — | Kiểm tra cảnh báo theo yêu cầu (trip UPCOMING). Body `{session_id?}` → `{lta_checked, weather_checked, alerts_inserted}`. |

\* *Các endpoint đổi leg không bắt buộc JWT, nhưng khi gọi qua chatbot thì có kiểm tra quyền sở hữu tập trung.*

## 4. Alerts (`/alerts`) — feedback & preferences đơn giản (Memory Agent)
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/alerts/feedback` (201) | Optional | Lưu rating/comment tường minh vào `trip_feedback`; nếu có user → chạy `learn_from_implicit`. Body `{trip_id, leg_id?, rating(1-5), comment?}`. |
| GET | `/alerts/preferences` | **Bắt buộc** | Trả sở thích đơn giản `{max_walk_minutes, prefer_mrt, avoid_transfers}`. |

## 5. Transit (`/transit`) — giao thông thời gian thực
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/transit/bus-arrivals/{stop_code}` | Không | Giờ xe bus thực tế từ LTA cho 1 mã trạm. `503` nếu LTA không khả dụng. |
| GET | `/transit/compare?from_lat&from_lng&to_lat&to_lng` | Không | So sánh PT / walk / cycle giữa 2 toạ độ → `RouteComparison`. `503` nếu OneMap lỗi. |

## 6. Preferences (`/users`) — hồ sơ trọng số chấm điểm
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/users/me/preferences` | **Bắt buộc** | Trả `UserPreferenceProfile` (4 trọng số + ràng buộc). Trả mặc định nếu chưa lưu. `401` nếu chưa đăng nhập. |
| PUT | `/users/me/preferences` | **Bắt buộc** | Lưu hồ sơ; trọng số được **re-normalize về tổng = 1.0** trước khi ghi. `503` nếu DB lỗi. |

## 7. Chat (`/chat`) — chatbot 2 bước
| Method | Path | Auth | Mô tả |
|---|---|---|---|
| POST | `/chat` | **Bắt buộc** | Một lượt hội thoại. Body `{session_id, message, trip_id?, gps?}` → `ChatResponse {reply, proposed_action?, pending_action_id?}`. Write tools chỉ trả *đề xuất*, không sửa. |
| POST | `/chat/confirm` | **Bắt buộc** | Xác nhận/huỷ đề xuất. Body `{session_id, pending_action_id, confirm}` → `ChatConfirmResponse {reply, executed, trip?}`. `404`/`409` nếu không có/không khớp pending. |

## 8. Các kiểu dữ liệu chính (models)
- **`TripPlan`** = `{id, name?, days[], places[], warnings[], gap_notifications[]}`.
- **`DayPlan`** = `{day, legs[], place_ids[]}`.
- **`LegResponse`** (1 chặng) = `{id, from_place_id, to_place_id, transport_mode, duration_minutes, cost_sgd, is_estimated, instructions[], geometry?, geometries[], distance_km?, sub_legs[], alternatives{}, first_bus_stop_code?}`.
- **`TransportMode`** = một trong `BUS | METRO | CYCLE | WALK | GRAB`.
- **`AlternativeRoute`** = dữ liệu 1 phương tiện đã nạp sẵn (in-memory, không lưu DB).
- **`UserPreferenceProfile`** = `{duration_w, cost_w, walking_w, transfers_w, constraints}` (4 trọng số tổng = 1.0).
- **`Place`** = `{id, name, lat, lng, category, is_outdoor, dwell_minutes, best_time_start, best_time_end, opening_hours?, ...}`.
- Định nghĩa đầy đủ ở `backend/app/models/trip.py`, `place.py`, `preferences.py`, `chat.py`.
