# Plan: dev6 — LTA Realtime Hardening

## Mục tiêu

Bốn cải tiến độc lập cho pipeline LTA realtime, được thực hiện theo thứ tự dependency:

1. **Proactive re-routing** — `_reroute_mrt_legs` tự phát hiện disrupted line và ép BUS-only khi OTP vẫn trả METRO.
2. **Bus stop code exposure** — `LegResponse.first_bus_stop_code` giúp frontend dễ dàng gọi `/transit/bus-arrivals/{code}` cho từng card xe bus.
3. **DB index migration** — 2 index trên `lta_alerts` loại bỏ full table scan trong dedup poll.
4. **Demand check endpoint** — `POST /trips/{id}/check-alerts` cho UPCOMING trips; không polling ngầm, user trigger khi mở trang.

---

## Thay đổi theo file

### File 1 — `supabase/migrations/006_lta_alerts_index.sql` *(mới)*

```sql
-- Partial index: covers 3/4 dedup patterns (train_delay, service_unavailable, transport_alert)
-- WHERE resolved_at IS NULL → index nhỏ hơn ~60%, planner ưu tiên khi query IS NULL
CREATE INDEX IF NOT EXISTS lta_alerts_dedup_unresolved_idx
  ON lta_alerts (trip_id, alert_type, created_at DESC)
  WHERE resolved_at IS NULL;

-- Full index: covers weather_warning pattern (không filter resolved_at)
-- trip_id + alert_type đủ selective → range scan trên created_at rất nhanh
CREATE INDEX IF NOT EXISTS lta_alerts_dedup_full_idx
  ON lta_alerts (trip_id, alert_type, created_at DESC);
```

Không cần thay đổi backend code — PostgreSQL tự chọn index phù hợp cho từng query pattern.

---

### File 2 — `backend/app/models/trip.py`

Thêm 1 field mới vào `LegResponse`:

```python
class LegResponse(BaseModel):
    ...
    # NEW: LTA bus stop code của điểm boarding đầu tiên.
    # Chỉ có giá trị khi transport_mode == "BUS".
    # Frontend dùng để gọi GET /transit/bus-arrivals/{first_bus_stop_code}
    first_bus_stop_code: str | None = None
```

Không thay đổi các field cũ → backward compatible.

---

### File 3 — `backend/app/agents/adaptation_agent.py`

**A. Thêm `_LTA_LINE_PREFIX` mapping**

```python
# Map từ LTA affected_line name → prefix của route code trong OneMap sub_legs
# VD: "East West Line" → sub_legs có route "EW2", "EW12", ...
_LTA_LINE_PREFIX: dict[str, str] = {
    "East West Line":          "EW",
    "North South Line":        "NS",
    "Circle Line":             "CC",
    "Downtown Line":           "DT",
    "Thomson-East Coast Line": "TE",
    "North East Line":         "NE",
}
```

**B. Refactor `_reroute_mrt_legs` — thêm `disrupted_lines` param + post-filter logic**

Signature mới:
```python
async def _reroute_mrt_legs(
    plan: TripPlan,
    disrupted_lines: list[str] = [],
) -> tuple[TripPlan, list[str]]:
```

Logic per METRO leg:
```
1. Tính disrupted_prefixes từ disrupted_lines qua _LTA_LINE_PREFIX
2. Gọi onemap.get_route(mode="pt") bình thường
3. Kiểm tra sub_legs: có route nào bắt đầu bằng disrupted prefix không?
   - Không: dùng kết quả PT bình thường (OTP đã tự tránh)
   - Có: retry với transit_modes="BUS"
     - OK: dùng BUS result, ghi changes
     - NoRouteError: giữ nguyên leg gốc + is_estimated=True + thêm warning vào plan.warnings
4. Build LegResponse mới với sub_legs và first_bus_stop_code đúng cách
```

Helper detect — **Bulletproof: mode phải được kiểm tra TRƯỚC tiên (short-circuit)**:

> **Lý do quan trọng:** Tên trạm dừng xe bus tại Singapore thường nhúng mã tuyến MRT lân cận
> làm chỉ dẫn lối ra (ví dụ: `"Bugis Stn Exit B EW12"`). Nếu chỉ quét chuỗi route mà không
> kiểm tra `mode` trước, sub-leg của xe BUS sẽ bị nhận nhầm là chặng MRT đang gặp sự cố.

```python
def _leg_uses_disrupted_line(sub_legs: list[dict], disrupted_prefixes: set[str]) -> bool:
    """Return True iff any sub-leg is a METRO leg on a disrupted line.

    ⚠️  mode == "METRO" được kiểm tra TRƯỚC (Python short-circuit evaluation).
    Nếu mode != "METRO" thì điều kiện route prefix không bao giờ được evaluate,
    tránh false positive với BUS sub-legs có tên trạm chứa mã MRT (e.g. "EW12").
    """
    return any(
        sl.get("mode") == "METRO"                      # ① METRO check — short-circuits if False
        and any(                                       # ② chỉ kiểm tra route khi đã xác nhận METRO
            sl.get("route", "").upper().startswith(pfx)
            for pfx in disrupted_prefixes
        )
        for sl in sub_legs
    )
```

**C. Cập nhật `adapt_trip` — truyền `affected_line` xuống**

```python
# Trong adapt_trip(), trước khi gọi _reroute_mrt_legs:
disrupted_lines = [alert["affected_line"]] if alert.get("affected_line") else []
updated_plan, changes = await _reroute_mrt_legs(current_plan, disrupted_lines=disrupted_lines)
```

**D. Cập nhật `_recalculate_leg` — populate `first_bus_stop_code`**

Khi rebuild LegResponse từ OneMap route (trong `_recalculate_leg` và `_reroute_mrt_legs`):
```python
sub_legs_data = route.get("sub_legs", [])
bus_stop = None
if new_mode == "BUS":
    bus_leg = next((sl for sl in sub_legs_data if sl.get("mode") == "BUS"), None)
    if bus_leg:
        bus_stop = bus_leg.get("from_stop_code") or None

LegResponse(
    ...
    sub_legs=sub_legs_data,
    first_bus_stop_code=bus_stop,
)
```

**E. Thêm hàm `check_alerts_for_trip` — dùng cho demand endpoint**

```python
async def check_alerts_for_trip(trip_id: str, plan: TripPlan) -> dict:
    """On-demand alert check cho một trip cụ thể (UPCOMING).
    
    Chạy cả LTA train check lẫn weather check, insert vào lta_alerts như poll jobs.
    Trả về {"lta_checked": bool, "weather_checked": bool, "alerts_inserted": int}.
    """
```

Logic:
- Kiểm tra trip có METRO legs → gọi `lta.get_train_alerts()` → insert nếu có disruption (cùng dedup logic)
- Kiểm tra trip có outdoor places → gọi `openweather.get_forecast()` → insert nếu rain > 70% (cùng dedup logic)
- Trả về summary dict

Tái sử dụng helpers `_compute_centroid`, `_nearest_indoor` đã có.

---

### File 4 — `backend/app/agents/planning_agent.py`

Cập nhật hàm `_build_leg_response` (hoặc nơi build `LegResponse` từ `route` dict) để populate `first_bus_stop_code`:

```python
# Khi build LegResponse từ route dict trong plan_trip / _get_route_with_fallback:
sub_legs_data = route.get("sub_legs", [])
bus_stop_code = None
if transport_mode == "BUS":
    bus_sub = next((sl for sl in sub_legs_data if sl.get("mode") == "BUS"), None)
    if bus_sub:
        bus_stop_code = bus_sub.get("from_stop_code")

legs.append(LegResponse(
    ...
    sub_legs=sub_legs_data,
    first_bus_stop_code=bus_stop_code,
))
```

---

