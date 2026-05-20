# Kế hoạch cải thiện IMOVEV2 Frontend
> Lấy cảm hứng từ phân tích thực tế Trip.com Trip.Planner (Singapore 4 ngày, Solo, Cultural)

## Nguồn gốc

Trip.com Trip.Planner được khám phá trực tiếp qua browser automation (2026-05-20). Các cải tiến dưới đây được chắt lọc từ những điểm Trip.com làm tốt hơn IMOVEV2, đồng thời giữ nguyên thế mạnh cốt lõi của IMOVEV2 (Realtime transit alerts + OneMap routing chi tiết).

---

## Phân tích gap

| Tính năng | Trip.com | IMOVEV2 hiện tại | Độ ưu tiên |
|-----------|----------|-----------------|------------|
| Morning/Afternoon/Evening time blocks | ✅ | ❌ Chỉ legs liên tiếp | **Cao** |
| POI browsable cards với category filter | ✅ | ❌ Search box thuần | **Cao** |
| Travel style preferences | ✅ Cultural/Nature/etc | ❌ Chỉ MRT/walk | **Cao** |
| AI tạo itinerary tự động | ✅ DeepDive 7 bước | ❌ Manual pick | **Cao** |
| Contextual travel tips | ✅ Singapore-specific | ❌ Không có | **Trung bình** |
| Realtime transit alerts | ❌ | ✅ Supabase WebSocket | IMOVEV2 hơn |
| Transit routing chi tiết MRT/BUS | ❌ | ✅ OneMap API | IMOVEV2 hơn |

---

## Bước 1 — Morning/Afternoon/Evening Time Blocks

**Mục tiêu**: Group legs trong `DayPlan` theo thời gian trong ngày thay vì chỉ liệt kê tuần tự.

### Backend

**File**: `backend/app/models/trip.py`
- Thêm field `time_slot: str | None = None` vào `LegResponse`
- Values: `"morning"` / `"afternoon"` / `"evening"` / `None`

**File**: `backend/app/agents/planning_agent.py`
- Khi build `LegResponse`, tra `best_time_start` của `from_place` từ `places.json`:
  - `best_time_start < "12:00"` → `"morning"`
  - `"12:00" <= best_time_start < "17:00"` → `"afternoon"`
  - `best_time_start >= "17:00"` → `"evening"`
  - Không có `from_place` trong curated list → `None`

### Frontend

**File**: `frontend/src/components/planner/DayPlan.jsx`
- Group legs theo `time_slot` với `Array.reduce()`
- Render headers có emoji: `"🌅 Buổi sáng"` / `"☀️ Buổi chiều"` / `"🌙 Buổi tối"`
- Thứ tự render: morning → afternoon → evening → ungrouped (time_slot = null)
- **Fallback**: nếu tất cả `time_slot === null` → render danh sách như cũ

### Tests
- `backend/tests/test_agents/test_planning_agent.py`: kiểm tra `time_slot` assignment
- `frontend/src/__tests__/components/DayPlan.test.jsx`: kiểm tra grouping và fallback

### Acceptance Criteria
- [ ] Legs có `time_slot` được group đúng section
- [ ] Legs không có `time_slot` vẫn render bình thường (backward compatible)
- [ ] Existing trip view tests không bị break

---

## Bước 2 — POI Browsable Cards với Category Filter

**Mục tiêu**: Step 2 ("Địa điểm") hiển thị card grid thay vì chỉ search box.

### Frontend

**File**: `frontend/src/pages/Planner.jsx` (Step 2 section)  
**File**: `frontend/src/components/planner/PlaceSearch.jsx`

- Gọi `api.getPlaces()` (endpoint `GET /places` đã có) khi mount Step 2
- Category filter chips ở trên: **All** / **Cultural** / **Nature** / **Entertainment** / **Food**
- Mỗi POI card hiển thị:
  - Tên địa điểm
  - Icon category (MapPin / Leaf / Sparkles / Utensils / ShoppingBag)
  - `~{dwell_minutes} phút`
  - Selected state (border + checkmark khi đã chọn)
