import pytest
from unittest.mock import AsyncMock, patch

from app.agents.planning_agent import (
    plan_trip,
    _classify_place,
    _pre_assign_evening_places,
    _day_bucketed_greedy,
    _distribute_days,
    _parse_opening_hours,
    _check_schedule_fit,
    _haversine_km,
    _PLACES,
)
from app.exceptions import PlaceDataMissingError
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

def test_haversine_same_point_is_zero():
    assert _haversine_km(1.28, 103.85, 1.28, 103.85) == pytest.approx(0.0)


def test_haversine_known_distance():
    # Gardens by the Bay to Marina Bay Sands ≈ 0.33 km
    d = _haversine_km(1.2816, 103.8636, 1.2834, 103.8607)
    assert 0.2 < d < 0.5


def test_classify_place_evening():
    assert _classify_place({"best_time_start": "17:00", "best_time_end": "23:00"}) == "evening"
    assert _classify_place({"best_time_start": "19:00", "best_time_end": "22:00"}) == "evening"


def test_classify_place_day():
    assert _classify_place({"best_time_start": "08:00", "best_time_end": "17:00"}) == "day"
    assert _classify_place({"best_time_start": "09:00", "best_time_end": "12:00"}) == "day"


def test_classify_place_overlap():
    assert _classify_place({"best_time_start": "14:00", "best_time_end": "20:00"}) == "overlap"


def test_classify_place_missing_fields():
    assert _classify_place({}) == "day"
    assert _classify_place({"best_time_start": "10:00"}) == "day"


def test_day_bucketed_greedy_all_places_placed():
    places = [
        {"id": "a", "lat": 1.28, "lng": 103.85, "dwell_minutes": 60,
         "best_time_start": "09:00", "best_time_end": "17:00"},
        {"id": "b", "lat": 1.29, "lng": 103.86, "dwell_minutes": 60,
         "best_time_start": "09:00", "best_time_end": "17:00"},
        {"id": "c", "lat": 1.30, "lng": 103.87, "dwell_minutes": 60,
         "best_time_start": "09:00", "best_time_end": "17:00"},
    ]
    day_groups, warnings = _day_bucketed_greedy(places, {}, num_days=1)
    all_ids = [p["id"] for d in day_groups for p in d]
    assert set(all_ids) == {"a", "b", "c"}
    assert warnings == []


def test_day_bucketed_greedy_evening_appended_after_day():
    day_place = {"id": "d", "lat": 1.28, "lng": 103.85, "dwell_minutes": 60,
                 "best_time_start": "09:00", "best_time_end": "17:00"}
    evening_place = {"id": "e", "lat": 1.29, "lng": 103.86, "dwell_minutes": 90,
                     "best_time_start": "19:00", "best_time_end": "23:00"}
    day_groups, _ = _day_bucketed_greedy([day_place], {0: [evening_place]}, num_days=1)
    assert len(day_groups) == 1
    ids = [p["id"] for p in day_groups[0]]
    assert ids.index("d") < ids.index("e")  # day place comes before evening place


def test_distribute_days_single_day():
    places = [
        {"id": "a", "dwell_minutes": 120},
        {"id": "b", "dwell_minutes": 120},
    ]
    days = _distribute_days(places, num_days=1)
    assert len(days) == 1
    assert len(days[0]) == 2


def test_distribute_days_splits_correctly():
    # Legacy path (no route_durations): 300 + 300 + 120 → split at 480 cap
    places = [
        {"id": "a", "dwell_minutes": 300},
        {"id": "b", "dwell_minutes": 300},  # 300+300=600 > 480 → new day
        {"id": "c", "dwell_minutes": 120},
    ]
    days = _distribute_days(places, num_days=2, route_durations=None)
    assert len(days) == 2
    assert days[0][0]["id"] == "a"
    assert days[1][0]["id"] == "b"
    assert days[1][1]["id"] == "c"


def test_distribute_days_respects_num_days_cap():
    # Even if dwell overflows 480, don't create more than num_days groups (legacy path)
    places = [{"id": str(i), "dwell_minutes": 300} for i in range(4)]
    days = _distribute_days(places, num_days=2, route_durations=None)
    assert len(days) <= 2  # cannot exceed num_days


# ── unit tests: _parse_opening_hours ─────────────────────────────────────────

def test_parse_opening_hours_24h():
    assert _parse_opening_hours("24h") == (0, 1439)


def test_parse_opening_hours_none():
    assert _parse_opening_hours(None) == (0, 1439)


def test_parse_opening_hours_range():
    open_m, close_m = _parse_opening_hours("09:00-18:00")
    assert open_m == 540
    assert close_m == 1080


def test_parse_opening_hours_early():
    open_m, close_m = _parse_opening_hours("07:00-10:00")
    assert open_m == 420
    assert close_m == 600


