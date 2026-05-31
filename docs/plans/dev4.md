# Plan: Weighted Scoring & User Preferences Integration

## Context

Thay thế logic chọn `transport_mode` dựa trên threshold khoảng cách cứng (< 1.5km → WALK)  
bằng hệ thống tính điểm có trọng số theo sở thích người dùng, context thời gian thực (mưa,  
giờ cao điểm) và dữ liệu thực từ OneMap alternatives.

Trước khi integrate, 3 edge case sau phải được vá — chúng sẽ gây silent bug trong hàm  
`score_alternatives()` nếu không sửa trước.

---

## Prerequisite — dev2 + dev3 đã hoàn thành ✅

`AlternativeRoute`, `LegResponse.alternatives`, `switch_leg_mode`, `switch_leg_mode_live`  
đều đã có. dev4 dùng lại hoàn toàn các building block đó.

---

## Phần A — Ba Edge Case Patches (phải sửa TRƯỚC khi tạo scoring.py)

### Patch 1 — `_walk_minutes` trong `services/scoring.py`

**Vấn đề:**  
Leg thuần đi bộ (WALK mode, không có sub_legs) trả về `0` phút đi bộ thay vì  
`alt.duration_minutes`. Hậu quả: WALK bị hiểu là "ít đi bộ nhất" → điểm walking = 1.0  
→ WALK luôn thắng dimension này dù người dùng đang thực sự phải đi bộ rất xa.

**Hàm hiện tại (sai):**
```python
def _walk_minutes(alt: AlternativeRoute) -> int:
    if alt.sub_legs:
        return sum(sl.duration_minutes for sl in alt.sub_legs if sl.mode == "WALK")
    return 0   # ← BUG: walk-only leg with no sub_legs
```

**Hàm đã sửa:**
```python
def _walk_minutes(alt: AlternativeRoute, mode: str = "") -> int:
    """Tổng phút đi bộ cho một alternative.

    Có sub_legs → cộng duration của tất cả WALK sub_legs.
    Không có sub_legs + mode là WALK → toàn bộ leg là đi bộ → trả về alt.duration_minutes.
    Không có sub_legs + mode khác → không có thông tin walking → trả về 0.
    """
    if alt.sub_legs:
        return sum(sl.duration_minutes for sl in alt.sub_legs if sl.mode == "WALK")
    if mode == "WALK":
        return alt.duration_minutes   # ← FIX: walk-only leg
    return 0
```

**Nơi gọi — cập nhật call site trong `score_alternatives()`:**
```python
# Trước
"walk": float(_walk_minutes(alt)),

# Sau
"walk": float(_walk_minutes(alt, mode=mode)),
```

---

### Patch 2 — Ép kiểu tường minh trong `services/onemap.py`

**Vấn đề:**  
OneMap API đôi khi trả về các trường số dưới dạng string JSON  
(ví dụ: `"total_time": "900"` thay vì `"total_time": 900`).  
Khi tính `min()` / `max()` trong `score_alternatives()`, Python sẽ so sánh  
string thay vì số → kết quả sắp xếp sai hoàn toàn (`"9" > "12"` vì so sánh lexicographic).

**Điểm sửa trong `get_route()` — nhánh walk/cycle (else branch):**
```python
# Trước
summary = data.get("route_summary", {})
return {
    "duration_minutes": round(summary["total_time"] / 60),
    ...
    "distance_km": round(summary.get("total_distance", 0) / 1000, 2),
}

# Sau — ép kiểu tường minh float() trước khi tính toán
summary = data.get("route_summary", {})
total_time     = float(summary.get("total_time", 0) or 0)
total_distance = float(summary.get("total_distance", 0) or 0)
return {
    "duration_minutes": int(round(total_time / 60)),
    "fare_sgd":         0.0,
    ...
    "distance_km": round(total_distance / 1000, 2),
}
```

**Điểm sửa trong `get_route()` — nhánh PT:**
```python
# Trước
total_distance_m = sum(leg.get("distance", 0) for leg in itin_legs)
...
"duration_minutes": round(itin["duration"] / 60),

# Sau
total_distance_m = sum(float(leg.get("distance", 0) or 0) for leg in itin_legs)
...
"duration_minutes": int(round(float(itin.get("duration", 0)) / 60)),
```

**Điểm sửa trong `_extract_sub_legs()`:**
```python
# Trước
"duration_minutes": round(leg.get("duration", 0) / 60),
"num_stops":        leg.get("numStops", 0),

# Sau
"duration_minutes": int(round(float(leg.get("duration", 0) or 0) / 60)),
"num_stops":        int(leg.get("numStops") or 0),
```