- Click card → toggle add/remove khỏi `places` state
- Search input: filter by name, instant, client-side
- **Không thay đổi backend**

### Tests
- `frontend/src/__tests__/pages/Planner.test.jsx`: mock `api.getPlaces()`, kiểm tra filter/search/select

### Acceptance Criteria
- [ ] Hiển thị đủ ~50 POIs sau khi load
- [ ] Filter theo category hoạt động instant
- [ ] Search by name hoạt động
- [ ] Select/deselect cập nhật `places` state
- [ ] Loading skeleton khi đang fetch

---

## Bước 3 — Travel Style Preferences Chips

**Mục tiêu**: Capture travel style và group type, dùng làm input cho AI suggest (Bước 4).

### Frontend

**File**: `frontend/src/pages/Planner.jsx` (Step 3 "Tuỳ chỉnh")

Thêm 2 section mới trước các preferences hiện có:

**"Phong cách du lịch"** (multi-select chips):
- `cultural` — "Văn hoá & Di sản"
- `nature` — "Thiên nhiên"
- `entertainment` — "Giải trí & Vui chơi"
- `food` — "Ẩm thực địa phương"
- `shopping` — "Mua sắm"

**"Đi cùng ai"** (single-select chips):
- `solo` — "Một mình"
- `couple` — "Cặp đôi"
- `group` — "Nhóm bạn"
- `family` — "Gia đình"

Pass vào `preferences` khi submit:
```js
preferences: {
  prefer_mrt: preferMrt,
  max_walk_minutes: maxWalkMinutes,
  travel_styles: travelStyles,   // string[]
  group_type: groupType,          // string
}
```

### Backend

**File**: `backend/app/agents/planning_agent.py`
- `preferences` dict accept `travel_styles` và `group_type` mà không báo lỗi
- Log chúng nhưng chưa dùng (dùng ở Bước 4)

### Tests
- Kiểm tra `preferences` object trong API request body có đúng keys

### Acceptance Criteria
- [ ] Chips render và toggle đúng
- [ ] `preferences` gửi lên có `travel_styles` và `group_type`
- [ ] MRT/walk preferences không bị ảnh hưởng

---

## Bước 4 — AI Suggest Mode ("Để AI lên lịch")

**Mục tiêu**: Tab "AI Gợi ý" ở Step 2, dùng Gemini để tạo danh sách POI phù hợp.

### Backend

**File**: `backend/app/routers/trips.py`
- Thêm endpoint: `POST /places/ai-suggest`
- Request body: `{ "num_days": int, "travel_styles": list[str], "group_type": str }`
- Response: `{ "suggested_place_ids": list[str] }`

**File**: `backend/app/agents/planning_agent.py`
- Thêm function `async def ai_suggest_places(num_days, travel_styles, group_type) -> list[str]`
- Gemini prompt inject toàn bộ places.json (id, name, category, best_time_start, is_outdoor, dwell_minutes)
- Yêu cầu Gemini trả về JSON array of place IDs, sorted để optimize time-of-day và travel style
- Rate-limit guard: dùng existing `services/gemini.py` rate limiter
- **Fallback rule-based** khi Gemini fail:
  - Filter POI có `category` trong `travel_styles`
  - Sort by `best_time_start`
  - Giới hạn `num_days * 3` POIs

### Frontend

**File**: `frontend/src/pages/Planner.jsx` (Step 2)  
**File**: `frontend/src/services/api.js`
- Thêm `api.suggestPlaces({ num_days, travel_styles, group_type })`
- Step 2 có 2 tabs: `[🗂️ Tự chọn]` `[✨ AI Gợi ý]`
- Tab "AI Gợi ý":
  1. Button "Tạo gợi ý cho tôi" (disabled nếu chưa set num_days ở Step 3 — hoặc dùng default=1)
  2. Loading state: hiển thị thinking steps animation:
     ```
     ⏳ Đang phân tích sở thích của bạn...
     ⏳ Đang tìm địa điểm phù hợp...
     ⏳ Đang tối ưu lịch trình...
     ✅ Hoàn tất!
     ```
  3. Kết quả: hiển thị card grid (giống Tab "Tự chọn") nhưng pre-selected theo AI suggest
  4. User có thể bỏ bớt hoặc thêm POI trước khi Next

