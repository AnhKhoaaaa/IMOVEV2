# Plan: Robust Geometry, Richer Sub-legs, và Loại bỏ Data Distortion

## Context

Ba vấn đề độc lập nhưng liên quan đang làm suy giảm chất lượng dữ liệu leg trong trip plan:

1. **Geometry bị cụt** — `_extract_pt_geometry` chỉ giữ polyline của chặng transit đầu tiên, bỏ hết các đoạn đi bộ chuyển tuyến → frontend không vẽ được đường đi hoàn chỉnh trên bản đồ.
2. **Sub-leg thiếu chiều sâu** — `PTSubLeg` không có geometry riêng và không có `intermediate_stops` → không thể hiển thị "đi qua X trạm" hay tô màu từng đoạn.
3. **Data distortion do mode override** — planning_agent.py lines 521–524 đổi nhãn `MRT→BUS` / `WALK→BUS` sau khi nhận route thật từ OneMap, tạo ra LegResponse có duration/geometry của MRT nhưng label là BUS.

Mục tiêu: tôn trọng tối đa dữ liệu OneMap trả về, làm giàu thêm các trường còn thiếu, và loại bỏ hoàn toàn logic gây biến dạng dữ liệu.

---

## Phạm vi thay đổi

### File 0 — `backend/app/models/trip.py` (khai báo enum TransportMode trước tiên)

**Định nghĩa `TransportMode` Literal — nguồn sự thật duy nhất cho toàn hệ thống**

```python
from typing import Literal

TransportMode = Literal["BUS", "METRO", "CYCLE", "WALK"]
```

Lý do chọn 4 giá trị này:
- `METRO` = tất cả phương tiện đường ray (MRT + LRT). Đối với khách du lịch Singapore, SUBWAY và TRAM đều là rail — không cần phân biệt chi tiết ở tầng leg label.
- `BUS` = xe buýt công cộng.
- `CYCLE` = xe đạp (từ OneMap cycle route).
- `WALK` = đi bộ.

**Cập nhật tất cả trường dùng transport mode:**

```python
# PTSubLeg
class PTSubLeg(BaseModel):
    mode: TransportMode    # thay str bằng TransportMode

# LegResponse
class LegResponse(BaseModel):
    transport_mode: TransportMode   # thay str

# LegUpdateRequest (user chỉ có thể chọn 4 mode thực tế)
class LegUpdateRequest(BaseModel):
    transport_mode: TransportMode   # thay Literal["MRT","LRT","BUS","WALK"] cũ
```

---

### File 1 — `backend/app/services/onemap.py`

**A. Thêm `_extract_all_geometries` — KHÔNG xóa `_extract_pt_geometry`**

```python
# HÀM MỚI — trả về list[str], không phải str
def _extract_all_geometries(legs: list[dict]) -> list[str]:
    return [
        leg["legGeometry"]["points"]
        for leg in legs
        if leg.get("legGeometry", {}).get("points")
    ]

# GIỮ NGUYÊN hàm cũ — vẫn dùng cho get_all_routes() và geometry backward compat
# def _extract_pt_geometry(legs) -> str | None  ← KHÔNG CHẠM VÀO
```

⚠️ **Quan trọng — hai trường riêng biệt, không lẫn kiểu dữ liệu:**

Trong `get_route(..., mode="pt")`, dict trả về phải có **cả hai key** tách biệt:
```python
return {
    ...
    "geometry":   _extract_pt_geometry(itin_legs),      # str | None  ← key cũ, kiểu cũ
    "geometries": _extract_all_geometries(itin_legs),   # list[str]   ← key mới, kiểu mới
    ...
}
```

Và trong `planning_agent.py` khi build `LegResponse`:
```python
LegResponse(
    ...
    geometry=route.get("geometry"),          # str | None  → khớp field cũ
    geometries=route.get("geometries", []),  # list[str]   → khớp field mới
    ...
)
```

Pydantic không bao giờ thấy `list[str]` được gán vào `geometry: str | None` vì chúng là hai key/field hoàn toàn khác nhau.

**A2. Cập nhật `_MODE_REMAP` constant**

Trong `onemap.py` hiện tại có:
```python
_MODE_REMAP = {"SUBWAY": "MRT", "TRAM": "LRT", "BUS": "BUS", "WALK": "WALK"}
```
Đổi thành map sang `TransportMode`:
```python
_MODE_REMAP: dict[str, str] = {
    "SUBWAY": "METRO",
    "TRAM":   "METRO",
    "BUS":    "BUS",
    "WALK":   "WALK",
}
```
Tương tự `_MODE_MAP` trong `planning_agent.py` (cùng dict, cùng pattern) — cập nhật giống hệt.

**B. Mở rộng `_extract_sub_legs`**

Bổ sung 2 trường vào mỗi sub_leg dict:
- `geometry: str | None` — lấy từ `leg.get("legGeometry", {}).get("points")`
- `intermediate_stops: list[dict]` — lấy từ `leg.get("intermediateStops", [])`, mỗi item map sang `{"name": stop["name"], "stop_code": stop.get("stopCode", "")}`

**C. Walk/cycle mode — không hardcode instructions rỗng**

Trong nhánh `else` của `get_route` (walk/cycle), kiểm tra `data.get("route_instructions", [])`:
```python
"instructions": data.get("route_instructions") or [],
```
Nếu OneMap không trả về key này, vẫn an toàn vì `or []` giữ nguyên behavior cũ.