---

### Patch 3 — Fallback `UserPreferenceProfile()` mặc định trong `routers/trips.py`

**Vấn đề:**  
Khi user mới chưa từng lưu preference (hoặc đang dùng guest mode), truy vấn  
`user_preferences` trả về `[]`. Nếu không có fallback, `profile` là `None`  
và `planning_agent.plan_trip()` sẽ nhận `None` thay vì object hợp lệ → crash.

**Logic cần thêm vào handler `plan_trip` trong `routers/trips.py`:**
```python
from app.models.preferences import UserPreferenceProfile

# Bên trong async def plan_trip(trip_id, body, current_user=Depends(...)):
#   ... (sau khi lấy num_days, budget_sgd) ...

# Fetch preference profile — fallback tới default nếu user mới / guest
profile: UserPreferenceProfile = UserPreferenceProfile()   # safe default
if current_user and supabase:
    try:
        pref_resp = (
            supabase.table("user_preferences")
            .select("profile")
            .eq("user_id", current_user)
            .limit(1)
            .execute()
        )
        if pref_resp.data:
            profile = UserPreferenceProfile(**pref_resp.data[0]["profile"])
    except Exception as exc:
        # Non-fatal: log và dùng default
        log.warning("Could not fetch preferences for user %s: %s", current_user, exc)
```

**Rule:** Supabase failure KHÔNG được block planning. `profile` luôn có giá trị hợp lệ  
trước khi gọi agent.

---

## Phần B — Thứ tự triển khai đầy đủ

```
1. models/preferences.py          — Pydantic schemas (UserPreferenceProfile, ContextSnapshot, ...)
2. services/scoring.py             — score_alternatives() với Patch 1 đã fix
3. services/onemap.py              — Patch 2 type coercion
4. agents/planning_agent.py        — Nhận profile, gọi score_alternatives thay vì distance rule
5. routers/trips.py                — Patch 3 + truyền profile vào plan_trip agent call
6. routers/preferences.py          — GET / PUT /users/me/preferences endpoint
7. app/main.py                     — Register preferences router
8. Tests
```

---

## File 1 — `backend/app/models/preferences.py` (tạo mới)

```python
from __future__ import annotations
from pydantic import BaseModel, Field, model_validator
from typing import Literal
import zoneinfo


class ModeConstraints(BaseModel):
    avoid_bus:        bool = False
    avoid_metro:      bool = False
    minimize_walking: bool = False   # boost walking_w +0.15 khi tính điểm
    minimize_fee:     bool = False   # boost cost_w    +0.15 khi tính điểm


class UserPreferenceProfile(BaseModel):
    """Profile lưu vào Supabase user_preferences.profile (JSONB).
    Weights phải sum = 1.0 (±0.01 tolerance). Default: ưu tiên nhanh nhất.
    """
    duration_w:  float = Field(default=0.40, ge=0.0, le=1.0)
    cost_w:      float = Field(default=0.30, ge=0.0, le=1.0)
    walking_w:   float = Field(default=0.20, ge=0.0, le=1.0)
    transfers_w: float = Field(default=0.10, ge=0.0, le=1.0)
    constraints: ModeConstraints = Field(default_factory=ModeConstraints)

    @model_validator(mode="after")
    def weights_must_sum_to_one(self) -> "UserPreferenceProfile":
        total = self.duration_w + self.cost_w + self.walking_w + self.transfers_w
        if abs(total - 1.0) > 0.01:
            raise ValueError(f"Weights must sum to 1.0, got {total:.4f}")
        return self

    def renormalized(self) -> "UserPreferenceProfile":
        """Trả về bản copy với weights re-normalize về sum = 1.0 chính xác."""
        total = self.duration_w + self.cost_w + self.walking_w + self.transfers_w
        if total == 0:
            return UserPreferenceProfile()
        return self.model_copy(update={
            "duration_w":  round(self.duration_w  / total, 4),
            "cost_w":      round(self.cost_w      / total, 4),
            "walking_w":   round(self.walking_w   / total, 4),
            "transfers_w": round(self.transfers_w / total, 4),
        })


_SGT = zoneinfo.ZoneInfo("Asia/Singapore")


class ContextSnapshot(BaseModel):
    """Context thực tế tại thời điểm recommend. KHÔNG lưu DB."""
    rain_mm_per_hour:      float = Field(default=0.0, ge=0.0)
    current_time_minutes:  int   = Field(default=0, ge=0, le=1439)

    @property
    def is_peak_hours(self) -> bool:
        """Singapore MRT peak: 7:30–9:30 và 17:00–20:00 SGT."""
        t = self.current_time_minutes
        return (450 <= t <= 570) or (1020 <= t <= 1200)

    @property
    def rain_level(self) -> Literal["none", "light", "heavy"]:
        if self.rain_mm_per_hour >= 7.5:
            return "heavy"
        if self.rain_mm_per_hour >= 2.5:
            return "light"
        return "none"

    @classmethod
    def now(cls, rain_mm: float = 0.0) -> "ContextSnapshot":
        """Factory: tạo ContextSnapshot với thời gian SGT hiện tại."""
        from datetime import datetime
        now_sgt = datetime.now(_SGT)
        return cls(
            rain_mm_per_hour=rain_mm,
            current_time_minutes=now_sgt.hour * 60 + now_sgt.minute,
        )


class ModeScore(BaseModel):
    mode:             str
    score:            float
    duration_minutes: int
    cost_sgd:         float
    walk_minutes:     int
    num_transfers:    int
    is_recommended:   bool = False


class ScoringResult(BaseModel):
    ranked:           list[ModeScore]
    recommended_mode: str
    context_applied:  bool  = False
    reasoning:        str   = ""
```