### Tests
- Backend: `backend/tests/test_routers/test_trips.py` — mock Gemini, test endpoint
- Frontend: mock `api.suggestPlaces()`, test loading/success/error/fallback states

### Acceptance Criteria
- [ ] Endpoint trả về valid place IDs từ `places.json`
- [ ] Thinking animation hiển thị các bước
- [ ] User có thể chỉnh sửa suggested list
- [ ] Fallback rule-based hoạt động khi Gemini fail
- [ ] Rate limit không bị vi phạm

---

## Bước 5 — Contextual Travel Tips Section

**Mục tiêu**: Hiển thị tips thực tế Singapore tích hợp trong Trip view, liên quan đến POI đã chọn.

### Frontend

**File**: `frontend/src/components/planner/TravelTips.jsx` (file mới)
- Props: `days` (mảng DayPlan objects từ trip data)
- Extract tất cả place IDs/categories từ `days`
- Compute tips theo rules:

| Điều kiện | Tip |
|-----------|-----|
| Luôn có | "Mua thẻ EZ-Link tại quầy Changi Airport để đi MRT/bus tiện lợi hơn" |
| Luôn có | "Hầu hết hawker centre và quán ăn vỉa hè chỉ nhận tiền mặt SGD" |
| Có `is_outdoor: true` | "Mang kem chống nắng SPF 50+ — Singapore có UV Index cao quanh năm" |
| Có category `religious` hoặc tên chứa "mosque"/"temple" | "Ăn mặc kín đáo và cởi giày trước khi vào đền/chùa/nhà thờ Hồi giáo" |
| Có `best_time_start >= "19:00"` | "Book vé trước trên app để tránh xếp hàng tại điểm tham quan về đêm" |
| Có category `nature` | "Kiểm tra dự báo thời tiết — mưa chiều thường xuyên tháng 11-1" |

- Render dạng collapsible `<details>` / accordion
- Style: icon Lightbulb màu amber, không dùng destructive/warning (tránh nhầm với Alerts)

**File**: `frontend/src/pages/Trip.jsx`
- Import và render `<TravelTips days={trip.days} />` sau section DayPlan list (trước footer)

### Tests
- `frontend/src/__tests__/components/TravelTips.test.jsx`: mock trip data với các category combinations

### Acceptance Criteria
- [ ] Tips luôn có (EZ-Link + tiền mặt)
- [ ] Conditional tips hiển thị đúng theo POI categories
- [ ] Collapsible hoạt động
- [ ] Không conflict với `AlertBanner` (màu amber vs red/yellow)

---

## Danh sách files

| File | Bước | Loại thay đổi |
|------|------|--------------|
| `backend/app/models/trip.py` | 1 | Thêm field |
| `backend/app/agents/planning_agent.py` | 1, 3, 4 | Logic mới |
| `backend/app/routers/trips.py` | 4 | Endpoint mới |
| `frontend/src/components/planner/DayPlan.jsx` | 1 | Refactor |
| `frontend/src/pages/Planner.jsx` | 2, 3, 4 | Extend |
| `frontend/src/components/planner/PlaceSearch.jsx` | 2 | Refactor |
| `frontend/src/pages/Trip.jsx` | 5 | Thêm component |
| `frontend/src/components/planner/TravelTips.jsx` | 5 | File mới |
| `frontend/src/services/api.js` | 4 | Thêm method |

---

## Nguyên tắc thực hiện

- Mỗi bước phải pass `pytest tests/ -v` và `npm test` trước khi commit
- Không thay đổi schema database (Supabase migrations)
- Không break tính backward compatible (trip data cũ vẫn render được)
- Gemini chỉ được gọi ở Bước 4, phải có fallback rule-based
- Không copy hotel booking hay multi-city — ngoài scope của transit app
