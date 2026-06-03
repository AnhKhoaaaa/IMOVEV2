# Plan: Live Mode-Switch trong Chuyến Đi Đang Diễn Ra

## Prerequisite

**dev2.md phải được implement xong trước** — dev3.md dùng lại:
- `AlternativeRoute`, `LegSwapResult`, `LegUpdateRequest` (models)
- `switch_leg_mode()`, `_fetch_all_alternatives()`, `_apply_leg_update()` (agent/router helpers)
- `get_route(transit_modes=...)` (onemap service)

---

## Bối cảnh & Vấn đề

`PATCH /legs/{id}` (dev2.md) phục vụ người dùng **đang lập kế hoạch** — không cần GPS, dùng route từ điểm A theo kế hoạch.

Khi chuyến đi **đang diễn ra**, user có thể:
- Vẫn ở điểm A (chưa lên phương tiện) → route từ A vẫn đúng → dùng cache là đủ
- Đã rời A, đang giữa đường → vị trí GPS ≠ A → route phải tính từ GPS hiện tại

Hai tình huống này cần cùng một endpoint, với logic xử lý khác nhau dựa vào khoảng cách GPS đến điểm xuất phát.

**Phân biệt rõ với `/adapt`:**

| | `/adapt` | `/legs/{id}/switch-now` |
|---|---|---|
| Trigger | System (LTA alert, rain) | User bấm nút |
| Cần alert_id | ✅ | ❌ |
| Flow | Propose → Accept | Commit ngay |
| Origin | Luôn từ from_place | GPS nếu giữa chừng |

---

## Thứ tự thực hiện

```
1. models/trip.py          — LiveSwitchRequest + thêm field vào LegSwapResult
2. agents/planning_agent.py — switch_leg_mode_live()
3. routers/trips.py        — endpoint POST /legs/{leg_id}/switch-now
4. Tests
```

---

## File 1 — `backend/app/models/trip.py`

### Thêm `LiveSwitchRequest`

```python
class LiveSwitchRequest(BaseModel):
    new_mode: TransportMode
    current_lat: float = Field(ge=-90, le=90)
    current_lng: float = Field(ge=-180, le=180)
```

### Mở rộng `LegSwapResult` (thêm 1 field)

```python
class LegSwapResult(BaseModel):
    updated_leg: LegResponse
    trip_cost_sgd: float
    warnings: list[str] = []
    routed_from_current_position: bool = False   # ← NEW
    # True = geometry bắt đầu từ GPS, không phải from_place
    # Frontend cần biết để hiển thị chú thích "Route from your location"
```

---

## File 2 — `backend/app/agents/planning_agent.py`

### Thêm constant `_AT_ORIGIN_THRESHOLD_KM`

```python
_AT_ORIGIN_THRESHOLD_KM = 0.2  # 200m — nếu GPS cách from_place ≤ 200m → coi là "ở điểm A"
```

### Thêm `switch_leg_mode_live()`

