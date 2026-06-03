# Plan: Real Mode-Switch với Pre-fetched Alternatives

## Bối cảnh & Vấn đề

`PATCH /trips/{id}/legs/{leg_id}` hiện tại chỉ đổi label `transport_mode` — duration, cost, geometry, sub_legs không thay đổi theo. Điều này tạo ra dữ liệu không nhất quán: leg có label WALK nhưng duration 3 phút của MRT, hay geometry polyline đường tàu.

**Mục tiêu:** Khi user switch mode, hệ thống tra cứu route thật cho mode đó và thay thế toàn bộ dữ liệu leg.

---

## Quyết định kiến trúc

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Thời điểm fetch | Upfront khi `plan_trip` | User switch phải instant; không chờ API |
| Mode hỗ trợ | BUS + METRO + WALK | 3 mode thực tế ở Singapore |
| Khi mode không khả thi | 422 rõ ràng | Không fake data |
| Post-switch | Update leg + recheck budget + schedule warning | Không reorder places |
| Lưu alternatives | In-memory (`LegResponse.alternatives`) | Không persist DB; cache miss → on-demand fallback |

---

## Thứ tự thực hiện

```
1. models/trip.py          — thêm AlternativeRoute + LegSwapResult, patch LegResponse
2. services/onemap.py      — thêm transit_modes param cho get_route()
3. agents/planning_agent.py — _fetch_all_alternatives, cập nhật plan_trip, thêm switch_leg_mode
4. routers/trips.py        — cập nhật PATCH handler + DB write
5. Tests
```

---

## File 1 — `backend/app/models/trip.py`

### Thêm `AlternativeRoute`

```python
class AlternativeRoute(BaseModel):
    """Dữ liệu route đầy đủ cho một mode thay thế — lưu in-memory, không persist DB."""
    duration_minutes: int
    cost_sgd: float
    is_estimated: bool = False
    geometry: str | None = None
    geometries: list[str] = []
    instructions: list[str] = []
    distance_km: float | None = None
    sub_legs: list[PTSubLeg] = []   # chỉ có nội dung cho PT modes
```

### Cập nhật `LegResponse`

Thêm field:
```python
alternatives: dict[str, AlternativeRoute] = {}
# key = TransportMode ("BUS", "METRO", "WALK")
# Không có trong DB schema → Field(default={}, exclude=True) nếu muốn exclude khỏi JSON,
# hoặc giữ nguyên — frontend sẽ nhận thêm field này (không harmful).
```

### Thêm `LegSwapResult`

Response model mới cho PATCH endpoint:
```python
class LegSwapResult(BaseModel):
    updated_leg: LegResponse
    trip_cost_sgd: float   # tổng cost toàn trip sau khi switch
    warnings: list[str] = []
    # warnings bao gồm: schedule overfull, budget exceeded
```

---

## File 2 — `backend/app/services/onemap.py`

### Thêm `transit_modes` param vào `get_route()`

```python
async def get_route(
    from_lat: float, from_lng: float,
    to_lat: float, to_lng: float,
    mode: str,
    transit_modes: str | None = None,   # ← NEW: e.g. "BUS" để yêu cầu bus-only
) -> dict:
```

Khi `mode="pt"` và `transit_modes` được truyền:
```python
if mode.lower() == "pt":
    params.update({
        "date": ..., "time": ..., "mode": "TRANSIT", "numItineraries": 1,
    })
    if transit_modes:
        params["transitModes"] = transit_modes  # OneMap OTP param
```

**Lưu ý:** Nếu OneMap không hỗ trợ `transitModes` param, request vẫn thành công nhưng trả về mixed route → `_primary_mode()` sẽ đọc được METRO thay vì BUS → không store làm BUS alternative (xử lý ở layer trên). Không gây lỗi.

---

## File 3 — `backend/app/agents/planning_agent.py`

### A. Thêm `_fetch_all_alternatives(from_p, to_p)`