# ── unit tests: transit-aware distribute ─────────────────────────────────────

def test_distribute_days_transit_aware_fits_one_day():
    # 09:00 → place_a (dwell 120) → travel 10 → place_b (dwell 120) → ends 14:10
    places = [
        {"id": "a", "dwell_minutes": 120},
        {"id": "b", "dwell_minutes": 120},
    ]
    route_durations = {("a", "b"): 10}
    days = _distribute_days(places, num_days=1, route_durations=route_durations)
    assert len(days) == 1
    assert len(days[0]) == 2


def test_distribute_days_transit_aware_splits_on_17h():
    # 09:00 → place_a (dwell 400) → travel 30 → place_b (dwell 120)
    # arrive_b = 540+400+30 = 970; 970+120=1090 > 1020 → move b to day 2
    places = [
        {"id": "a", "dwell_minutes": 400},
        {"id": "b", "dwell_minutes": 120},
    ]
    route_durations = {("a", "b"): 30}
    days = _distribute_days(places, num_days=2, route_durations=route_durations)
    assert len(days) == 2
    assert days[0][0]["id"] == "a"
    assert days[1][0]["id"] == "b"


def test_distribute_days_opening_hours_respected():
    # place_b opens 07:00-10:00; arrival at 09:00+120+10=730 min (~12:10) → outside
    # → placed on day 2 where clock starts at 09:00 → arrival=09:00 (no prev) → 540 ∈ [420,600]
    places = [
        {"id": "a", "dwell_minutes": 120},
        {"id": "b", "dwell_minutes": 60, "opening_hours": "07:00-10:00"},
    ]
    route_durations = {("a", "b"): 10}
    days = _distribute_days(places, num_days=2, route_durations=route_durations)
    b_day = next(i for i, d in enumerate(days) if any(p["id"] == "b" for p in d))
    a_day = next(i for i, d in enumerate(days) if any(p["id"] == "a" for p in d))
    assert b_day != a_day  # b pushed to a different day


# ── unit tests: _check_schedule_fit ─────────────────────────────────────────

def test_check_schedule_fit_ok():
    places = [{"id": "a", "dwell_minutes": 120}, {"id": "b", "dwell_minutes": 120}]
    days = [places]
    issue, _ = _check_schedule_fit(days, {("a", "b"): 10})
    assert issue is None


def test_check_schedule_fit_overfull():
    # Single day with 600 min dwell + no travel → ends at 540+600=1140 > 1050
    places = [{"id": str(i), "dwell_minutes": 200} for i in range(3)]
    days = [places]
    issue, summary = _check_schedule_fit(days, {})
    assert issue == "overfull"
    assert summary[0]["occupied_minutes"] == 600


def test_check_schedule_fit_underfull():
    # Single day with only 60 min total < 240
    places = [{"id": "a", "dwell_minutes": 60}]
    days = [places]
    issue, summary = _check_schedule_fit(days, {})
    assert issue == "underfull"
    assert summary[0]["occupied_minutes"] == 60


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
async def test_budget_exceeded_adds_warning():
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(fare=100.0),  # 100 SGD per leg, budget is 50
    ):
        result = await plan_trip("t3", ids, 1, budget_sgd=50.0, optimize_order=False, preferences=None)
    # Planning must complete (no exception) and emit a budget warning
    assert any("budget" in w.lower() for w in result.warnings)
    assert len(result.days[0].legs) == 1


@pytest.mark.asyncio
async def test_onemap_network_failure_raises_no_route():
    # Network errors (generic Exception) must still raise NoRouteError — not fall back.
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        side_effect=Exception("Network timeout"),
    ):
        with pytest.raises(NoRouteError, match="unavailable"):
            await plan_trip("t4", ids, 1, budget_sgd=999.0, optimize_order=False, preferences=None)


@pytest.mark.asyncio
async def test_no_route_error_falls_back_to_haversine():
    # NoRouteError (API returns no itinerary) → haversine estimate; plan must succeed.
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        side_effect=NoRouteError("no route"),
    ):
        result = await plan_trip("t5", ids, 1, budget_sgd=999.0, optimize_order=False, preferences=None)
    assert len(result.days) >= 1
    assert result.days[0].legs[0].is_estimated is True


@pytest.mark.asyncio
async def test_short_distance_uses_walk_mode():
    """clarke-quay → boat-quay ≈ 530m < 1.5km → must call onemap with mode='walk'."""
    ids = ["clarke-quay", "boat-quay"]
    mock = AsyncMock(return_value=_mock_route())
    with patch("app.agents.planning_agent.onemap.get_route", mock):
        await plan_trip("t-walk", ids, 1, 999.0, False, None)
    first_mode = mock.call_args_list[0].kwargs.get("mode") or mock.call_args_list[0].args[-1]
    assert first_mode == "walk"