```python
async def switch_leg_mode_live(
    new_mode: TransportMode,
    target_leg: LegResponse,
    plan: TripPlan,
    current_lat: float,
    current_lng: float,
) -> "LegSwapResult":
    """Live mode switch dùng GPS làm origin nếu user đã rời điểm xuất phát.

    Fast path  : GPS ≤ 200m từ from_place → dùng switch_leg_mode() từ dev2 (cache/on-demand từ A).
    Realtime   : GPS > 200m từ from_place → gọi OneMap từ GPS → to_place ngay lúc này.

    Raises NoRouteError nếu mode yêu cầu không khả thi.
    """
    from app.models.trip import LegSwapResult, AlternativeRoute

    place_map = {p.id: p for p in plan.places}
    from_place = place_map.get(target_leg.from_place_id)
    to_place   = place_map.get(target_leg.to_place_id)

    if not from_place or not to_place:
        raise NoRouteError(f"Place data missing for leg '{target_leg.id}'")

    dist_to_origin = _haversine_km(current_lat, current_lng, from_place.lat, from_place.lng)

    # ── Fast path ──────────────────────────────────────────────────────────────
    if dist_to_origin <= _AT_ORIGIN_THRESHOLD_KM:
        result = await switch_leg_mode(new_mode, target_leg, plan)
        # routed_from_current_position = False (default)
        return result

    # ── Realtime path ──────────────────────────────────────────────────────────
    # Xác định onemap mode + transit filter
    if new_mode == "WALK":
        onemap_mode  = "walk"
        transit_modes = None
    elif new_mode == "BUS":
        onemap_mode  = "pt"
        transit_modes = "BUS"
    else:  # METRO
        onemap_mode  = "pt"
        transit_modes = None

    try:
        route = await onemap.get_route(
            current_lat, current_lng,
            to_place.lat, to_place.lng,
            mode=onemap_mode,
            transit_modes=transit_modes,
        )
        route["is_estimated"] = False
    except NoRouteError:
        raise NoRouteError(
            f"No {new_mode} route from your current position to '{target_leg.to_place_id}'. "
            "Try a different transport mode."
        )
    except Exception as exc:
        raise NoRouteError(
            f"Routing unavailable from current position to '{target_leg.to_place_id}': {exc}"
        ) from exc

    # Sanity check: BUS-only request nhưng OneMap trả METRO → không phải bus-only route
    if new_mode == "BUS":
        actual_primary = _primary_mode(route.get("legs", []))
        if actual_primary != "BUS":
            raise NoRouteError(
                f"No BUS-only route available from your current position "
                f"to '{target_leg.to_place_id}'."
            )

    # Build updated leg — giữ nguyên alternatives (A-based, vẫn hữu ích cho planning view)
    updated_leg = target_leg.model_copy(update={
        "transport_mode":  new_mode,
        "duration_minutes": route["duration_minutes"],
        "cost_sgd":         route.get("fare_sgd", 0.0),
        "is_estimated":     False,
        "geometry":         route.get("geometry"),
        "geometries":       route.get("geometries", []),
        "instructions":     route.get("instructions", []),
        "distance_km":      route.get("distance_km"),
        "sub_legs":         route.get("sub_legs", []),
        # alternatives: giữ nguyên từ cache — không xóa
    })

    # Schedule check (cùng logic như switch_leg_mode)
    warnings: list[str] = []
    duration_delta = route["duration_minutes"] - target_leg.duration_minutes
    if duration_delta != 0:
        for day in plan.days:
            if not any(leg.id == target_leg.id for leg in day.legs):
                continue

            seen_places: set[str] = set()
            total_dwell = 0
            for leg in day.legs:
                if leg.from_place_id not in seen_places:
                    total_dwell += place_map[leg.from_place_id].dwell_minutes
                    seen_places.add(leg.from_place_id)
            if day.legs:
                last_to = day.legs[-1].to_place_id
                if last_to not in seen_places:
                    total_dwell += place_map[last_to].dwell_minutes

            total_transit = sum(
                (updated_leg.duration_minutes if leg.id == target_leg.id else leg.duration_minutes)
                for leg in day.legs
            )
            day_end = 540 + total_dwell + total_transit
            if day_end > 1050:
                warnings.append(
                    f"Switching to {new_mode} adds {duration_delta:+d} min — "
                    f"Day {day.day} will end around {_fmt_hhmm(day_end)}."
                )
            break

    # Tổng cost toàn trip
    trip_cost = sum(
        (updated_leg.cost_sgd if leg.id == target_leg.id else leg.cost_sgd)
        for day in plan.days
        for leg in day.legs
    )

    return LegSwapResult(
        updated_leg=updated_leg,
        trip_cost_sgd=round(trip_cost, 2),
        warnings=warnings,
        routed_from_current_position=True,
    )
```

---

## File 3 — `backend/app/routers/trips.py`

### Thêm endpoint `POST /{trip_id}/legs/{leg_id}/switch-now`