```python
async def _fetch_all_alternatives(from_p: dict, to_p: dict) -> dict[str, dict]:
    """Fetch tất cả route alternatives song song: PT (mixed), PT bus-only, Walk.
    
    Returns dict[TransportMode, route_dict] — chỉ bao gồm mode nào có route.
    Mọi NoRouteError đều được bắt im lặng.
    """
    async def _safe(mode: str, transit_modes: str | None = None) -> dict | None:
        try:
            r = await onemap.get_route(
                from_p["lat"], from_p["lng"],
                to_p["lat"], to_p["lng"],
                mode=mode,
                transit_modes=transit_modes,
            )
            r["is_estimated"] = False
            return r
        except Exception:
            return None

    pt_route, bus_route, walk_route = await asyncio.gather(
        _safe("pt"),
        _safe("pt", transit_modes="BUS"),
        _safe("walk"),
    )

    result: dict[str, dict] = {}

    # PT mixed → key = primary mode (METRO or BUS)
    if pt_route:
        primary = _primary_mode(pt_route.get("legs", []))  # "METRO" or "BUS"
        result[primary] = pt_route

    # PT bus-only → store under "BUS" only if primary_mode confirms it's a BUS route
    if bus_route:
        bus_primary = _primary_mode(bus_route.get("legs", []))
        if bus_primary == "BUS":
            result["BUS"] = bus_route   # overwrite if already there (bus-only is more precise)

    # Walk
    if walk_route:
        result["WALK"] = walk_route

    return result
```

### B. Cập nhật `plan_trip` — thay `_get_route_with_fallback` bằng `_fetch_all_alternatives`

**Thay đổi bước fetch parallel:**

```python
# Trước:
fetch_results = await asyncio.gather(
    *[_get_route_with_fallback(a, b) for a, b in unique_pairs],
    return_exceptions=True,
)
route_cache: dict[tuple, dict] = {}
for (a, b), result in zip(unique_pairs, fetch_results):
    if not isinstance(result, Exception):
        route_cache[(a["id"], b["id"])] = result

# Sau: fetch all alternatives + fallback nếu cần
alt_results = await asyncio.gather(
    *[_fetch_all_alternatives(a, b) for a, b in unique_pairs],
    return_exceptions=True,
)
route_cache: dict[tuple, dict] = {}        # best route (primary mode) cho timing
alt_cache:   dict[tuple, dict] = {}        # toàn bộ alternatives dict

for (a, b), alts in zip(unique_pairs, alt_results):
    if isinstance(alts, Exception):
        continue
    alt_cache[(a["id"], b["id"])] = alts

    # Chọn route tốt nhất để tính timing: ưu tiên theo khoảng cách
    dist_km = _haversine_km(a["lat"], a["lng"], b["lat"], b["lng"])
    primary_mode_key = "WALK" if dist_km < 1.5 else next(
        (m for m in ("METRO", "BUS") if m in alts), "WALK"
    )
    best = alts.get(primary_mode_key)
    if best:
        route_cache[(a["id"], b["id"])] = best
    # Nếu không có gì → PT route thật sự không khả thi, raise NoRouteError như cũ
    elif not alts:
        raise NoRouteError(f"No route available from '{a['id']}' to '{b['id']}'")
```

**Build `AlternativeRoute` khi tạo `LegResponse`:**

```python
from app.models.trip import AlternativeRoute

def _to_alternative(route_dict: dict, mode: str) -> AlternativeRoute:
    return AlternativeRoute(
        duration_minutes=route_dict["duration_minutes"],
        cost_sgd=route_dict.get("fare_sgd", 0.0),
        is_estimated=route_dict.get("is_estimated", False),
        geometry=route_dict.get("geometry"),
        geometries=route_dict.get("geometries", []),
        instructions=route_dict.get("instructions", []),
        distance_km=route_dict.get("distance_km"),
        sub_legs=route_dict.get("sub_legs", []),
    )

# Khi build LegResponse:
alts_for_leg = alt_cache.get(route_key, {})
alternatives = {
    mode: _to_alternative(r, mode)
    for mode, r in alts_for_leg.items()
}
legs.append(LegResponse(
    ...,
    alternatives=alternatives,
))
```