### File 5 — `backend/app/routers/trips.py`

Thêm endpoint mới:

```python
@router.post("/{trip_id}/check-alerts", status_code=200)
async def check_trip_alerts(trip_id: str, body: SessionRequest):
    """Demand-driven alert check cho UPCOMING trips.
    
    Frontend gọi khi user mở xem trip ngày mai.
    Chạy cả LTA lẫn weather check, insert vào lta_alerts.
    Frontend nhận alert qua Supabase Realtime (đường WebSocket sẵn có).
    """
    if body.session_id:
        _verify_session_ownership(trip_id, body.session_id)
    
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")
    
    result = await adaptation_agent.check_alerts_for_trip(trip_id, plan)
    return result
```

`SessionRequest` — reuse model đã có (chỉ cần `session_id: str | None`).

---

## Scope KHÔNG thay đổi

- `poll_lta_alerts()` trong APScheduler: **giữ nguyên** (HAPPENING_TODAY, 2 phút, không mở rộng sang UPCOMING)
- `poll_weather_alerts()`: **giữ nguyên**
- Frontend: chưa implement UI cho bus countdown — chỉ cần backend expose `first_bus_stop_code` sẵn sàng
- `onemap.get_route()`: **không thay đổi** — `transit_modes` param đã có sẵn

---

## Tests cần viết/cập nhật

### `backend/tests/test_agents/test_adaptation_agent.py`

Thêm mới:
- `test_reroute_detects_disrupted_line_and_retries_bus_only` — mock route PT trả sub_leg "EW2", disrupted_lines=["East West Line"] → verify retry với transit_modes="BUS"
- `test_reroute_skips_retry_when_line_not_disrupted` — sub_leg "NS27", disrupted_lines=["East West Line"] → verify chỉ 1 API call
- `test_reroute_fallback_keeps_original_on_bus_no_route` — retry BUS cũng NoRouteError → leg gốc giữ nguyên, is_estimated=True
- `test_check_alerts_for_trip_lta_inserts_on_disruption` — plan có METRO leg, LTA trả alert → assert insert được gọi
- `test_check_alerts_for_trip_weather_inserts_on_rain` — plan có outdoor place, rain > 70% → assert insert

Cập nhật:
- `test_adapt_trip_train_delay_reroutes_mrt_legs` — thêm assert lấy `affected_line` từ alert và truyền xuống

### `backend/tests/test_routers/test_trips.py`

Thêm mới:
- `test_check_alerts_endpoint_returns_200_for_known_trip`
- `test_check_alerts_endpoint_returns_404_for_unknown_trip`

### `backend/tests/test_services/test_lta.py`

Giữ nguyên — `get_bus_arrival` và `get_train_alerts` không thay đổi interface.

---

## Thứ tự thực hiện

```
1. supabase/migrations/006_lta_alerts_index.sql  — chạy trước, không phụ thuộc code
2. backend/app/models/trip.py                    — thêm first_bus_stop_code
3. backend/app/agents/adaptation_agent.py        — _LTA_LINE_PREFIX, _reroute_mrt_legs, check_alerts_for_trip
4. backend/app/agents/planning_agent.py          — populate first_bus_stop_code khi build leg
5. backend/app/routers/trips.py                  — thêm /check-alerts endpoint
6. Tests                                         — viết và chạy
```

---

## Verification

```bash
cd backend && pytest tests/test_agents/test_adaptation_agent.py -v
cd backend && pytest tests/test_routers/test_trips.py -v
cd backend && pytest tests/ -v
```

Kiểm tra thủ công:
- `POST /trips/{id}/adapt` với `alert_type=train_delay`, `affected_line="East West Line"` → legs với EW route được reroute sang BUS
- `POST /trips/{id}/check-alerts` → lta_alerts có row mới, useAlerts.js nhận qua WebSocket
- `LegResponse.first_bus_stop_code` có giá trị cho BUS legs, `null` cho METRO/WALK
