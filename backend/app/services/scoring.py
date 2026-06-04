"""Weighted scoring service — ranks transport mode alternatives for a leg.

All scoring is relative-within-alternatives:
  score_d(mode) = 1 - (val - min_val) / (max_val - min_val)

When all modes share the same value on a dimension → score_d = 1.0 (neutral).
"""
from app.models.trip import AlternativeRoute
from app.models.preferences import (
    UserPreferenceProfile, ContextSnapshot, ModeScore, ScoringResult,
)


# ── Dimension extractors ──────────────────────────────────────────────────────

def _walk_minutes(alt: AlternativeRoute, mode: str = "") -> int:
    """Tổng phút đi bộ cho một alternative.

    Có sub_legs  → cộng duration của tất cả WALK sub_legs.
    Không có sub_legs + mode == "WALK" → toàn bộ leg là đi bộ → trả về alt.duration_minutes.
    Không có sub_legs + mode khác → không có thông tin walking → trả về 0.

    [PATCH 1] Walk-only leg (WALK mode, no sub_legs) trả về duration_minutes thay vì 0.
    Nếu không sửa, WALK nhận walk_minutes=0 → normalize về 1.0 → luôn thắng dimension này.
    """
    if alt.sub_legs:
        return sum(sl.duration_minutes for sl in alt.sub_legs if sl.mode == "WALK")
    if mode == "WALK":
        return alt.duration_minutes   # ← FIX: walk-only leg
    return 0


def _num_transfers(alt: AlternativeRoute) -> int:
    """Số lần chuyển tuyến = (số sub_leg transit) - 1."""
    if not alt.sub_legs:
        return 0
    transit = [sl for sl in alt.sub_legs if sl.mode != "WALK"]
    return max(0, len(transit) - 1)


# ── Context weight adjuster ───────────────────────────────────────────────────

def _effective_weights(
    profile: UserPreferenceProfile,
    ctx: ContextSnapshot,
) -> tuple[float, float, float, float]:
    """Điều chỉnh weights theo context mưa / giờ cao điểm.

    Context borrow weight từ walking_w → duration_w/cost_w khi trời mưa.
    Giờ cao điểm → boost transfers_w (ít chuyển tuyến hơn).
    Profile gốc không bị thay đổi — chỉ trả về tuple mới.
    """
    dw = profile.duration_w
    cw = profile.cost_w
    ww = profile.walking_w
    tw = profile.transfers_w

    # Mưa → giảm tầm quan trọng của đi bộ
    rain = ctx.rain_level
    if rain == "heavy":
        transfer = ww * 0.60
        ww -= transfer
        dw += transfer * 0.60
        cw += transfer * 0.40
    elif rain == "light":
        transfer = ww * 0.30
        ww -= transfer
        dw += transfer * 0.50
        cw += transfer * 0.50

    # Giờ cao điểm → ít chuyển tuyến quan trọng hơn
    if ctx.is_peak_hours:
        boost = tw * 0.30
        total_other = dw + cw + 1e-9
        dw -= boost * (dw / total_other)
        cw -= boost * (cw / total_other)
        tw += boost

    # Soft constraints — borrow extra weight cho dimension liên quan
    if profile.constraints.minimize_walking:
        extra = 0.15
        tot = dw + cw + tw + 1e-9
        dw -= extra * dw / tot
        cw -= extra * cw / tot
        tw -= extra * tw / tot
        ww += extra

    if profile.constraints.minimize_fee:
        extra = 0.15
        tot = dw + ww + tw + 1e-9
        dw -= extra * dw / tot
        ww -= extra * ww / tot
        tw -= extra * tw / tot
        cw += extra

    # Re-normalize → sum = 1.0
    total = dw + cw + ww + tw
    if total <= 0:
        total = 1.0
    return dw / total, cw / total, ww / total, tw / total


# ── Core scoring ──────────────────────────────────────────────────────────────

def score_alternatives(
    alternatives: dict[str, AlternativeRoute],
    profile: UserPreferenceProfile | None = None,
    context: ContextSnapshot | None = None,
) -> ScoringResult:
    """Xếp hạng các transport mode alternatives cho một leg.

    Args:
        alternatives: dict mode → AlternativeRoute, ví dụ {"METRO": ..., "BUS": ..., "WALK": ...}
        profile:      user preference profile (default weights nếu None)
        context:      real-time context snapshot (no rain, not peak nếu None)

    Returns:
        ScoringResult với ranked list (best → worst) và recommended_mode.

    Raises:
        ValueError nếu alternatives rỗng.
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
        pool = alternatives   # fallback: không loại bỏ toàn bộ pool

    # 2. Extract raw dimensions
    # [PATCH 2] đã đảm bảo kiểu số (float/int) từ onemap.py trước khi vào đây.
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
        """Normalize: lower is better → 1.0 = best, 0.0 = worst."""
        if hi <= lo:
            return 1.0   # tất cả giống nhau → neutral
        return 1.0 - (val - lo) / (hi - lo)

    # 4. Effective weights sau context adjustment
    context_applied = ctx.rain_level != "none" or ctx.is_peak_hours
    dw, cw, ww, tw = _effective_weights(profile, ctx)

    # 5. Tính weighted score cho từng mode
    scores: list[ModeScore] = []
    for mode, d in dims.items():
        s = (
            dw * _norm(d["duration"],  min_dur,  max_dur)  +
            cw * _norm(d["cost"],      min_cost, max_cost)  +
            ww * _norm(d["walk"],      min_walk, max_walk)  +
            tw * _norm(d["transfers"], min_xfer, max_xfer)
        )
        # Soft penalty: user prefers to avoid routes with >1 transfer
        if profile.constraints.avoid_transfers and int(d["transfers"]) > 1:
            s = max(0.0, s - 0.30)
        scores.append(ModeScore(
            mode=mode,
            score=round(s, 4),
            duration_minutes=int(d["duration"]),
            cost_sgd=pool[mode].cost_sgd,
            walk_minutes=int(d["walk"]),
            num_transfers=int(d["transfers"]),
        ))

    # Sort best → worst
    scores.sort(key=lambda x: x.score, reverse=True)
    scores[0].is_recommended = True

    # 6. Reasoning string (human-readable, logged to frontend)
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