**Haversine fallback vẫn giữ** — khi toàn bộ `_fetch_all_alternatives` trả về empty, inject 1 WALK estimate:
```python
if not alts_for_leg:
    # Short-distance walk estimate
    if dist_km < 1.5:
        estimated_dur = max(1, round(dist_km / 5.0 * 60))
        alternatives = {"WALK": AlternativeRoute(
            duration_minutes=estimated_dur, cost_sgd=0.0,
            is_estimated=True, geometry=None, geometries=[],
        )}
    else:
        raise NoRouteError(f"No route from '{from_p['id']}' to '{to_p['id']}'")
```

### C. Thêm `switch_leg_mode()`

```python
async def switch_leg_mode(
    new_mode: TransportMode,
    target_leg: LegResponse,
    plan: TripPlan,
) -> LegSwapResult:
    """Đổi mode của leg: tra alternatives cache, fallback on-demand nếu cache miss.
    
    Raises NoRouteError nếu không có route cho mode được yêu cầu.
    """
    from app.models.trip import AlternativeRoute, LegSwapResult

    # 1. Lấy alternative từ cache
    alt = target_leg.alternatives.get(new_mode)

    # 2. Cache miss (e.g. server restart → trip loaded từ DB không có alternatives)
    if alt is None:
        place_map = {p.id: p for p in plan.places}
        from_place = place_map.get(target_leg.from_place_id)
        to_place   = place_map.get(target_leg.to_place_id)
        if not from_place or not to_place:
            raise NoRouteError(f"Place data missing for leg '{target_leg.id}'")

        fresh_alts = await _fetch_all_alternatives(
            {"id": from_place.id, "lat": from_place.lat, "lng": from_place.lng},
            {"id": to_place.id,   "lat": to_place.lat,   "lng": to_place.lng},
        )
        # Merge vào alternatives của leg (cho lần switch tiếp theo trong session)
        new_alternatives = {
            **target_leg.alternatives,
            **{m: _to_alternative(r, m) for m, r in fresh_alts.items()},
        }
        target_leg = target_leg.model_copy(update={"alternatives": new_alternatives})
        alt = target_leg.alternatives.get(new_mode)

    if alt is None:
        raise NoRouteError(
            f"No {new_mode} route available between "
            f"'{target_leg.from_place_id}' and '{target_leg.to_place_id}'. "
            "Try a different transport mode."
        )

    # 3. Build updated leg — giữ lại alternatives (dùng cho switch tiếp theo)
    updated_leg = target_leg.model_copy(update={
        "transport_mode": new_mode,
        "duration_minutes": alt.duration_minutes,
        "cost_sgd":         alt.cost_sgd,
        "is_estimated":     alt.is_estimated,
        "geometry":         alt.geometry,
        "geometries":       alt.geometries,
        "instructions":     alt.instructions,
        "distance_km":      alt.distance_km,
        "sub_legs":         alt.sub_legs,
    })

    # 4. Kiểm tra schedule: tính day_end_time sau khi duration thay đổi
    warnings: list[str] = []
    duration_delta = alt.duration_minutes - target_leg.duration_minutes
    if duration_delta != 0:
        place_map = {p.id: p for p in plan.places}
        for day in plan.days:
            leg_ids = {leg.id for leg in day.legs}
            if target_leg.id not in leg_ids:
                continue

            # Tính tổng thời gian ngày với leg đã cập nhật
            total_dwell = 0
            seen_places: set[str] = set()
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

            day_end = 540 + total_dwell + total_transit  # 09:00 start
            if day_end > 1050:  # 17:30
                warnings.append(
                    f"Switching to {new_mode} adds {duration_delta:+d} min — "
                    f"Day {day.day} will end around {_fmt_hhmm(day_end)}."
                )
            break

    # 5. Tính tổng cost toàn trip
    trip_cost = sum(
        (updated_leg.cost_sgd if leg.id == target_leg.id else leg.cost_sgd)
        for day in plan.days
        for leg in day.legs
    )

    return LegSwapResult(
        updated_leg=updated_leg,
        trip_cost_sgd=round(trip_cost, 2),
        warnings=warnings,
    )
```

---

## File 4 — `backend/app/routers/trips.py`

### A. Cập nhật `PATCH /{trip_id}/legs/{leg_id}`