**D. Haversine fallback — chỉ áp dụng cho khoảng cách ngắn**

Trong `_get_route_with_fallback` (planning_agent.py):
- Nhánh `< 1.5km → mode="walk"`: nếu OneMap trả NoRouteError → vẫn fallback haversine (hợp lý, 1km đi bộ được)
- Nhánh `≥ 1.5km → mode="pt"`: nếu OneMap trả NoRouteError → **raise thẳng lên**, không dùng haversine (WALK 10km là bất khả thi và gây hiểu nhầm)

```python
except NoRouteError:
    if mode == "walk":
        pass  # fall through to haversine estimate below
    else:
        raise  # PT route not available — don't fake a walking estimate
```

---

### File 2 — `backend/app/models/trip.py`

(File 0 đã định nghĩa `TransportMode` và cập nhật `PTSubLeg.mode`, `LegResponse.transport_mode`, `LegUpdateRequest.transport_mode`)

**Bổ sung thêm các trường mới:**

```python
class PTSubLeg(BaseModel):
    mode: TransportMode                    # đã cập nhật ở File 0
    route: str = ""
    from_name: str = ""
    to_name: str = ""
    from_stop_code: str = ""
    to_stop_code: str = ""
    duration_minutes: int = 0
    num_stops: int = 0
    geometry: str | None = None            # ← NEW
    intermediate_stops: list[dict] = []    # ← NEW: [{name, stop_code}, ...]
```

```python
class LegResponse(BaseModel):
    ...
    transport_mode: TransportMode          # đã cập nhật ở File 0
    geometry: str | None = None            # giữ nguyên — backward compat
    geometries: list[str] = []             # ← NEW: tất cả leg polylines theo thứ tự
    ...
```

`geometry` cũ giữ lại để không break frontend. `geometries` là trường mới đầy đủ.

---

### File 3 — `backend/app/agents/planning_agent.py`

**A. Xóa mode override (lines 521–524)**

Xóa hoàn toàn 4 dòng sau:
```python
# REMOVE ENTIRELY:
if prefs.get("prefer_mrt") is False and transport_mode == "MRT":
    transport_mode = "BUS"
if transport_mode == "WALK" and duration > prefs.get("max_walk_minutes", 20):
    transport_mode = "BUS"
```

**B. Truyền preference xuống `_get_route_with_fallback` khi cần**

Nếu `prefs.get("prefer_mrt") is False`, truyền param `excluded_modes=["SUBWAY"]` cho `onemap.get_route()`. Trong `onemap.get_route()`, nếu `excluded_modes` được truyền, thêm vào params:
```python
# OneMap OTP hỗ trợ bannedRoutes/transitModes — thử best-effort
if excluded_modes:
    params["transitModes"] = ",".join(
        m for m in ["BUS", "SUBWAY", "TRAM", "RAIL"] if m not in excluded_modes
    )
```
Nếu OneMap không hỗ trợ param này, nó sẽ bị ignore — kết quả vẫn đúng dữ liệu, chỉ không filter được. Không gây hại.

**C. Cập nhật build leg — truyền `geometries`**

```python
legs.append(LegResponse(
    ...
    geometry=route.get("geometry"),          # backward compat: first non-walk
    geometries=route.get("geometries", []),  # NEW: full list
    sub_legs=route.get("sub_legs", []),
))
```

---

### File 4 — Tests cần cập nhật

**`backend/tests/test_services/test_onemap.py`**
- Cập nhật mock response cho PT mode để bao gồm `intermediateStops`, `legGeometry` trên tất cả legs
- Thêm test case cho `_extract_all_geometries` trả về list
- Thêm test case cho `_extract_sub_legs` có `geometry` và `intermediate_stops`
- Thêm test case walk/cycle với `route_instructions` trong response

**`backend/tests/test_agents/test_planning_agent.py`**
- Xóa test cases kiểm tra mode override (`prefer_mrt=False → BUS`, `WALK > max → BUS`)
- Thêm test case: PT NoRouteError với khoảng cách ≥ 1.5km → raise NoRouteError (không fallback)
- Cập nhật assertion cho `sub_legs` shape mới

---

## Thứ tự thực hiện (dependency order)

```
1. models/trip.py           — TransportMode Literal + schema enrichment trước tiên
2. services/onemap.py       — _MODE_REMAP, geometry list, sub_legs, walk instructions
3. agents/planning_agent.py — _MODE_MAP, xóa override, haversine fix, truyền geometries
4. Tests                    — cập nhật mock shapes và xóa override test cases
```

---

## Verification

```bash
# Chạy từ backend/
cd backend && pytest tests/test_services/test_onemap.py -v
cd backend && pytest tests/test_agents/test_planning_agent.py -v
cd backend && pytest tests/test_routers/test_trips.py -v
cd backend && pytest tests/ -v  # full suite
```

Kiểm tra thủ công bằng cách gọi `POST /trips/{id}/plan` và quan sát:
- `legs[].geometries` là array có N phần tử (N = số OTP legs bao gồm cả WALK)
- `legs[].sub_legs[].intermediate_stops` không rỗng với MRT legs
- `legs[].sub_legs[].geometry` có giá trị cho mỗi sub_leg
- Không có trường hợp `transport_mode=BUS` nhưng geometry là đường tàu điện ngầm
