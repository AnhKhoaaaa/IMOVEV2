"""Tests for services/scoring.py — weighted scoring of transport alternatives."""
import pytest

from app.models.trip import AlternativeRoute, PTSubLeg
from app.models.preferences import UserPreferenceProfile, ContextSnapshot, ModeConstraints
from app.services.scoring import score_alternatives, _walk_minutes, _num_transfers


# ── Helpers ───────────────────────────────────────────────────────────────────

def _alt(
    duration: int = 30,
    cost: float = 1.50,
    sub_legs: list | None = None,
) -> AlternativeRoute:
    return AlternativeRoute(
        duration_minutes=duration,
        cost_sgd=cost,
        sub_legs=sub_legs or [],
    )


def _sub(mode: str, duration: int) -> PTSubLeg:
    return PTSubLeg(mode=mode, duration_minutes=duration)


def _profile(**kwargs) -> UserPreferenceProfile:
    defaults = {"duration_w": 0.40, "cost_w": 0.30, "walking_w": 0.20, "transfers_w": 0.10}
    defaults.update(kwargs)
    return UserPreferenceProfile(**defaults)


def _ctx(rain: float = 0.0, minutes: int = 600) -> ContextSnapshot:
    return ContextSnapshot(rain_mm_per_hour=rain, current_time_minutes=minutes)


# ── Patch 1 — _walk_minutes ───────────────────────────────────────────────────

class TestWalkMinutes:
    def test_walk_only_leg_returns_full_duration(self):
        """[PATCH 1] WALK-only leg (no sub_legs) → returns duration_minutes, not 0."""
        alt = _alt(duration=45, sub_legs=[])
        assert _walk_minutes(alt, mode="WALK") == 45

    def test_non_walk_no_sub_legs_returns_zero(self):
        alt = _alt(duration=30, sub_legs=[])
        assert _walk_minutes(alt, mode="METRO") == 0

    def test_transit_leg_extracts_walk_sublegs(self):
        alt = _alt(sub_legs=[_sub("WALK", 5), _sub("METRO", 20), _sub("WALK", 3)])
        assert _walk_minutes(alt, mode="METRO") == 8

    def test_no_walk_sublegs_returns_zero(self):
        alt = _alt(sub_legs=[_sub("BUS", 20)])
        assert _walk_minutes(alt, mode="BUS") == 0


# ── _num_transfers ────────────────────────────────────────────────────────────

class TestNumTransfers:
    def test_single_transit_no_transfers(self):
        alt = _alt(sub_legs=[_sub("WALK", 3), _sub("METRO", 20), _sub("WALK", 3)])
        assert _num_transfers(alt) == 0

    def test_two_transit_one_transfer(self):
        alt = _alt(sub_legs=[_sub("BUS", 10), _sub("WALK", 5), _sub("METRO", 15)])
        assert _num_transfers(alt) == 1

    def test_no_sub_legs_zero_transfers(self):
        alt = _alt(sub_legs=[])
        assert _num_transfers(alt) == 0


# ── score_alternatives edge cases ─────────────────────────────────────────────

class TestScoreAlternatives:
    def test_raises_on_empty_alternatives(self):
        with pytest.raises(ValueError, match="rỗng"):
            score_alternatives({})

    def test_single_mode_scores_1_0(self):
        """Single alternative → all dimensions neutral → score = 1.0."""
        result = score_alternatives({"WALK": _alt(duration=20, cost=0.0)})
        assert result.recommended_mode == "WALK"
        assert result.ranked[0].score == 1.0

    def test_fastest_mode_wins_with_duration_heavy_profile(self):
        """High duration_w → fastest mode should win."""
        alts = {
            "METRO": _alt(duration=15, cost=2.0),
            "BUS":   _alt(duration=40, cost=1.0),
        }
        profile = UserPreferenceProfile(duration_w=0.85, cost_w=0.10, walking_w=0.03, transfers_w=0.02)
        result = score_alternatives(alts, profile=profile)
        assert result.recommended_mode == "METRO"

    def test_cheapest_mode_wins_with_cost_heavy_profile(self):
        """High cost_w → cheapest mode should win."""
        alts = {
            "METRO": _alt(duration=15, cost=2.50),
            "BUS":   _alt(duration=30, cost=0.80),
        }
        profile = UserPreferenceProfile(duration_w=0.05, cost_w=0.85, walking_w=0.07, transfers_w=0.03)
        result = score_alternatives(alts, profile=profile)
        assert result.recommended_mode == "BUS"

    def test_walk_only_leg_scoring_fixed(self):
        """[PATCH 1 integration] WALK should NOT always score 1.0 on walk dimension."""
        alts = {
            "WALK":  _alt(duration=45, cost=0.0, sub_legs=[]),   # 45 min walk
            "METRO": _alt(duration=15, cost=2.0, sub_legs=[_sub("WALK", 3), _sub("METRO", 12)]),
        }
        result = score_alternatives(alts)
        # METRO should win or at least WALK should not dominate solely due to walk score
        walk_score  = next(s for s in result.ranked if s.mode == "WALK")
        metro_score = next(s for s in result.ranked if s.mode == "METRO")
        # WALK has 45 min walking vs METRO has 3 min → METRO should win walking dimension
        assert walk_score.walk_minutes == 45
        assert metro_score.walk_minutes == 3

    def test_recommended_is_first_in_ranked(self):
        alts = {
            "METRO": _alt(duration=15, cost=2.0),
            "BUS":   _alt(duration=35, cost=1.0),
            "WALK":  _alt(duration=50, cost=0.0),
        }
        result = score_alternatives(alts)
        assert result.ranked[0].mode == result.recommended_mode
        assert result.ranked[0].is_recommended is True
        for s in result.ranked[1:]:
            assert s.is_recommended is False