```python
@router.patch("/{trip_id}/legs/{leg_id}")
async def update_leg(trip_id: str, leg_id: str, body: LegUpdateRequest):
    # ... tìm plan + leg như cũ ...
    old_mode = target_leg.transport_mode

    try:
        result = await planning_agent.switch_leg_mode(
            new_mode=body.transport_mode,
            target_leg=target_leg,
            plan=plan,
        )
    except NoRouteError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Budget check — router có quyền truy cập _trip_meta
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

    # Persist lên Supabase — cập nhật đầy đủ (không chỉ transport_mode nữa)
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

        supabase.table("trip_feedback").insert({
            "trip_id":       trip_id,
            "leg_id":        leg_id,
            "feedback_type": "implicit",
            "comment":       f"Mode changed: {old_mode} → {leg.transport_mode}",
        }).execute()

    return result   # LegSwapResult (không phải LegResponse nữa)
```

### B. Thêm helper `_apply_leg_update`

```python
def _apply_leg_update(plan: TripPlan, leg_id: str, updated_leg: LegResponse) -> TripPlan:
    new_days = []
    for day in plan.days:
        new_legs = [updated_leg if leg.id == leg_id else leg for leg in day.legs]
        new_days.append(day.model_copy(update={"legs": new_legs}))
    return plan.model_copy(update={"days": new_days})
```

### C. `_persist_trip_plan` — không thay đổi

Alternatives không được persist vào DB (quá lớn, có thể re-fetch khi cần). Field `alternatives` trong `LegResponse` không cần DB schema thay đổi.

---

## File 5 — Tests

### `test_services/test_onemap.py`
- Thêm test: `get_route(mode="pt", transit_modes="BUS")` gửi đúng param
- Thêm test: `transit_modes=None` không thêm param vào request

### `test_agents/test_planning_agent.py`
- `test_fetch_all_alternatives_returns_metro_walk` — mock PT + walk, assert keys
- `test_fetch_all_alternatives_bus_only_when_transit_modes_bus` — mock bus_primary="BUS"
- `test_fetch_all_alternatives_partial_failure_still_returns_available` — 1 trong 3 fails
- `test_switch_leg_mode_uses_cached_alternative` — alt trong cache, no API call
- `test_switch_leg_mode_cache_miss_fetches_on_demand` — alt không có, fetch + switch
- `test_switch_leg_mode_raises_when_mode_unavailable` — không có BUS alt, mode=BUS → NoRouteError
- `test_switch_leg_mode_schedule_warning_when_overfull` — duration delta đẩy day_end > 1050
- `test_plan_trip_populates_alternatives` — sau plan_trip, leg.alternatives có key METRO/WALK

### `test_routers/test_trips.py`
- Cập nhật PATCH test expect `LegSwapResult` shape thay vì `LegResponse`
- Thêm test: switch mode với no alternative → 422
- Thêm test: switch mode → budget warning trong response

---

## Tác động API (breaking change)

`PATCH /trips/{id}/legs/{leg_id}` thay đổi response shape:

```diff
- LegResponse { id, transport_mode, duration_minutes, ... }
+ LegSwapResult {
+   updated_leg: LegResponse,
+   trip_cost_sgd: float,
+   warnings: list[str]
+ }
```

Frontend cần cập nhật để đọc `result.updated_leg` thay vì `result` trực tiếp.

---

## Verification

```bash
cd backend

# Unit tests đơn lẻ
pytest tests/test_services/test_onemap.py -v
pytest tests/test_agents/test_planning_agent.py -v
pytest tests/test_routers/test_trips.py -v

# Full suite
pytest tests/ -v
```

Kiểm tra thủ công:
1. `POST /trips/{id}/plan` → `legs[0].alternatives` có keys METRO/BUS/WALK
2. `PATCH /trips/{id}/legs/{leg_id}` với mode có sẵn → trả `LegSwapResult` với duration mới, warnings (nếu có)
3. `PATCH` với mode không có route → 422 với message cụ thể
4. Switch METRO (3 phút) → WALK (45 phút) với plan ngắn → schedule warning
5. Restart server → GET trip → PATCH mode → on-demand fetch → switch thành công