---

## File 2 — `backend/app/services/scoring.py` (tạo mới)

```python
from app.models.trip import AlternativeRoute
from app.models.preferences import (
    UserPreferenceProfile, ContextSnapshot, ModeScore, ScoringResult,
)


# ── Dimension extractors ─────────────────────────────────────────────────────

def _walk_minutes(alt: AlternativeRoute, mode: str = "") -> int:
    # [PATCH 1] Walk-only leg không có sub_legs → trả về toàn bộ duration
    if alt.sub_legs:
        return sum(sl.duration_minutes for sl in alt.sub_legs if sl.mode == "WALK")
    if mode == "WALK":
        return alt.duration_minutes
    return 0


def _num_transfers(alt: AlternativeRoute) -> int:
    if not alt.sub_legs:
        return 0
    transit = [sl for sl in alt.sub_legs if sl.mode != "WALK"]
    return max(0, len(transit) - 1)


# ── Context weight adjuster ──────────────────────────────────────────────────

def _effective_weights(
    profile: UserPreferenceProfile,
    ctx: ContextSnapshot,
) -> tuple[float, float, float, float]:
    """Điều chỉnh weights theo context mưa / giờ cao điểm.
    Context borrow weight từ walking_w sang duration_w/cost_w khi trời mưa.
    Profile gốc không thay đổi.
    """
    dw, cw, ww, tw = (
        profile.duration_w, profile.cost_w,
        profile.walking_w,  profile.transfers_w,
    )

    rain = ctx.rain_level
    if rain == "heavy":
        transfer = ww * 0.60
        ww -= transfer; dw += transfer * 0.60; cw += transfer * 0.40
    elif rain == "light":
        transfer = ww * 0.30
        ww -= transfer; dw += transfer * 0.50; cw += transfer * 0.50

    if ctx.is_peak_hours:
        # Giờ cao điểm: ưu tiên ít chuyển tuyến — boost tw
        boost = tw * 0.30
        total_other = dw + cw + 1e-9
        dw -= boost * (dw / total_other)
        cw -= boost * (cw / total_other)
        tw += boost

    # minimize_* constraints — borrow extra weight cho dimension đó
    if profile.constraints.minimize_walking:
        extra = 0.15
        tot = dw + cw + tw + 1e-9
        dw -= extra * dw / tot; cw -= extra * cw / tot; tw -= extra * tw / tot
        ww += extra

    if profile.constraints.minimize_fee:
        extra = 0.15
        tot = dw + ww + tw + 1e-9
        dw -= extra * dw / tot; ww -= extra * ww / tot; tw -= extra * tw / tot
        cw += extra

    # Re-normalize → sum = 1.0
    total = dw + cw + ww + tw
    if total <= 0:
        total = 1.0
    return dw / total, cw / total, ww / total, tw / total


# ── Core scoring ─────────────────────────────────────────────────────────────

def score_alternatives(
    alternatives: dict[str, AlternativeRoute],
    profile: UserPreferenceProfile | None = None,
    context: ContextSnapshot | None = None,
) -> ScoringResult:
    """Xếp hạng các transport mode alternatives cho một leg.

    Normalize relative-within-alternatives:
      score_d(mode) = 1 - (val - min_val) / (max_val - min_val)
    Khi tất cả modes có cùng giá trị trên một dimension → score_d = 1.0 (neutral).
    """
    if not alternatives:
        raise ValueError("alternatives không được rỗng")

    profile = profile or UserPreferenceProfile()
    ctx     = context or ContextSnapshot()

    # 1. Lọc hard constraints
    pool = {
        mode: alt for mode, alt in alternatives.items()
        if not (mode == "BUS"   and profile.constraints.avoid_bus)
        if not (mode == "METRO" and profile.constraints.avoid_metro)
    }
    if not pool:
        pool = alternatives   # fallback: không loại bỏ nếu pool rỗng

    # 2. Extract raw dimensions — [PATCH 2] đã đảm bảo kiểu số từ onemap.py
    dims: dict[str, dict[str, float]] = {
        mode: {
            "duration":  float(alt.duration_minutes),
            "cost":      float(alt.cost_sgd),
            "walk":      float(_walk_minutes(alt, mode=mode)),   # [PATCH 1]
            "transfers": float(_num_transfers(alt)),
        }
        for mode, alt in pool.items()
    }

    # 3. Min/max per dimension
    def _mm(key: str) -> tuple[float, float]:
        vals = [d[key] for d in dims.values()]
        return min(vals), max(vals)

    min_dur,  max_dur  = _mm("duration")
    min_cost, max_cost = _mm("cost")
    min_walk, max_walk = _mm("walk")
    min_xfer, max_xfer = _mm("transfers")

    def _norm(val: float, lo: float, hi: float) -> float:
        if hi <= lo:
            return 1.0
        return 1.0 - (val - lo) / (hi - lo)

    # 4. Effective weights sau context adjustment
    context_applied = ctx.rain_level != "none" or ctx.is_peak_hours
    dw, cw, ww, tw  = _effective_weights(profile, ctx)

    # 5. Tính score
    scores: list[ModeScore] = []
    for mode, d in dims.items():
        s = (
            dw * _norm(d["duration"],  min_dur,  max_dur)  +
            cw * _norm(d["cost"],      min_cost, max_cost)  +
            ww * _norm(d["walk"],      min_walk, max_walk)  +
            tw * _norm(d["transfers"], min_xfer, max_xfer)
        )
        scores.append(ModeScore(
            mode=mode,
            score=round(s, 4),
            duration_minutes=int(d["duration"]),
            cost_sgd=pool[mode].cost_sgd,
            walk_minutes=int(d["walk"]),
            num_transfers=int(d["transfers"]),
        ))

    scores.sort(key=lambda x: x.score, reverse=True)
    scores[0].is_recommended = True

    # 6. Reasoning string
    parts: list[str] = []
    if ctx.rain_level == "heavy":
        parts.append(f"Heavy rain ({ctx.rain_mm_per_hour:.1f}mm/h): walking weight -60%")
    elif ctx.rain_level == "light":
        parts.append(f"Light rain ({ctx.rain_mm_per_hour:.1f}mm/h): walking weight -30%")
    if ctx.is_peak_hours:
        parts.append("Peak hours: transfer penalty applied")
    if profile.constraints.minimize_walking:
        parts.append("minimize_walking: walking_w boosted +0.15")
    if profile.constraints.minimize_fee:
        parts.append("minimize_fee: cost_w boosted +0.15")

    return ScoringResult(
        ranked=scores,
        recommended_mode=scores[0].mode,
        context_applied=context_applied,
        reasoning="; ".join(parts) or "Default weighted score",
    )
```

