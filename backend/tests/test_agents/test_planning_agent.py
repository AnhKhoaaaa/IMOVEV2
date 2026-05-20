import pytest
from unittest.mock import AsyncMock, patch

from app.agents.planning_agent import (
    plan_trip,
    _sort_places_greedy,
    _distribute_days,
    _haversine_km,
    _time_slot,
    _PLACES,
)
from app.exceptions import PlaceDataMissingError, BudgetExceededError
from app.services.onemap import NoRouteError


# ── helpers ──────────────────────────────────────────────────────────────────

def _mock_route(duration=15, fare=1.80, mode="MRT"):
    return {
        "duration_minutes": duration,
        "fare_sgd": fare,
        "legs": [{"mode": "WALK"}, {"mode": mode}],
    }


VALID_IDS = list(_PLACES.keys())[:3]  # use first 3 real places from dataset


# ── unit tests: helpers ───────────────────────────────────────────────────────

def test_time_slot_morning():
    assert _time_slot("07:00") == "morning"
    assert _time_slot("08:00") == "morning"
    assert _time_slot("11:59") == "morning"


def test_time_slot_afternoon():
    assert _time_slot("12:00") == "afternoon"
    assert _time_slot("14:00") == "afternoon"
    assert _time_slot("16:59") == "afternoon"


def test_time_slot_evening():
    assert _time_slot("17:00") == "evening"
    assert _time_slot("19:00") == "evening"
    assert _time_slot("22:00") == "evening"


def test_haversine_same_point_is_zero():
    assert _haversine_km(1.28, 103.85, 1.28, 103.85) == pytest.approx(0.0)


def test_haversine_known_distance():
    # Gardens by the Bay to Marina Bay Sands ≈ 0.33 km
    d = _haversine_km(1.2816, 103.8636, 1.2834, 103.8607)
    assert 0.2 < d < 0.5


def test_sort_places_greedy_single():
    places = [{"id": "a", "lat": 1.0, "lng": 103.0}]
    assert _sort_places_greedy(places) == places


def test_sort_places_greedy_closer_first():
    # A is at origin, B is 1 km away, C is 10 km away from A but 1 km from B
    a = {"id": "A", "lat": 1.0000, "lng": 103.0000, "dwell_minutes": 60}
    b = {"id": "B", "lat": 1.0090, "lng": 103.0000, "dwell_minutes": 60}  # ~1km N
    c = {"id": "C", "lat": 1.0090, "lng": 103.0100, "dwell_minutes": 60}  # ~1km E of B
    result = _sort_places_greedy([a, c, b])  # start with a, then should pick b (closer)
    assert result[0]["id"] == "A"
    assert result[1]["id"] == "B"
    assert result[2]["id"] == "C"


def test_distribute_days_single_day():
    places = [
        {"id": "a", "dwell_minutes": 120},
        {"id": "b", "dwell_minutes": 120},
    ]
    days = _distribute_days(places, num_days=1)
    assert len(days) == 1
    assert len(days[0]) == 2


def test_distribute_days_splits_correctly():
    # 3 places: 300 + 300 + 120 → should split into 2 days at 480 cap
    places = [
        {"id": "a", "dwell_minutes": 300},
        {"id": "b", "dwell_minutes": 300},  # 300+300=600 > 480 → new day
        {"id": "c", "dwell_minutes": 120},
    ]
    days = _distribute_days(places, num_days=2)
    assert len(days) == 2
    assert days[0][0]["id"] == "a"
    assert days[1][0]["id"] == "b"
    assert days[1][1]["id"] == "c"


def test_distribute_days_respects_num_days_cap():
    # Even if dwell overflows 480, don't create more than num_days groups
    places = [{"id": str(i), "dwell_minutes": 300} for i in range(4)]
    days = _distribute_days(places, num_days=2)
    assert len(days) <= 2  # cannot exceed num_days


# ── integration tests: plan_trip ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_place_not_found_raises():
    with pytest.raises(PlaceDataMissingError, match="not-a-real-place"):
        await plan_trip("t1", ["not-a-real-place"], 1, 999.0, False, None)


@pytest.mark.asyncio
async def test_plan_trip_valid_returns_tripplan():
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(),
    ):
        result = await plan_trip("t1", ids, 1, 999.0, False, None)

    assert result.id == "t1"
    assert len(result.days) >= 1
    assert len(result.places) == 2
    assert len(result.days[0].legs) == 1
    assert result.days[0].legs[0].is_estimated is False


@pytest.mark.asyncio
async def test_optimize_order_returns_all_places():
    ids = VALID_IDS[:3]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(),
    ):
        result = await plan_trip("t2", ids, 1, 999.0, optimize_order=True, preferences=None)

    returned_ids = {p.id for p in result.places}
    assert returned_ids == set(ids)


@pytest.mark.asyncio
async def test_budget_exceeded_raises():
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(fare=100.0),  # 100 SGD per leg
    ):
        with pytest.raises(BudgetExceededError):
            await plan_trip("t3", ids, 1, budget_sgd=50.0, optimize_order=False, preferences=None)


@pytest.mark.asyncio
async def test_onemap_network_failure_raises_no_route():
    # Network errors must raise NoRouteError — fabricating duration/cost is not allowed
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        side_effect=Exception("Network timeout"),
    ):
        with pytest.raises(NoRouteError, match="unavailable"):
            await plan_trip("t4", ids, 1, budget_sgd=999.0, optimize_order=False, preferences=None)


@pytest.mark.asyncio
async def test_no_route_error_propagates():
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        side_effect=NoRouteError("no route"),
    ):
        with pytest.raises(NoRouteError):
            await plan_trip("t5", ids, 1, budget_sgd=999.0, optimize_order=False, preferences=None)


@pytest.mark.asyncio
async def test_time_slot_assigned_to_legs():
    # gardens-by-the-bay has best_time_start "08:00" → morning
    ids = ["gardens-by-the-bay", "marina-bay-sands"]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(),
    ):
        result = await plan_trip("t-slot", ids, 1, 999.0, False, None)

    leg = result.days[0].legs[0]
    assert leg.time_slot == "morning"


@pytest.mark.asyncio
async def test_best_time_no_warning_when_arrival_in_window():
    # gardens: arrival 09:00 ∈ [08:00, 11:00] → OK
    # After dwell 180 min → 12:00, travel 10 min → arrive marina at 12:10
    # marina best_time 10:00–22:00 → 12:10 ∈ window → OK
    ids = ["gardens-by-the-bay", "marina-bay-sands"]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(duration=10),
    ):
        result = await plan_trip("t6", ids, 1, budget_sgd=999.0, optimize_order=False, preferences=None)

    assert result.warnings == []


@pytest.mark.asyncio
async def test_best_time_warning_triggered():
    # merlion-park best_time 07:00–10:00. If we visit after a long dwell elsewhere it'll warn.
    # Start 09:00 at gardens (dwell 180 → depart 12:00), travel 10 min → arrive merlion 12:10
    # merlion best_time 07:00–10:00 → 12:10 outside → warning expected
    ids = ["gardens-by-the-bay", "merlion-park"]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(duration=10),
    ):
        result = await plan_trip("t7", ids, 1, budget_sgd=999.0, optimize_order=False, preferences=None)

    assert any("merlion" in w.lower() or "Merlion" in w for w in result.warnings)