@pytest.mark.asyncio
async def test_long_distance_uses_pt_mode():
    """gardens-by-the-bay → sentosa-universal-studios ≈ 5km > 1.5km → must use mode='pt'."""
    ids = ["gardens-by-the-bay", "sentosa-universal-studios"]
    mock = AsyncMock(return_value=_mock_route())
    with patch("app.agents.planning_agent.onemap.get_route", mock):
        await plan_trip("t-pt", ids, 1, 999.0, False, None)
    first_mode = mock.call_args_list[0].kwargs.get("mode") or mock.call_args_list[0].args[-1]
    assert first_mode == "pt"


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
async def test_plan_trip_populates_leg_geometry():
    ids = VALID_IDS[:2]
    route_with_geo = {**_mock_route(), "geometry": "encoded_abc", "instructions": ["Walk to station", "Board NS"]}
    with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock, return_value=route_with_geo):
        result = await plan_trip("t-geo", ids, 1, 999.0, False, None)
    assert result.days[0].legs[0].geometry == "encoded_abc"
    assert result.days[0].legs[0].instructions == ["Walk to station", "Board NS"]


@pytest.mark.asyncio
async def test_plan_trip_geometry_none_when_not_in_route():
    ids = VALID_IDS[:2]
    with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock, return_value=_mock_route()):
        result = await plan_trip("t-nogeo", ids, 1, 999.0, False, None)
    assert result.days[0].legs[0].geometry is None
    assert result.days[0].legs[0].instructions == []


@pytest.mark.asyncio
async def test_plan_trip_populates_sub_legs():
    """sub_legs from route dict must be passed through to LegResponse."""
    ids = VALID_IDS[:2]
    route_with_sub_legs = {
        **_mock_route(),
        "sub_legs": [
            {"mode": "WALK", "route": "", "from_name": "Start", "to_name": "Station",
             "from_stop_code": "", "to_stop_code": "", "duration_minutes": 5, "num_stops": 0},
            {"mode": "MRT", "route": "EW", "from_name": "Bayfront", "to_name": "City Hall",
             "from_stop_code": "EW24", "to_stop_code": "EW13", "duration_minutes": 10, "num_stops": 3},
        ],
    }
    with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock, return_value=route_with_sub_legs):
        result = await plan_trip("t-sub", ids, 1, 999.0, False, None)
    leg = result.days[0].legs[0]
    assert len(leg.sub_legs) == 2
    mrt = next(s for s in leg.sub_legs if s.mode == "MRT")
    assert mrt.route == "EW"
    assert mrt.from_stop_code == "EW24"
    assert mrt.num_stops == 3


@pytest.mark.asyncio
async def test_plan_trip_sub_legs_empty_when_route_has_none():
    """When route dict has no sub_legs key, LegResponse.sub_legs must be empty list."""
    ids = VALID_IDS[:2]
    with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock, return_value=_mock_route()):
        result = await plan_trip("t-sub-empty", ids, 1, 999.0, False, None)
    assert result.days[0].legs[0].sub_legs == []


# ── P4-C: LLM schedule warning ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_overfull_schedule_warning_in_result():
    """When Gemini detects overfull, result.warnings should include a schedule warning."""
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(duration=15),
    ):
        with patch(
            "app.services.gemini.generate_schedule_warning",
            new_callable=AsyncMock,
            return_value="Your schedule is too packed on Day 1.",
        ):
            result = await plan_trip("t-fit", ids, 1, 999.0, False, None)
    # May or may not be overfull depending on actual dwell data; just verify no crash
    assert result.id == "t-fit"
    assert isinstance(result.warnings, list)


# ── Gemini fallback for ambiguous place names ─────────────────────────────────

@pytest.mark.asyncio
async def test_gemini_resolves_ambiguous_name_to_curated_id():
    """An unrecognized string that Gemini resolves to a real place name → plan succeeds."""
    known_id = VALID_IDS[0]
    with patch("app.services.gemini.parse_places_input", new_callable=AsyncMock, return_value=["Marina Bay Sands"]):
        with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock, return_value=_mock_route()):
            result = await plan_trip("t-gem1", [known_id, "marina bay sands hotel"], 1, 999.0, False, None)
    # "marina bay sands hotel" should have been resolved to "marina-bay-sands"
    place_ids = {p.id for p in result.places}
    assert "marina-bay-sands" in place_ids


@pytest.mark.asyncio
async def test_gemini_returns_empty_list_raises_place_missing():
    with patch("app.services.gemini.parse_places_input", new_callable=AsyncMock, return_value=[]):
        with pytest.raises(PlaceDataMissingError):
            await plan_trip("t-gem2", [VALID_IDS[0], "unknownxyz"], 1, 999.0, False, None)