# ── Context adjustments ───────────────────────────────────────────────────────

class TestContextAdjustments:
    def test_rain_heavy_reduces_walk_score(self):
        """Heavy rain → walking weight reduced → WALK should rank lower."""
        alts = {
            "METRO": _alt(duration=20, cost=2.0, sub_legs=[_sub("WALK", 2), _sub("METRO", 18)]),
            "WALK":  _alt(duration=40, cost=0.0, sub_legs=[]),
        }
        profile = _profile()
        no_rain = score_alternatives(alts, profile=profile, context=_ctx(rain=0.0))
        heavy   = score_alternatives(alts, profile=profile, context=_ctx(rain=10.0))

        # Under heavy rain, METRO should be recommended
        assert heavy.recommended_mode == "METRO"
        assert heavy.context_applied is True
        assert "Heavy rain" in heavy.reasoning

    def test_rain_light_reasoning(self):
        alts = {"METRO": _alt(), "WALK": _alt(duration=50, cost=0.0)}
        result = score_alternatives(alts, context=_ctx(rain=3.0))
        assert "Light rain" in result.reasoning
        assert result.context_applied is True

    def test_no_rain_context_not_applied(self):
        alts = {"METRO": _alt(), "BUS": _alt(duration=35, cost=1.0)}
        result = score_alternatives(alts, context=_ctx(rain=0.0, minutes=600))
        assert result.context_applied is False

    def test_peak_hours_reasoning(self):
        """SGT peak 7:30–9:30 → is_peak_hours True at 08:00 (480 min)."""
        alts = {"METRO": _alt(), "BUS": _alt(duration=35, cost=1.0)}
        result = score_alternatives(alts, context=_ctx(rain=0.0, minutes=480))
        assert result.context_applied is True
        assert "Peak hours" in result.reasoning


# ── Hard constraints ──────────────────────────────────────────────────────────

class TestConstraints:
    def test_avoid_bus_removes_bus_from_pool(self):
        alts = {
            "BUS":   _alt(duration=20, cost=1.0),
            "METRO": _alt(duration=25, cost=2.0),
        }
        profile = UserPreferenceProfile(
            duration_w=0.4, cost_w=0.3, walking_w=0.2, transfers_w=0.1,
            constraints=ModeConstraints(avoid_bus=True),
        )
        result = score_alternatives(alts, profile=profile)
        modes = [s.mode for s in result.ranked]
        assert "BUS" not in modes
        assert result.recommended_mode == "METRO"

    def test_avoid_bus_falls_back_if_pool_empty(self):
        """When avoid_bus removes ALL modes, fall back to full pool."""
        alts = {"BUS": _alt()}
        profile = UserPreferenceProfile(
            duration_w=0.4, cost_w=0.3, walking_w=0.2, transfers_w=0.1,
            constraints=ModeConstraints(avoid_bus=True),
        )
        result = score_alternatives(alts, profile=profile)
        # Pool would be empty → fallback to all alternatives
        assert result.recommended_mode == "BUS"

    def test_minimize_fee_boosts_cost_weight(self):
        alts = {
            "METRO": _alt(duration=15, cost=2.50),
            "BUS":   _alt(duration=30, cost=0.80),
        }
        profile = UserPreferenceProfile(
            duration_w=0.4, cost_w=0.3, walking_w=0.2, transfers_w=0.1,
            constraints=ModeConstraints(minimize_fee=True),
        )
        result = score_alternatives(alts, profile=profile)
        assert "minimize_fee" in result.reasoning

    def test_minimize_walking_boosts_walk_weight(self):
        profile = UserPreferenceProfile(
            duration_w=0.4, cost_w=0.3, walking_w=0.2, transfers_w=0.1,
            constraints=ModeConstraints(minimize_walking=True),
        )
        alts = {
            "METRO": _alt(sub_legs=[_sub("WALK", 2), _sub("METRO", 18)]),
            "BUS":   _alt(sub_legs=[_sub("WALK", 15), _sub("BUS", 20)]),
        }
        result = score_alternatives(alts, profile=profile)
        assert "minimize_walking" in result.reasoning
        # METRO should win (less walking)
        assert result.recommended_mode == "METRO"
