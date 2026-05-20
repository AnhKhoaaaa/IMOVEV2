# Kế hoạch cải thiện IMOVEV2 Frontend
> Lấy cảm hứng từ phân tích thực tế Trip.com Trip.Planner (Singapore 4 ngày, Solo, Cultural)

## Nguồn gốc

Trip.com Trip.Planner được khám phá trực tiếp qua browser automation (2026-05-20). Các cải tiến dưới đây được chắt lọc từ những điểm Trip.com làm tốt hơn IMOVEV2, đồng thời giữ nguyên thế mạnh cốt lõi của IMOVEV2 (Realtime transit alerts + OneMap routing chi tiết).

---

## Phân tích gap → Trạng thái sau khi triển khai

| Tính năng | Trip.com | IMOVEV2 trước | IMOVEV2 sau | Commit |
|-----------|----------|--------------|-------------|--------|
| Morning/Afternoon/Evening time blocks | ✅ | ❌ | ✅ | `a627bf9` |
| POI browsable cards với category filter | ✅ | ❌ | ✅ | `2cf55ec` |
| Travel style preferences | ✅ | ❌ | ✅ | `172ee6d` |
| AI tạo itinerary tự động | ✅ | ❌ | ✅ | `a8e633d` |
| Contextual travel tips | ✅ | ❌ | ✅ | `5658de3` |
| Map song song itinerary (2-panel) | ✅ | ❌ tab-only | ✅ | `f6bf573` |
| Realtime transit alerts | ❌ | ✅ | ✅ | — IMOVEV2 hơn |
| Transit routing chi tiết MRT/BUS | ❌ | ✅ | ✅ | — IMOVEV2 hơn |

---

## Bước 1 — Morning/Afternoon/Evening Time Blocks ✅ `a627bf9`

**Mục tiêu**: Group legs trong `DayPlan` theo thời gian trong ngày thay vì chỉ liệt kê tuần tự.

### Backend

**File**: `backend/app/models/trip.py`
- Thêm field `time_slot: str | None = None` vào `LegResponse`
- Values: `"morning"` / `"afternoon"` / `"evening"` / `None`

**File**: `backend/app/agents/planning_agent.py`
- Thêm `_time_slot(best_time_start)` helper — string comparison an toàn nhờ `_validate_time` zero-pads HH:MM
- Gán `time_slot` khi build `LegResponse` từ `from_place.best_time_start`

### Frontend

**File**: `frontend/src/components/planner/DayPlan.jsx`
- Group legs theo `time_slot` với `Array.reduce()`
- Render headers có emoji: `"🌅 Buổi sáng"` / `"☀️ Buổi chiều"` / `"🌙 Buổi tối"`
- Thứ tự render: morning → afternoon → evening → ungrouped (time_slot = null)
- **Fallback**: nếu tất cả `time_slot === null` → render danh sách như cũ

### Acceptance Criteria
- [x] Legs có `time_slot` được group đúng section
- [x] Legs không có `time_slot` vẫn render bình thường (backward compatible)
- [x] Existing trip view tests không bị break

---

## Bước 2 — POI Browsable Cards với Category Filter ✅ `2cf55ec`

**Mục tiêu**: Step 2 ("Địa điểm") hiển thị card grid thay vì chỉ search box.

### Frontend

**File mới**: `frontend/src/components/planner/PlaceBrowser.jsx`
- Fetch `api.getCuratedPlaces()` khi mount
- 6 category filter chips: Tất cả / Văn hoá / Tham quan / Thiên nhiên / Giải trí / Ẩm thực & Mua sắm
- Grid 2 cột — mỗi card: icon category + tên + `~X phút` + selected state (aria-pressed)
- Click card → toggle (add nếu chưa có, remove nếu có)
- Search input filter by name, instant, client-side

**File**: `frontend/src/pages/Planner.jsx` (Step 2)
- Replace `<PlaceSearch>` với `<PlaceBrowser selectedIds onToggle>`
- Thêm `togglePlace` handler