---

## File 3 — `backend/app/services/onemap.py` (sửa, chỉ 3 chỗ)

### Chỗ 1 — `_extract_sub_legs()`
```python
# Trước
"duration_minutes": round(leg.get("duration", 0) / 60),
"num_stops":        leg.get("numStops", 0),

# Sau
"duration_minutes": int(round(float(leg.get("duration", 0) or 0) / 60)),
"num_stops":        int(leg.get("numStops") or 0),
```

### Chỗ 2 — `get_route()` nhánh PT
```python
# Trước
total_distance_m = sum(leg.get("distance", 0) for leg in itin_legs)
...
"duration_minutes": round(itin["duration"] / 60),

# Sau
total_distance_m = sum(float(leg.get("distance", 0) or 0) for leg in itin_legs)
...
"duration_minutes": int(round(float(itin.get("duration", 0)) / 60)),
```

### Chỗ 3 — `get_route()` nhánh walk/cycle (else)
```python
# Trước
return {
    "duration_minutes": round(summary["total_time"] / 60),
    ...
    "distance_km": round(summary.get("total_distance", 0) / 1000, 2),
}

# Sau
total_time     = float(summary.get("total_time",     0) or 0)
total_distance = float(summary.get("total_distance", 0) or 0)
return {
    "duration_minutes": int(round(total_time / 60)),
    ...
    "distance_km": round(total_distance / 1000, 2),
}
```

