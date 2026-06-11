# IMOVE V2 — Tham chiếu Frontend

> **Bối cảnh chung:** IMOVE V2 là web app lập kế hoạch du lịch bằng giao thông công cộng ở Singapore. Frontend là **React 18 + Vite**, dùng React Router, Leaflet (bản đồ), Tailwind/shadcn-style UI, và Supabase JS client (auth + realtime). Mọi lời gọi backend đi qua một file duy nhất: `frontend/src/services/api.js`.

---

## 1. Điểm vào & định tuyến (routing)
File `frontend/src/App.jsx` bọc toàn app trong `LanguageProvider` + `AuthProvider`, render `Header` + `ChatWidget` cố định, và 4 route:
| Route | Trang | Vai trò |
|---|---|---|
| `/` | `pages/Home.jsx` | Trang chủ: danh sách chuyến đã lưu + trạng thái (upcoming/today/past). |
| `/plan` | `pages/Planner.jsx` | Wizard lập lịch nhiều bước. |
| `/trip/:id` | `pages/Trip.jsx` | Xem & sửa một chuyến (tab danh sách / bản đồ). |
| `/settings` | `pages/Settings.jsx` | Đăng nhập + chỉnh sở thích (trọng số chấm điểm). |

Khi khởi động, `App` chạy `migrateLocalStorage()` (`lib/migrate.js`) để di trú dữ liệu cũ trong localStorage.

## 2. Tầng gọi API — `services/api.js`
- **Nơi duy nhất** gọi backend; tự gắn header `Authorization: Bearer <token>` lấy từ phiên Supabase (trừ khi `auth:false`).
- Xử lý lỗi tập trung: parse `detail` của FastAPI thành thông báo đọc được (`formatApiError`).
- Bao gồm: `createTrip`, `planTrip`, `getTrip`, `updateLeg`, `switchLegNow`, `optimizeRoute`, `addPlaceToDay`, `removePlaceFromDay`, `reorderPlaces`, `addDay`, `removeDay`, `adaptTrip`, `acceptSwap`, `checkAlerts`, `updateLocation`, `searchPlaces`, `geocodeHotel`, `getCuratedPlaces`, `suggestPlaces`, `getBusArrivals`, `compareRoutes`, `submitFeedback`, `get/updateUserPreferences`, `sendChat`, `confirmChatAction`.
- **localStorage helpers:** lưu danh sách chuyến & cache dữ liệu chuyến theo từng user (`imove_trips_<userId>` / `imove_trip_data_<userId>`; guest dùng hậu tố `_guest`) → cho phép xem offline.

## 3. Hooks (logic tái dùng)
| Hook | Vai trò |
|---|---|
| `hooks/useTrip.js` | Nạp `TripPlan` từ backend (kèm cache offline). |
| `hooks/useAlerts.js` | **Realtime:** subscribe bảng `lta_alerts` qua Supabase WebSocket (Postgres Changes) lọc theo `trip_id`; tự dedup theo `alert_type`; INSERT → thêm banner, UPDATE có `resolved_at` → gỡ banner. **Không polling.** |
| `hooks/useSavedTrips.js` | Quản lý danh sách chuyến đã lưu (localStorage + đồng bộ). |
| `hooks/useGeolocation.js` | Lấy vị trí GPS (cho switch-now & proximity). |

## 4. Contexts (state toàn cục)
| Context | Vai trò |
|---|---|
| `contexts/AuthContext.jsx` | Phiên đăng nhập Supabase (user, login/logout). |
| `contexts/LanguageContext.jsx` | Song ngữ Việt–Anh (i18n). |

## 5. Trang & component chính
**Planner (`pages/Planner.jsx`)** — wizard 4 bước: nhập khách sạn/điểm xuất phát (geocode), lọc & chọn điểm theo loại, đặt giờ bắt đầu ngày, xem trước payload API. Tạo chuyến rồi gọi `planTrip`.

**Trip (`pages/Trip.jsx`)** — hai tab:
- *List:* timeline mỗi ngày (điểm ↔ chặng), badge phương tiện, nút Optimize/Add/Remove/Reorder, đổi phương tiện, switch-now theo GPS, hiển thị cảnh báo.
- *Map:* vẽ polyline tuyến bằng Leaflet (`components/map/TripMap.jsx`), pin khách sạn & điểm, tô màu theo ngày.

**Component theo nhóm (`frontend/src/components/`):**
| Nhóm | Component tiêu biểu | Vai trò |
|---|---|---|
| `planner/` | `DayPlan`, `PlaceBrowser`, `PlaceSearch`, `PlaceCard`, `RouteCard`, `CitymapperTransitCard`, `TransitSegment`, `OverviewTab`, `SummaryTab`, `TripSetupModal`, `ActiveLegFocus`, `TravelTips` | Dựng & sửa lịch, so sánh phương tiện kiểu Citymapper |
| `map/` | `TripMap` | Bản đồ Leaflet + polyline |
| `adaptation/` | `AlertBanner`, `DisruptionSimulator` | Hiện cảnh báo realtime + mô phỏng sự cố |
| `auth/` | `AuthModal` | Đăng nhập/đăng ký |
| `chat/` | `ChatWidget` | Chatbot nổi, card xác nhận đề xuất |
| `transit/` | `BusArrivalPanel` | Đếm ngược giờ bus realtime |
| `layout/` | `Header` | Thanh điều hướng |
| `ui/` | `button`, `card`, `dialog`, `tabs`, `slider`, ... | Primitive UI dùng chung (shadcn-style) |

## 6. Thư viện tiện ích (`frontend/src/lib/`)
| File | Vai trò |
|---|---|
| `tripUtils.js` | Suy ra thứ tự điểm từ legs, dựng timeline, tính giờ đến/đi từng điểm, tính metrics (tổng thời gian/chi phí/quãng đi bộ), `computeTripStatus`, `haversineMeters`, định dạng ngày. |
| `transport.js` | Hằng số & nhãn phương tiện. |
| `grab.js` | Dựng deeplink mở app Grab (fallback Google Maps). |
| `supabase.js` | Supabase browser client (anon key). |
| `migrate.js` | Di trú dữ liệu localStorage cũ. |
| `utils.js` | Tiện ích chung (classnames…). |

## 7. Realtime hoạt động thế nào (tóm tắt cho FE)
1. Backend `insert` một dòng vào `lta_alerts`.
2. Supabase Realtime đẩy sự kiện qua WebSocket tới mọi client đang subscribe `trip-alerts-<tripId>`.
3. `useAlerts` nhận sự kiện → cập nhật state → `AlertBanner` hiện cảnh báo.
4. Người dùng bấm điều chỉnh → `adaptTrip` (đề xuất) → `acceptSwap` (áp dụng).

## 8. Kiểm thử frontend
- Dùng **Vitest**; test ở `frontend/src/__tests__/` phủ hooks (`useAlerts`, `useTrip`, `useSavedTrips`), pages (`Planner`, `Trip`), components (planner/map/auth/layout), và `lib/tripUtils`.
- Chạy: `cd frontend && npm test`.