### Acceptance Criteria
- [x] Hiển thị đủ ~50 POIs sau khi load
- [x] Filter theo category hoạt động instant
- [x] Search by name hoạt động
- [x] Select/deselect cập nhật `places` state
- [x] Loading skeleton khi đang fetch

---

## Bước 3 — Travel Style Preferences Chips ✅ `172ee6d`

**Mục tiêu**: Capture travel style và group type, dùng làm input cho AI suggest (Bước 4).

### Frontend

**File**: `frontend/src/pages/Planner.jsx` (Step 3 "Tuỳ chỉnh")

**"Phong cách du lịch"** (multi-select chips):
- `cultural` — "Văn hoá & Di sản"
- `nature` — "Thiên nhiên"
- `entertainment` — "Giải trí & Vui chơi"
- `food` — "Ẩm thực địa phương"
- `shopping` — "Mua sắm"

**"Đi cùng ai"** (single-select, default `solo`):
- `solo` / `couple` / `group` / `family`

Pass vào `preferences` khi submit:
```js
preferences: {
  prefer_mrt, max_walk_minutes,
  travel_styles: string[],
  group_type: string,
}
```

### Acceptance Criteria
- [x] Chips render và toggle đúng
- [x] `preferences` gửi lên có `travel_styles` và `group_type`
- [x] MRT/walk preferences không bị ảnh hưởng

---

## Bước 4 — AI Suggest Mode ("Để AI lên lịch") ✅ `a8e633d`

**Mục tiêu**: Tab "AI Gợi ý" ở Step 2, dùng Gemini để tạo danh sách POI phù hợp.

### Backend

**File**: `backend/app/services/gemini.py`
- Thêm `suggest_places(num_days, travel_styles, group_type, all_places)` với `_SUGGEST_TEMPLATE`
- Dùng chung rate-limit lock (≤ 15 RPM)
- Validate: chỉ trả về IDs có trong dataset

**File**: `backend/app/agents/planning_agent.py`
- `_STYLE_CATEGORY_MAP`: map travel style → place categories
- `_rule_based_suggest(num_days, travel_styles)`: fallback sort by category match + `best_time_start`
- `suggest_places(...)`: gọi Gemini, fallback on any exception

**File**: `backend/app/routers/places.py`
- `POST /places/ai-suggest` — request: `{num_days, travel_styles, group_type}`, response: `{suggested_place_ids}`

### Frontend

**File**: `frontend/src/services/api.js` — thêm `suggestPlaces(body)`

**File**: `frontend/src/pages/Planner.jsx` (Step 2) — tab switcher `[Tự chọn | AI Gợi ý]`
- **Idle**: description + "Tạo gợi ý cho tôi" button
- **Thinking**: 3-step animation với Loader2 spinner
- **Done**: PlaceBrowser pre-selected; "Tạo lại" để reset
- **Error**: message + retry button

### Acceptance Criteria
- [x] Endpoint trả về valid place IDs từ `places.json`
- [x] Thinking animation hiển thị các bước
- [x] User có thể chỉnh sửa suggested list
- [x] Fallback rule-based hoạt động khi Gemini fail
- [x] Rate limit không bị vi phạm

---

## Bước 5 — Contextual Travel Tips Section ✅ `5658de3`

**Mục tiêu**: Hiển thị tips thực tế Singapore tích hợp trong Trip view, liên quan đến POI đã chọn.

### Frontend

**File mới**: `frontend/src/components/planner/TravelTips.jsx`
- Props: `places: Place[]`
- Luôn có: EZ-Link card, tiền mặt SGD
- Conditional: outdoor → sunscreen, museum/heritage/mosque/temple → dress code, `best_time_start >= 19:00` → book ahead, nature → weather
- Render dạng native `<details>/<summary>` collapsible, style amber (phân biệt với Alert đỏ/vàng)

**File**: `frontend/src/pages/Trip.jsx`
- `<TravelTips places={trip.places ?? []} />` sau DayPlan list