---

## File 4 — `backend/app/agents/planning_agent.py` (sửa)

### A. Cập nhật import
```python
from app.models.preferences import UserPreferenceProfile, ContextSnapshot
from app.services.scoring import score_alternatives
```

### B. Thêm `profile` và `context` vào signature `plan_trip()`
```python
async def plan_trip(
    trip_id: str,
    place_ids: list[str],
    num_days: int,
    budget_sgd: float,
    optimize_order: bool,
    preferences: dict | None,
    profile: UserPreferenceProfile | None = None,      # ← mới
    context: ContextSnapshot | None = None,            # ← mới
) -> TripPlan:
    effective_profile = profile or UserPreferenceProfile()
    effective_ctx     = context or ContextSnapshot.now()
    ...
```

### C. Thay thế distance-based `best_key` selection bằng `score_alternatives()`

**Trước (lines ~545–554 trong plan_trip):**
```python
if dist_km < 1.5:
    best_key = "WALK" if "WALK" in alts else next(iter(alts))
else:
    best_key = next((m for m in ("METRO", "BUS") if m in alts), None)
    if best_key is None:
        raise NoRouteError(...)
```

**Sau:**
```python
if not alts:
    raise NoRouteError(...)

scoring = score_alternatives(alts, profile=effective_profile, context=effective_ctx)
best_key = scoring.recommended_mode

# Guard: với long-distance, WALK không được là best nếu PT có sẵn
if dist_km >= 1.5 and best_key == "WALK":
    pt_key = next((m for m in ("METRO", "BUS") if m in alts), None)
    if pt_key:
        best_key = pt_key   # override: đi bộ >1.5km không thực tế
```

> **Lý do giữ guard distance:** scoring có thể chọn WALK nếu cost_w cao và đoạn đường 
> vừa phải. Nhưng WALK 5km trong trời Singapore 35°C là bất khả thi dù score cao.
> Guard này là safety net, không phải business logic.

---

## File 5 — `backend/app/routers/trips.py` (sửa)

### A. Cập nhật import
```python
from app.models.preferences import UserPreferenceProfile, ContextSnapshot
```

### B. Thêm logic fetch preferences trong handler `plan_trip()`
Thêm đoạn sau khi có `num_days` và `budget_sgd`, trước khi gọi agent:

```python
# [PATCH 3] Fetch user preference profile — fallback to default nếu guest/new user
effective_profile = UserPreferenceProfile()
if current_user and supabase:
    try:
        pref_resp = (
            supabase.table("user_preferences")
            .select("profile")
            .eq("user_id", current_user)
            .limit(1)
            .execute()
        )
        if pref_resp.data:
            effective_profile = UserPreferenceProfile(**pref_resp.data[0]["profile"])
    except Exception as exc:
        log.warning("Preferences fetch failed for %s (using defaults): %s", current_user, exc)

# Build context: thời gian thực — weather fetch là optional (không block nếu fail)
rain_mm = 0.0
if supabase:   # chỉ fetch weather nếu DB sẵn sàng (service đang up)
    try:
        from app.services import openweather
        weather = await openweather.get_current_weather()
        rain_mm = weather.get("rain_1h", 0.0)
    except Exception:
        pass   # non-fatal
effective_ctx = ContextSnapshot.now(rain_mm=rain_mm)
```

### C. Truyền xuống agent
```python
result = await planning_agent.plan_trip(
    trip_id=trip_id,
    place_ids=body.place_ids,
    num_days=num_days,
    budget_sgd=budget_sgd,
    optimize_order=body.optimize_order,
    preferences=body.preferences,
    profile=effective_profile,   # ← mới
    context=effective_ctx,       # ← mới
)
```

---

## File 6 — `backend/app/routers/preferences.py` (tạo mới)

