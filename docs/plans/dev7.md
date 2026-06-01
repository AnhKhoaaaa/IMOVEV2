# dev7 — Weather Swap Correctness Fixes

## Phạm vi

Ba vấn đề nhỏ, độc lập trong `adaptation_agent.py` cần fix trước khi tiếp tục
feature lớn hơn.

---

## Bug #1 — Duplicate swap target

**File:** `adaptation_agent.py` → `_apply_weather_swap`  
**Vấn đề:** `_nearest_indoor` nhận `exclude_id: str` — chỉ loại trừ đúng địa điểm
outdoor đang được xét. Nếu hai outdoor places đều gần nhất với cùng một indoor place,
`swap_map` sẽ map cả hai sang cùng địa điểm đó → user bị xếp lịch ghé cùng nơi 2 lần.

**Fix:**
- `_nearest_indoor` đổi sang `exclude_ids: set[str]`
- `_apply_weather_swap` khởi tạo `already_used = {p.id for p in plan.places}` (tất cả
  place IDs trong plan, cả indoor lẫn outdoor)
- Mỗi khi chọn được `alt`, thêm `alt["id"]` vào `already_used` ngay lập tức trước khi
  vòng lặp tiếp tục

**Áp dụng cùng pattern** cho `poll_weather_alerts` và `check_alerts_for_trip` (các hàm
build suggestion string cũng có vòng lặp tương tự).

---

## Bug #2 — Already-in-plan place đề xuất làm swap target

**File:** `adaptation_agent.py` → `_apply_weather_swap`  
**Vấn đề:** Nếu user đã có `marina-bay-sands` (indoor) trong plan, và hệ thống cần tìm
indoor alt cho `gardens-by-the-bay`, `_nearest_indoor` vẫn có thể return MBS vì
`exclude_id` chỉ là `"gardens-by-the-bay"`.

**Fix:** Được giải quyết bởi cùng `already_used` set từ Bug #1. Khởi tạo với TẤT CẢ
`p.id for p in plan.places` — indoor places đã trong plan sẽ tự động bị loại.

---

## Haversine tính đúp trong `_nearest_indoor`

**File:** `adaptation_agent.py` → `_nearest_indoor` (lines 350–359)  
**Vấn đề:** `_haversine_km` được gọi 2 lần cho mỗi candidate — lần 1 trong list
comprehension để lọc `< 5.0`, lần 2 trong `min()` key.

**Fix:**
```python
# Tính 1 lần, lưu vào (place, dist) tuples
with_dist = [
    (p, _haversine_km(lat, lng, p["lat"], p["lng"]))
    for p in get_all_places().values()
    if not p["is_outdoor"] and p["id"] not in exclude_ids
]
in_range = [(p, d) for p, d in with_dist if d < 5.0]
if not in_range:
    return None
return min(in_range, key=lambda item: item[1])[0]
```

---

## Files cần thay đổi

| File | Thay đổi |
|------|---------|
| `backend/app/agents/adaptation_agent.py` | `_nearest_indoor` signature + body; `_apply_weather_swap` already_used tracking; `poll_weather_alerts` suggestion loop; `check_alerts_for_trip` suggestion loop |
| `backend/tests/test_agents/test_adaptation_agent.py` | Cập nhật 2 test `_nearest_indoor` call sites; thêm 2 test mới cho duplicate/already-in-plan |

---

## Verification

```bash
cd backend && pytest tests/test_agents/test_adaptation_agent.py -v
cd backend && pytest tests/ -v
```