### Acceptance Criteria
- [x] Tips luôn có (EZ-Link + tiền mặt)
- [x] Conditional tips hiển thị đúng theo POI categories
- [x] Collapsible hoạt động
- [x] Không conflict với `AlertBanner` (màu amber vs red/yellow)

---

## Bước 6 — 2-Panel Layout (Map song song Itinerary) ✅ `f6bf573`

**Mục tiêu**: Sao chép layout của Trip.com — map luôn hiển thị bên cạnh itinerary, không cần tab.

### Frontend

**File**: `frontend/src/pages/Trip.jsx` — rebuild hoàn toàn

```
┌────────────────────────────────────────────────────────────────┐
│ 🗓 Hành trình Singapore   N ngày · M địa điểm  [Xem bản đồ] │ ← Header
├────────────────────────────────────────────────────────────────┤
│ ⚠ Alert zone (realtime alerts + best-time warnings)           │
├────────────────────────┬───────────────────────────────────────┤
│ [Tất cả][Ngày 1][Ngày 2]│                                    │
│ ──────────────────────  │        TripMap                     │
│ 🌅 Buổi sáng           │   (markers + polyline routes)      │
│ 🌞 Buổi chiều           │   lọc theo day tab đang chọn      │
│ 🌙 Buổi tối            │                                    │
│ 💡 Lưu ý hành trình    │                                    │
└────────────────────────┴───────────────────────────────────────┘
  ← 420px fixed →          ← flex-1 (remaining width) →
```

- **Layout**: `h-screen flex flex-col overflow-hidden` — map không cuộn cùng itinerary
- **Left panel**: `w-[420px] overflow-y-auto` — scrollable
- **Right panel**: `flex-1` — map luôn hiện trên desktop
- **Day filter tabs**: chỉ hiện khi `days.length > 1`; click lọc cả itinerary lẫn map legs
- **TripMap**: nhận `legs` prop — hiện route lines theo ngày đang chọn
- **Mobile**: "Xem bản đồ" toggle button trên header ẩn/hiện right panel

### Acceptance Criteria
- [x] Map luôn hiện bên phải trên desktop (không cần click tab)
- [x] Day tabs lọc đồng thời itinerary list và map legs
- [x] Mobile có nút toggle để xem/ẩn bản đồ
- [x] Header hiển thị số ngày và số địa điểm
- [x] Tất cả 9 tests cũ vẫn pass

---

## Danh sách files đã thay đổi

| File | Bước | Loại thay đổi |
|------|------|--------------|
| `backend/app/models/trip.py` | 1 | Thêm field `time_slot` |
| `backend/app/agents/planning_agent.py` | 1, 4 | `_time_slot`, `suggest_places`, `_rule_based_suggest` |
| `backend/app/services/gemini.py` | 4 | Thêm `suggest_places()` |
| `backend/app/routers/places.py` | 4 | Endpoint `POST /ai-suggest` |
| `frontend/src/components/planner/DayPlan.jsx` | 1 | Group theo time_slot |
| `frontend/src/components/planner/PlaceBrowser.jsx` | 2 | File mới — card grid |
| `frontend/src/pages/Planner.jsx` | 2, 3, 4 | PlaceBrowser + chips + AI tab |
| `frontend/src/components/planner/TravelTips.jsx` | 5 | File mới |
| `frontend/src/pages/Trip.jsx` | 5, 6 | TravelTips + 2-panel layout |
| `frontend/src/services/api.js` | 4 | Thêm `suggestPlaces()` |

**Tests thêm mới**: +60 frontend tests, +10 backend tests (tổng: 103 backend / 178 frontend)

---

## Nguyên tắc thực hiện

- Mỗi bước phải pass `pytest tests/ -v` và `npm test` trước khi commit
- Không thay đổi schema database (Supabase migrations)
- Không break tính backward compatible (trip data cũ vẫn render được)
- Gemini chỉ được gọi ở Bước 4, phải có fallback rule-based
- Không copy hotel booking hay multi-city — ngoài scope của transit app