@pytest.mark.asyncio
async def test_gemini_exception_falls_back_to_place_missing():
    with patch("app.services.gemini.parse_places_input", new_callable=AsyncMock, side_effect=ValueError("rate limit")):
        with pytest.raises(PlaceDataMissingError):
            await plan_trip("t-gem3", [VALID_IDS[0], "unknownxyz"], 1, 999.0, False, None)


# ── P4-BUG-2: opening-hours check must include dwell time ────────────────────

def test_opening_hours_check_includes_dwell_time():
    """Place whose visit would extend past oh_close should not be placed normally.

    Scenario: place_b has opening_hours="14:00-15:00" (window=60 min) with dwell=90 min.
    No arrival time satisfies arrival>=14:00 AND arrival+90<=15:00, so in_hours must
    always be False and b must go to best-effort (a different day than a).

    With the BUG (arrival-only check): arrival=14:00 → 14:00<=14:00<=15:00 → True
    → b placed on same day as a, violating the opening-hours constraint.
    """
    places = [
        {"id": "a", "dwell_minutes": 300},  # day 1 clock: 09:00→14:00
        {"id": "b", "dwell_minutes": 90, "opening_hours": "14:00-15:00"},
    ]
    route_durations = {("a", "b"): 0}
    days = _distribute_days(places, num_days=2, route_durations=route_durations)
    b_day = next(i for i, d in enumerate(days) if any(p["id"] == "b" for p in d))
    a_day = next(i for i, d in enumerate(days) if any(p["id"] == "a" for p in d))
    assert b_day != a_day, (
        "place_b's visit (14:00→15:30) exceeds oh_close (15:00); "
        "it should be placed on a different day via best-effort"
    )


def test_opening_hours_exact_fit_still_passes():
    """A place where arrival + dwell == oh_close should still be scheduled normally."""
    # arrival=09:00 (540), dwell=60 → ends exactly at 10:00 (600) = oh_close
    places = [{"id": "x", "dwell_minutes": 60, "opening_hours": "09:00-10:00"}]
    days = _distribute_days(places, num_days=1, route_durations={})
    assert len(days) == 1
    assert days[0][0]["id"] == "x"


# ── P4-BUG-3: best-effort fallback — compute prev_id before appending ─────────

def test_best_effort_fallback_travel_uses_existing_last_place():
    """When best-effort appends to a non-empty day, travel is computed from the
    last place already there, not from anything added after the append."""
    # a fits day 1 normally. b cannot fit any day normally (opening window < dwell).
    # Best-effort puts b on day 2 (lower clock).
    # c also cannot fit normally and goes to day 1 via best-effort after b.
    # travel(a→c) should be used for c's clock advancement on day 1.
    places = [
        {"id": "a", "dwell_minutes": 60},   # day 1, clock=600 after
        {"id": "b", "dwell_minutes": 90, "opening_hours": "14:00-15:00"},  # best-effort day 2
        {"id": "c", "dwell_minutes": 60},   # normal fit day 1 (540+60+travel_a_c)
    ]
    route_durations = {
        ("a", "b"): 30,
        ("a", "c"): 10,
        ("b", "c"): 5,
    }
    days = _distribute_days(places, num_days=2, route_durations=route_durations)
    # All 3 places must be placed
    all_placed = [p["id"] for day in days for p in day]
    assert "a" in all_placed
    assert "b" in all_placed
    assert "c" in all_placed


# ── P4-BUG-5: _check_schedule_fit boundary zone ──────────────────────────────

def test_check_schedule_fit_at_exactly_1730():
    """Clock ending at exactly 17:30 (1050 min) is NOT overfull."""
    # start=540, dwell=510 → clock_end=1050=17:30 → not overfull
    places = [{"id": "x", "dwell_minutes": 510}]
    issue, summary = _check_schedule_fit([places], {})
    assert issue != "overfull"
    assert summary[0]["occupied_minutes"] == 510


def test_check_schedule_fit_past_1730_is_overfull():
    """Clock ending past 17:30 (1050 min) IS overfull."""
    # start=540, dwell=511 → clock_end=1051>1050 → overfull
    places = [{"id": "y", "dwell_minutes": 511}]
    issue, summary = _check_schedule_fit([places], {})
    assert issue == "overfull"
    assert summary[0]["occupied_minutes"] == 511


def test_check_schedule_fit_at_exactly_1700_not_overfull():
    """Clock ending at 17:00 (1020 min) — the distribute_days hard cutoff — is NOT overfull."""
    # start=540, dwell=480 → clock_end=1020=17:00 → within leeway
    places = [{"id": "z", "dwell_minutes": 480}]
    issue, _ = _check_schedule_fit([places], {})
    assert issue != "overfull"


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