```python
import logging
from fastapi import APIRouter, Depends, HTTPException
from app.dependencies import get_current_user
from app.models.preferences import UserPreferenceProfile
from app.database import supabase

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/me/preferences")
async def get_preferences(current_user: str = Depends(get_current_user)):
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if supabase:
        resp = (
            supabase.table("user_preferences")
            .select("profile, updated_at")
            .eq("user_id", current_user)
            .limit(1)
            .execute()
        )
        if resp.data:
            return UserPreferenceProfile(**resp.data[0]["profile"])
    return UserPreferenceProfile()   # default nếu chưa có record


@router.put("/me/preferences")
async def update_preferences(
    body: UserPreferenceProfile,
    current_user: str = Depends(get_current_user),
):
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Normalize weights trước khi lưu để đảm bảo DB check constraint pass
    normalized = body.renormalized()
    profile_dict = {
        "duration_w":  normalized.duration_w,
        "cost_w":      normalized.cost_w,
        "walking_w":   normalized.walking_w,
        "transfers_w": normalized.transfers_w,
        "constraints": normalized.constraints.model_dump(),
    }
    supabase.table("user_preferences").upsert({
        "user_id": current_user,
        "profile": profile_dict,
    }).execute()
    return normalized
```

---

## File 7 — `backend/app/main.py` (sửa)

```python
from app.routers import health, places, trips, alerts, transit, preferences   # thêm preferences

app.include_router(preferences.router, prefix="/users")
# → GET  /users/me/preferences
# → PUT  /users/me/preferences
```

---

## File 8 — Tests

### `tests/test_services/test_scoring.py` (tạo mới)
```
test_walk_only_leg_returns_full_duration        — Patch 1: mode=WALK, no sub_legs
test_transit_leg_extracts_walk_sublegs          — normal case
test_single_mode_scores_1_0                    — all dimensions neutral → 1.0
test_fastest_mode_wins_with_duration_heavy_profile
test_cheapest_mode_wins_with_cost_heavy_profile
test_rain_heavy_reduces_walk_score
test_rain_light_partially_reduces_walk_score
test_peak_hours_boosts_transfer_penalty
test_avoid_bus_removes_bus_from_pool
test_avoid_bus_falls_back_if_pool_empty
test_minimize_fee_boosts_cost_weight
test_minimize_walking_boosts_walk_weight
test_score_raises_on_empty_alternatives
```

### `tests/test_services/test_onemap.py` (thêm vào)
```
test_get_route_walk_with_string_total_time      — Patch 2: "900" → int 15
test_get_route_pt_with_string_distance         — Patch 2: "5000" → float
test_extract_sub_legs_string_duration          — Patch 2: sub_leg duration coercion
```

### `tests/test_routers/test_trips.py` (thêm vào)
```
test_plan_trip_uses_default_profile_for_guest  — Patch 3: no current_user → default
test_plan_trip_uses_default_when_no_pref_record — Patch 3: supabase returns []
test_plan_trip_uses_profile_when_found         — happy path
```

---

## Thứ tự thực hiện

```
Step 1  models/preferences.py          — dependency cho mọi bước còn lại
Step 2  services/scoring.py            — Patch 1 đã embedded
Step 3  services/onemap.py             — Patch 2 (3 chỗ sửa nhỏ)
Step 4  agents/planning_agent.py       — integrate score_alternatives
Step 5  routers/trips.py               — Patch 3 + truyền profile/context
Step 6  routers/preferences.py         — endpoint GET/PUT
Step 7  main.py                        — register router
Step 8  Tests                          — test_scoring.py + bổ sung onemap + trips
```

---

## Verification

```bash
cd backend

# Unit test hàm scoring (coverage các edge cases)
pytest tests/test_services/test_scoring.py -v

# Regression: đảm bảo plan_trip vẫn chạy đúng
pytest tests/test_agents/test_planning_agent.py -v

# Router tests bao gồm preference fallback
pytest tests/test_routers/test_trips.py -v

# Full suite
pytest tests/ -v
```

Kiểm tra thủ công sau deploy:
1. `PUT /users/me/preferences` với weights không sum = 1.0 → 422 từ Pydantic
2. `PUT /users/me/preferences` với `avoid_bus=true` → `GET /trips/{id}/plan` → không có BUS leg nào được recommend
3. Mưa > 7.5mm → `reasoning` trong LegResponse chứa "Heavy rain"
4. User mới (chưa có preferences) → plan_trip chạy bình thường với default weights