```python
from app.models.trip import LiveSwitchRequest

@router.post("/{trip_id}/legs/{leg_id}/switch-now")
async def switch_leg_now(trip_id: str, leg_id: str, body: LiveSwitchRequest):
    """User-initiated live mode switch dùng vị trí GPS hiện tại.
    
    Khác PATCH /legs/{id}:
    - Nhận GPS coords → tự quyết fast path (cache) vs realtime (OneMap từ GPS)
    - Không cần alert_id, không qua accept-swap flow
    - Persist ngay sau khi switch
    """
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    # Tìm leg
    target_leg = None
    for day in plan.days:
        for leg in day.legs:
            if leg.id == leg_id:
                target_leg = leg
                break
        if target_leg:
            break
    if target_leg is None:
        raise HTTPException(status_code=404, detail=f"Leg '{leg_id}' not found")

    old_mode = target_leg.transport_mode

    try:
        result = await planning_agent.switch_leg_mode_live(
            new_mode=body.new_mode,
            target_leg=target_leg,
            plan=plan,
            current_lat=body.current_lat,
            current_lng=body.current_lng,
        )
    except NoRouteError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Budget check
    meta = _trip_meta.get(trip_id, {})
    budget = meta.get("budget_sgd")
    if budget is not None and result.trip_cost_sgd > budget:
        result.warnings.append(
            f"Estimated transit cost S${result.trip_cost_sgd:.2f} "
            f"exceeds your budget of S${budget:.2f}."
        )

    # Cập nhật in-memory store
    updated_plan = _apply_leg_update(plan, leg_id, result.updated_leg)
    _trip_store[trip_id] = updated_plan

    # Persist — cập nhật đầy đủ như PATCH /legs
    if supabase:
        leg = result.updated_leg
        supabase.table("route_legs").update({
            "transport_mode":   leg.transport_mode,
            "duration_minutes": leg.duration_minutes,
            "cost_sgd":         leg.cost_sgd,
            "is_estimated":     leg.is_estimated,
            "geometry":         leg.geometry,
            "instructions":     leg.instructions,
        }).eq("id", leg_id).execute()

        origin_note = "from GPS" if result.routed_from_current_position else "from place"
        supabase.table("trip_feedback").insert({
            "trip_id":       trip_id,
            "leg_id":        leg_id,
            "feedback_type": "implicit",
            "comment":       f"Live switch ({origin_note}): {old_mode} → {leg.transport_mode}",
        }).execute()

    return result   # LegSwapResult
```

---

## File 4 — Tests

### `test_agents/test_planning_agent.py`

```python
# Fast path: GPS ≤ 200m từ from_place → kết quả giống switch_leg_mode()
test_switch_live_at_origin_uses_cache()

# Realtime path: GPS > 200m → gọi onemap.get_route với GPS coords
test_switch_live_mid_journey_calls_onemap_with_gps()

# Realtime BUS: transitModes="BUS" được pass, primary_mode xác nhận BUS
test_switch_live_mid_journey_bus_mode_uses_transit_modes()

# Realtime BUS nhưng OneMap trả METRO → NoRouteError
test_switch_live_mid_journey_bus_fallback_to_metro_raises()

# Mode không khả thi → NoRouteError rõ ràng
test_switch_live_mid_journey_no_route_raises()

# routed_from_current_position = True khi mid-journey
test_switch_live_mid_journey_sets_flag()

# routed_from_current_position = False khi at origin
test_switch_live_at_origin_flag_false()

# Schedule warning khi duration tăng đẩy day_end > 17:30
test_switch_live_schedule_warning_overfull()
```

### `test_routers/test_trips.py`

```python
# Endpoint tồn tại và trả LegSwapResult shape
test_switch_now_returns_leg_swap_result()

# GPS gần origin (≤200m) → fast path, không gọi OneMap
test_switch_now_at_origin_no_extra_api_call()

# GPS xa origin → OneMap được gọi với GPS coords (không phải from_place coords)
test_switch_now_mid_journey_calls_onemap_with_gps_coords()

# Mode không có → 422
test_switch_now_no_route_422()

# Budget exceeded → warning trong response
test_switch_now_budget_warning()
```

---

## So sánh 3 endpoint mode-switch

| | `PATCH /legs/{id}` | `POST /legs/{id}/switch-now` | `POST /trips/{id}/adapt` |
|---|---|---|---|
| Trigger | User (planning) | User (active travel) | System alert |
| GPS cần? | ❌ | ✅ | ❌ |
| Route origin | from_place (cached) | GPS nếu > 200m từ A | from_place |
| Tốc độ | < 1s (cache) | < 1s nếu at origin; 1-3s nếu GPS | 1-3s |
| Commit ngay? | ✅ | ✅ | ❌ (cần /accept-swap) |
| Response | `LegSwapResult` | `LegSwapResult` (+ `routed_from_current_position`) | `AdaptResponse` |

---

## Verification

```bash
cd backend

pytest tests/test_agents/test_planning_agent.py -v -k "live"
pytest tests/test_routers/test_trips.py -v -k "switch_now"
pytest tests/ -v   # full suite — phải pass tất cả
```

Kiểm tra thủ công:
1. Gọi với GPS = from_place coords → `routed_from_current_position: false`, kết quả từ cache
2. Gọi với GPS cách from_place 1km → `routed_from_current_position: true`, geometry bắt đầu từ GPS
3. GPS mid-journey + mode không có route → 422 với message "from your current position"
4. Switch METRO → WALK giữa chừng với leg dài → schedule warning nếu day > 17:30
