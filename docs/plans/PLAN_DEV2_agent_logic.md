# IMOVE — Dev 2: Agent Logic

**Branch:** `dev/agent-logic`  
**Owns:** `backend/app/agents/` · `routers/trips.py` · `routers/alerts.py` · `app/data/places.json` · `supabase/migrations/`  
**Quy trình PR, testing, anti-hallucination rules → xem PLAN_OVERVIEW.md**

---

## File ownership

```
backend/app/agents/
  planning_agent.py · adaptation_agent.py · memory_agent.py
backend/app/routers/
  trips.py · alerts.py
backend/app/data/
  places.json
supabase/migrations/
  001_initial_schema.sql
```

---

## Phase 1 — Database Schema

**File:** `supabase/migrations/001_initial_schema.sql`

```sql
-- user_preferences
id uuid PK, user_id uuid FK auth.users NOT NULL,
max_walk_minutes int DEFAULT 15, prefer_mrt bool DEFAULT false, avoid_transfers bool DEFAULT false

-- trips
id uuid PK, user_id uuid nullable (guest), session_id text NOT NULL,
num_days int NOT NULL, budget_sgd numeric NOT NULL, status text DEFAULT 'planning'

-- trip_places
id uuid PK, trip_id uuid FK CASCADE, place_id text, place_name text,
lat numeric, lng numeric, day_number int, order_in_day int, dwell_minutes int,
best_time_start time, best_time_end time
-- Index: (trip_id, day_number)

-- route_legs
id uuid PK, trip_id uuid FK CASCADE, day_number int,
from_place_id uuid FK trip_places, to_place_id uuid FK trip_places,
transport_mode text, duration_minutes int, cost_sgd numeric,
instructions jsonb, is_estimated bool DEFAULT false  ← BẮT BUỘC

-- lta_alerts  ← BẬT SUPABASE REALTIME trên bảng này
id uuid PK, trip_id uuid FK CASCADE,
alert_type text NOT NULL,  -- train_delay | bus_cancellation | service_unavailable | weather_warning
affected_line text, message text NOT NULL, created_at timestamptz, resolved_at timestamptz

-- trip_feedback
id uuid PK, trip_id uuid FK CASCADE, user_id uuid nullable,
leg_id uuid FK route_legs, rating int CHECK(1-5), comment text,
feedback_type text DEFAULT 'explicit'  -- explicit | implicit
```

RLS: `trips` → session_id match hoặc user_id = auth.uid(). `lta_alerts` → read-only cho client, write từ service role.

Sau khi apply: bật Realtime cho `lta_alerts` trong Supabase Dashboard → Replication.

---

## Tasks — Phase 2B (làm tuần tự)

### Task 1: places.json — Curated dataset (~50 POI)
```json
{
  "id": "gardens-by-the-bay", "name": "Gardens by the Bay",
  "lat": 1.2816, "lng": 103.8636,
  "category": "nature", "is_outdoor": true,
  "dwell_minutes": 120, "best_time_start": "08:00", "best_time_end": "22:00",
  "opening_hours": "05:00-02:00", "source": "data.gov.sg"
}
```
`is_outdoor: true` cho địa điểm ngoài trời, `false` cho trong nhà (museum, mall, USS...).  
`dwell_minutes` và `best_time_*` nghiên cứu thủ công — không dùng LLM để sinh.

### Task 2: Planning Agent
Logic 7 bước (75% code, 25% LLM):
1. **[CODE]** Validate: tất cả place_id có trong places.json → `PlaceDataMissingError` nếu thiếu
2. **[CODE]** Nếu optimize_order=True: greedy nearest-neighbor (Haversine distance)
3. **[CODE]** Phân ngày: tổng dwell_time mỗi ngày ≤ 480 phút
4. **[CODE+API]** Mỗi chặng: gọi `onemap.get_route()` → lưu duration, cost, instructions. `NoRouteError` → raise ngay
5. **[CODE]** Kiểm tra tổng cost ≤ budget_sgd → `BudgetExceededError`
6. **[CODE]** Check best_time conflict → thêm vào `warnings` (soft, không block)
7. **[LLM]** Chỉ gọi Gemini khi có edge case preferences phức tạp. Comment rõ lý do.

### Task 3: Trips Router
```
POST /trips           → {"session_id", "num_days", "budget_sgd"} → {"trip_id"}
POST /trips/{id}/plan → TripPlanRequest → TripPlan (lưu vào DB)
GET  /trips/{id}      → {"trip", "days": [DayPlan], "warnings": [str]}
PATCH /trips/{id}/legs/{leg_id} → {"transport_mode", "notes"} → {"leg"}
  ↳ log vào trip_feedback(feedback_type="implicit") để Memory Agent học
```
Error → HTTP 422 với message cụ thể theo PRD Section 5.

### Task 4: Adaptation Agent
```python
# Job 1: poll_lta_alerts() — APScheduler, mỗi 2 phút
async def poll_lta_alerts():
    # [CODE] Lấy active trips → gọi lta.get_train_alerts()
    # [CODE] Alert ảnh hưởng tuyến trong trip → INSERT lta_alerts(type="train_delay"|"bus_cancellation")
    # [CODE] Tính route thay thế qua OneMap → update route_legs
    # LTAUnavailableError → INSERT type="service_unavailable", không tính lại

# Job 2: poll_weather_alerts() — APScheduler, mỗi 30 phút  ← MỚI
async def poll_weather_alerts():
    # [CODE] Lấy active trips → gọi openweather.get_forecast(today)
    # [CODE] rain_probability > 70% + trip_places có is_outdoor=True trong ngày hôm nay
    #   → Tìm indoor alternative trong places.json (cùng khu vực, is_outdoor=False)
    #   → INSERT lta_alerts(type="weather_warning", message="Dự báo mưa — đề xuất thay [outdoor] → [indoor]")
    # WeatherUnavailableError → log warning, bỏ qua hoàn toàn

# Manual trigger: POST /trips/{id}/adapt
# Body: {"reason": str, "current_lat": float, "current_lng": float}
# → Tính lại route từ vị trí hiện tại HOẶC thay outdoor places bằng indoor (nếu weather trigger)
```

### Task 5: Memory Agent
```
POST /feedback → lưu rating/comment → learn_from_explicit_feedback()
GET /preferences → trả user_preferences (chỉ logged-in)
learn_from_implicit(): Bus→Walk nhiều lần → tăng max_walk_minutes
                       Bus→MRT nhiều lần → prefer_mrt=true
```

---

## Test files

| File | Cần test gì |
|------|------------|
| `test_agents/test_planning_agent.py` | place không tồn tại → PlaceDataMissingError · 4 điểm → thứ tự gần hơn · 10 điểm 2 ngày → ≤8h/ngày · budget vượt → BudgetExceededError · warning best_time |
| `test_agents/test_adaptation_agent.py` | LTA down → service_unavailable · alert trùng tuyến → route_legs update · weather rain>70% + outdoor → weather_warning insert · WeatherUnavailableError → không crash |
| `test_routers/test_trips.py` | POST /trips → trip_id · POST /plan mock agent → TripPlan · PlaceDataMissingError → HTTP 422 · PATCH leg → DB update |

---

## Acceptance Criteria

- [ ] `pytest test_agents/ test_routers/test_trips.py -v` → 100% PASS
- [ ] `POST /trips/{id}/plan` với 3 địa điểm hợp lệ → TripPlan đầy đủ
- [ ] Địa điểm không trong places.json → HTTP 422 + message đúng
- [ ] Không có `is_estimated=True` nào không có lý do rõ ràng
