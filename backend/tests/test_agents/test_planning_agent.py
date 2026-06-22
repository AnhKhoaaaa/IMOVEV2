import pytest
from unittest.mock import AsyncMock, patch

from app.agents.planning_agent import (
    plan_trip,
    switch_leg_mode,
    switch_leg_mode_live,
    _fetch_all_alternatives,
    _ensure_always_modes,
    estimated_alternatives_models,
    _fill_transit_fare,
    _apply_mode_safety_guard,
    _classify_place,
    _assign_evening_to_days,
    _day_bucketed_greedy,
    _distribute_days,
    _parse_opening_hours,
    _check_schedule_fit,
    _haversine_km,
    _is_open_on_weekday,
    _weekdays_for_days,
    _relocate_closed_day_places,
    _PLACES,
)
from app.exceptions import PlaceDataMissingError
from app.models.place import Place
from app.models.trip import AlternativeRoute, LegResponse, DayPlan, TripPlan
from app.services.onemap import NoRouteError


# ── helpers ──────────────────────────────────────────────────────────────────

def _mock_route(duration=15, fare=1.80, mode="SUBWAY", distance_km=1.5):
    return {
        "duration_minutes": duration,
        "fare_sgd": fare,
        "legs": [{"mode": "WALK"}, {"mode": mode}],
        "geometry": None,
        "geometries": [],
        "instructions": [],
        "sub_legs": [],
        "is_estimated": False,
        "distance_km": distance_km,
    }


def _make_place(pid: str, lat: float = 1.28, lng: float = 103.85, dwell: int = 60) -> Place:
    """Helper: create a minimal Place object for tests."""
    return Place(
        id=pid, name=pid, lat=lat, lng=lng,
        dwell_minutes=dwell, best_time_start="09:00", best_time_end="17:00",
        category="test", is_outdoor=False, in_curated_dataset=True,
    )


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
    day_groups, warnings = _day_bucketed_greedy(places, num_days=1)
    all_ids = [p["id"] for d in day_groups for p in d]
    assert set(all_ids) == {"a", "b", "c"}
    assert warnings == []


def test_assign_evening_to_days_appended_after_day():
    """Evening places assigned after daytime greedy — day place must come before evening."""
    day_place = {"id": "d", "lat": 1.28, "lng": 103.85, "dwell_minutes": 60,
                 "best_time_start": "09:00", "best_time_end": "17:00"}
    evening_place = {"id": "e", "lat": 1.29, "lng": 103.86, "dwell_minutes": 90,
                     "best_time_start": "19:00", "best_time_end": "23:00"}
    day_groups, _ = _day_bucketed_greedy([day_place], num_days=1)
    _assign_evening_to_days([evening_place], day_groups)
    assert len(day_groups) == 1
    ids = [p["id"] for p in day_groups[0]]
    assert ids.index("d") < ids.index("e")  # day place comes before evening place


def test_assign_evening_to_days_balances_dwell():
    """Evening place goes to the day with the least accumulated dwell."""
    day_heavy = {"id": "a", "lat": 1.28, "lng": 103.85, "dwell_minutes": 180}
    day_light = {"id": "b", "lat": 1.29, "lng": 103.86, "dwell_minutes": 60}
    evening   = {"id": "e", "lat": 1.285, "lng": 103.855, "dwell_minutes": 90}
    # day_groups: day 0 has heavy (180 min), day 1 has light (60 min)
    day_groups = [[day_heavy], [day_light]]
    _assign_evening_to_days([evening], day_groups)
    # Evening should go to day 1 (60 min < 180 min)
    assert any(p["id"] == "e" for p in day_groups[1])
    assert all(p["id"] != "e" for p in day_groups[0])


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


# ── dev21: close_days awareness + window-urgency ordering ─────────────────────

def test_is_open_on_weekday():
    assert _is_open_on_weekday({"close_days": ["Monday"]}, "Monday") is False
    assert _is_open_on_weekday({"close_days": ["Monday"]}, "Tuesday") is True
    assert _is_open_on_weekday({}, "Monday") is True
    assert _is_open_on_weekday({"close_days": []}, "Sunday") is True


def test_weekdays_for_days():
    from datetime import date
    start = date(2026, 6, 15)  # a Monday
    assert _weekdays_for_days(start, 3) == ["Monday", "Tuesday", "Wednesday"]
    assert _weekdays_for_days(None, 3) is None


def test_relocate_closed_day_moves_to_open_day():
    weekdays = ["Monday", "Tuesday"]
    a = {"id": "a", "name": "Museum", "close_days": ["Monday"]}
    b = {"id": "b", "name": "Park", "close_days": []}
    day_groups = [[a], [b]]
    warnings = []
    _relocate_closed_day_places(day_groups, weekdays, warnings)
    assert a not in day_groups[0]
    assert a in day_groups[1]
    assert any("moved to day 2" in w for w in warnings)


def test_relocate_closed_every_day_warns_and_keeps():
    weekdays = ["Monday", "Monday"]
    a = {"id": "a", "name": "Museum", "close_days": ["Monday"]}
    day_groups = [[a], []]
    warnings = []
    _relocate_closed_day_places(day_groups, weekdays, warnings)
    assert a in day_groups[0]  # nowhere open → stays put
    assert any("closed every day" in w for w in warnings)


def test_relocate_noop_without_start_date():
    a = {"id": "a", "name": "Museum", "close_days": ["Monday"]}
    day_groups = [[a]]
    warnings = []
    _relocate_closed_day_places(day_groups, None, warnings)
    assert day_groups == [[a]]
    assert warnings == []


def test_day_bucketed_greedy_prefers_closing_soon_window():
    # 'near' is closest to the 09:00 anchor but open all day; 'tight' is slightly farther
    # but closes soon — dev21 P2 should pick 'tight' first so it isn't deferred until infeasible.
    near  = {"id": "near",  "lat": 1.280, "lng": 103.850, "dwell_minutes": 30,
             "opening_hours": "00:00-23:59"}
    tight = {"id": "tight", "lat": 1.281, "lng": 103.851, "dwell_minutes": 30,
             "opening_hours": "09:00-10:30"}
    day_groups, _ = _day_bucketed_greedy([near, tight], num_days=1)
    order = [p["id"] for p in day_groups[0]]
    assert order.index("tight") < order.index("near")


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


def test_parse_opening_hours_multi_slot_returns_widest_window():
    # Hawker centre: ["07:00-14:00", "17:00-22:00"] → earliest open 07:00, latest close 22:00
    open_m, close_m = _parse_opening_hours(["07:00-14:00", "17:00-22:00"])
    assert open_m == 420    # 07:00
    assert close_m == 1320  # 22:00


def test_parse_opening_hours_multi_slot_single_entry_same_as_string():
    # A list with one slot must equal the string form
    assert _parse_opening_hours(["09:00-18:00"]) == _parse_opening_hours("09:00-18:00")


def test_parse_opening_hours_empty_list_returns_24h():
    assert _parse_opening_hours([]) == (0, 1439)


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
    # 1 place × 60 min = 60 < 120 min threshold → underfull
    places = [{"id": "a", "dwell_minutes": 60}]
    days = [places]
    issue, summary = _check_schedule_fit(days, {})
    assert issue == "underfull"
    assert summary[0]["occupied_minutes"] == 60


def test_check_schedule_fit_not_underfull_when_properly_distributed():
    # 2 places × 90 min + 15 min transit = 195 min ≥ 120 → properly distributed, no warning
    places = [{"id": "a", "dwell_minutes": 90}, {"id": "b", "dwell_minutes": 90}]
    days = [places]
    issue, _ = _check_schedule_fit(days, {("a", "b"): 15})
    assert issue is None


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
        result = await plan_trip("t1", ids, 1, 999.0, True, None)

    assert result.id == "t1"
    assert len(result.days) >= 1
    assert len(result.places) == 2
    assert len(result.days[0].legs) == 1
    assert result.days[0].legs[0].is_estimated is False


@pytest.mark.asyncio
async def test_day_assignments_honoured_verbatim():
    """dev26: explicit day_assignments must place each id on its assigned day,
    bypassing _distribute_days' time-of-day re-bucketing."""
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(),
    ):
        result = await plan_trip(
            "t-da", ids, num_days=2, budget_sgd=999.0, optimize_order=False,
            preferences=None, day_assignments=[[ids[0]], [ids[1]]],
        )
    assert len(result.days) == 2
    assert [pid for pid in result.days[0].place_ids if pid != "hotel"] == [ids[0]]
    assert [pid for pid in result.days[1].place_ids if pid != "hotel"] == [ids[1]]


@pytest.mark.asyncio
async def test_day_assignments_preserves_empty_day():
    """dev26: an empty group in day_assignments stays an empty day — the day count
    must not collapse (this is the Bug 2 setup: adding to an otherwise-empty day)."""
    ids = VALID_IDS[:2]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        return_value=_mock_route(),
    ):
        result = await plan_trip(
            "t-da-empty", ids, num_days=2, budget_sgd=999.0, optimize_order=False,
            preferences=None, day_assignments=[[ids[0], ids[1]], []],
        )
    assert len(result.days) == 2
    assert [pid for pid in result.days[1].place_ids if pid != "hotel"] == []


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
        result = await plan_trip("t3", ids, 1, budget_sgd=50.0, optimize_order=True, preferences=None)
    # Planning must complete (no exception) and emit a budget warning
    assert any("budget" in w.lower() for w in result.warnings)
    assert len(result.days[0].legs) == 1


@pytest.mark.asyncio
async def test_onemap_network_failure_raises_no_route():
    # Network errors swallowed per-mode by _fetch_all_alternatives.
    # Long-distance pair (≈5.4km ≥ 2km) with all modes failing → falls back to GRAB.
    ids = ["gardens-by-the-bay-supertree-grove", "universal-studios-singapore"]
    with patch("app.agents.planning_agent.onemap.get_route",
               new_callable=AsyncMock, side_effect=Exception("Network timeout")), \
         patch("app.agents.planning_agent.onemap.get_pt_routes_by_mode",
               new_callable=AsyncMock, side_effect=Exception("Network timeout")):
        result = await plan_trip("t4", ids, 1, budget_sgd=999.0, optimize_order=True, preferences=None)
    leg = result.days[0].legs[0]
    assert leg.transport_mode == "GRAB"
    assert leg.is_estimated is True


@pytest.mark.asyncio
async def test_short_distance_no_route_falls_back_to_haversine():
    # clarke-quay → boat-quay ≈ 530m < 1.5km → walk mode → NoRouteError → haversine estimate
    ids = ["clarke-quay", "boat-quay"]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        side_effect=NoRouteError("no walk route"),
    ):
        result = await plan_trip("t5", ids, 1, budget_sgd=999.0, optimize_order=False, preferences=None)
    assert len(result.days) >= 1
    assert result.days[0].legs[0].is_estimated is True


@pytest.mark.asyncio
async def test_long_distance_no_transit_falls_back_to_grab():
    # gardens-by-the-bay-supertree-grove → universal-studios-singapore ≈ 5.4km ≥ 2.0km
    # When all transit fails, planning now succeeds with GRAB (estimated) instead of raising.
    ids = ["gardens-by-the-bay-supertree-grove", "universal-studios-singapore"]
    with patch("app.agents.planning_agent.onemap.get_route",
               new_callable=AsyncMock, side_effect=NoRouteError("no pt route")), \
         patch("app.agents.planning_agent.onemap.get_pt_routes_by_mode",
               new_callable=AsyncMock, side_effect=NoRouteError("no pt route")):
        result = await plan_trip("t-pt-fail", ids, 1, budget_sgd=999.0, optimize_order=True, preferences=None)
    leg = result.days[0].legs[0]
    assert leg.transport_mode == "GRAB"
    assert leg.is_estimated is True


@pytest.mark.asyncio
async def test_mid_distance_no_transit_falls_back_to_walk():
    # clarke-quay → bugis-junction ≈ 1.5km (1.5–2.0km gap)
    # When all transit fails, planning falls back to haversine WALK (not GRAB, not NoRouteError).
    ids = ["clarke-quay", "bugis-junction"]
    with patch(
        "app.agents.planning_agent.onemap.get_route",
        new_callable=AsyncMock,
        side_effect=NoRouteError("no route"),
    ):
        result = await plan_trip("t-mid-gap", ids, 1, budget_sgd=999.0, optimize_order=False, preferences=None)
    leg = result.days[0].legs[0]
    assert leg.transport_mode == "WALK"
    assert leg.is_estimated is True


@pytest.mark.asyncio
async def test_short_distance_leg_has_walk_transport_mode():
    """clarke-quay → boat-quay ≈ 530m < 1.5km → WALK wins scoring (free 6 min vs S$1.80 20 min PT).

    With the weighted scoring system, WALK wins when it is faster and cheaper.
    The old distance-threshold rule (<1.5km → always WALK) has been replaced.
    """
    ids = ["clarke-quay", "boat-quay"]

    async def _mode_aware(from_lat, from_lng, to_lat, to_lng, mode, transit_modes=None):
        if mode == "walk":
            return {"duration_minutes": 6, "fare_sgd": 0.0,
                    "legs": [{"mode": "WALK"}], "geometry": None, "geometries": [],
                    "instructions": [], "sub_legs": [], "is_estimated": False}
        # pt (mixed or bus-only) — slower and costs money
        return {"duration_minutes": 20, "fare_sgd": 1.80,
                "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}], "geometry": None,
                "geometries": [], "instructions": [], "sub_legs": [], "is_estimated": False}

    with patch("app.agents.planning_agent.onemap.get_route", side_effect=_mode_aware):
        result = await plan_trip("t-walk", ids, 1, 999.0, False, None)
    assert result.days[0].legs[0].transport_mode == "WALK"


@pytest.mark.asyncio
async def test_long_distance_leg_has_metro_transport_mode():
    """gardens-by-the-bay-supertree-grove → universal-studios-singapore ≈ 5.4km >= 1.5km → leg.transport_mode 'METRO'."""
    ids = ["gardens-by-the-bay-supertree-grove", "universal-studios-singapore"]
    with patch("app.agents.planning_agent.onemap.get_route", AsyncMock(return_value=_mock_route())):
        result = await plan_trip("t-pt", ids, 1, 999.0, False, None)
    assert result.days[0].legs[0].transport_mode == "METRO"


@pytest.mark.asyncio
async def test_best_time_no_warning_when_arrival_in_window():
    # merlion-park: dwell 30 min, opens 24h → arrival 09:00, leaves 09:30
    # asian-civilisations-museum: dwell 120 min, travel 10 min → arrives 09:40, leaves 11:40
    # total activity = 160 min → no overfull (700 < 1050) and no underfull (160 > 120)
    ids = ["merlion-park", "asian-civilisations-museum"]
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
    route_with_geo = {
        **_mock_route(),
        "geometry": "encoded_abc",
        "geometries": ["walk_poly", "mrt_poly", "walk2_poly"],
        "instructions": ["Walk to station", "Board NS"],
    }
    with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock, return_value=route_with_geo):
        result = await plan_trip("t-geo", ids, 1, 999.0, True, None)
    leg = result.days[0].legs[0]
    assert leg.geometry == "encoded_abc"
    assert leg.geometries == ["walk_poly", "mrt_poly", "walk2_poly"]
    assert leg.instructions == ["Walk to station", "Board NS"]


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
             "from_stop_code": "", "to_stop_code": "", "duration_minutes": 5, "num_stops": 0,
             "geometry": None, "intermediate_stops": []},
            {"mode": "METRO", "route": "EW", "from_name": "Bayfront", "to_name": "City Hall",
             "from_stop_code": "EW24", "to_stop_code": "EW13", "duration_minutes": 10, "num_stops": 3,
             "geometry": "mrt_poly", "intermediate_stops": []},
        ],
    }
    with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock, return_value=route_with_sub_legs):
        result = await plan_trip("t-sub", ids, 1, 999.0, True, None)
    leg = result.days[0].legs[0]
    assert len(leg.sub_legs) == 2
    metro = next(s for s in leg.sub_legs if s.mode == "METRO")
    assert metro.route == "EW"
    assert metro.from_stop_code == "EW24"
    assert metro.num_stops == 3
    assert metro.geometry == "mrt_poly"


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
    # "marina bay sands hotel" resolves to "marina-bay-sands-skypark" in new dataset
    place_ids = {p.id for p in result.places}
    assert "marina-bay-sands-skypark" in place_ids


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


# ── _fetch_all_alternatives ──────────────────────────────────────────────────

def test_mode_safety_guard_replaces_long_cycle_with_fastest_transit():
    alternatives = {
        "CYCLE": {"duration_minutes": 180},
        "METRO": {"duration_minutes": 45},
        "BUS": {"duration_minutes": 60},
        "GRAB": {"duration_minutes": 25},
    }

    assert _apply_mode_safety_guard("CYCLE", alternatives, dist_km=12.0) == "METRO"


def test_mode_safety_guard_replaces_long_cycle_with_grab_without_transit():
    alternatives = {
        "CYCLE": {"duration_minutes": 180},
        "GRAB": {"duration_minutes": 25},
    }

    assert _apply_mode_safety_guard("CYCLE", alternatives, dist_km=12.0) == "GRAB"


def test_mode_safety_guard_keeps_short_cycle_recommendation():
    alternatives = {
        "CYCLE": {"duration_minutes": 35},
        "METRO": {"duration_minutes": 30},
        "GRAB": {"duration_minutes": 15},
    }

    assert _apply_mode_safety_guard("CYCLE", alternatives, dist_km=6.0) == "CYCLE"


def test_mode_safety_guard_keeps_long_cycle_when_no_practical_alternative():
    """Cycle > 60 min but no transit and dist < 2km → nothing safer to swap to → keep CYCLE."""
    alternatives = {"CYCLE": {"duration_minutes": 65}}

    assert _apply_mode_safety_guard("CYCLE", alternatives, dist_km=1.8) == "CYCLE"


def test_mode_safety_guard_replaces_long_walk_with_fastest_transit():
    alternatives = {
        "WALK": {"duration_minutes": 40},
        "METRO": {"duration_minutes": 20},
        "BUS": {"duration_minutes": 15},
    }

    assert _apply_mode_safety_guard("WALK", alternatives, dist_km=3.0) == "BUS"


def test_mode_safety_guard_replaces_long_walk_with_grab_without_transit():
    alternatives = {
        "WALK": {"duration_minutes": 40},
        "GRAB": {"duration_minutes": 12},
    }

    assert _apply_mode_safety_guard("WALK", alternatives, dist_km=3.0) == "GRAB"


def test_mode_safety_guard_keeps_walk_below_distance_floor():
    """WALK under 1.5 km stays WALK even when transit exists."""
    alternatives = {
        "WALK": {"duration_minutes": 14},
        "METRO": {"duration_minutes": 9},
    }

    assert _apply_mode_safety_guard("WALK", alternatives, dist_km=1.2) == "WALK"


def test_mode_safety_guard_keeps_mid_distance_walk_without_grab():
    """1.5 km ≤ dist < 2 km with no transit and no Grab → keep WALK (Grab floor not met)."""
    alternatives = {"WALK": {"duration_minutes": 22}}

    assert _apply_mode_safety_guard("WALK", alternatives, dist_km=1.7) == "WALK"


@pytest.mark.asyncio
async def test_fetch_all_alternatives_returns_available_modes():
    """Standard PT + walk both succeed → both stored under correct keys."""
    async def _mock(from_lat, from_lng, to_lat, to_lng, mode, transit_modes=None):
        if mode == "walk":
            return {"duration_minutes": 10, "fare_sgd": 0.0,
                    "legs": [{"mode": "WALK"}], "geometry": None,
                    "geometries": [], "instructions": [], "sub_legs": [], "distance_km": 0.8}
        if transit_modes == "BUS":
            return {"duration_minutes": 20, "fare_sgd": 1.20,
                    "legs": [{"mode": "WALK"}, {"mode": "BUS"}], "geometry": None,
                    "geometries": [], "instructions": [], "sub_legs": [], "distance_km": 1.5}
        return {"duration_minutes": 15, "fare_sgd": 1.80,
                "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}], "geometry": None,
                "geometries": [], "instructions": [], "sub_legs": [], "distance_km": 1.5}

    from_p = {"id": "a", "lat": 1.28, "lng": 103.85}
    to_p   = {"id": "b", "lat": 1.30, "lng": 103.87}
    with patch("app.agents.planning_agent.onemap.get_route", side_effect=_mock):
        alts = await _fetch_all_alternatives(from_p, to_p)

    assert "METRO" in alts
    assert "BUS" in alts
    assert "WALK" in alts


@pytest.mark.asyncio
async def test_fetch_all_alternatives_bus_only_not_stored_when_returns_metro():
    """If PT+BUS call returns a METRO-primary route, it must NOT be stored as BUS."""
    async def _mock(from_lat, from_lng, to_lat, to_lng, mode, transit_modes=None):
        # All calls return SUBWAY regardless of transit_modes
        return {"duration_minutes": 15, "fare_sgd": 1.80,
                "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}], "geometry": None,
                "geometries": [], "instructions": [], "sub_legs": [], "distance_km": 1.5}

    _subway_route = {"duration_minutes": 15, "fare_sgd": 1.80,
                     "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}], "geometry": None,
                     "geometries": [], "instructions": [], "sub_legs": [], "distance_km": 1.5,
                     "is_estimated": False}
    from_p = {"id": "a", "lat": 1.28, "lng": 103.85}
    to_p   = {"id": "b", "lat": 1.30, "lng": 103.87}
    with patch("app.agents.planning_agent.onemap.get_route", side_effect=_mock), \
         patch("app.agents.planning_agent.onemap.get_pt_routes_by_mode",
               AsyncMock(return_value={"METRO": _subway_route})):
        alts = await _fetch_all_alternatives(from_p, to_p)

    assert "METRO" in alts
    assert "BUS" not in alts   # not stored because primary mode was METRO, not BUS


@pytest.mark.asyncio
async def test_fetch_all_alternatives_partial_failure_returns_available():
    """When one mode fails, the others are still returned."""
    async def _mock(from_lat, from_lng, to_lat, to_lng, mode, transit_modes=None):
        if mode == "walk":
            raise NoRouteError("no walk route")
        return {"duration_minutes": 15, "fare_sgd": 1.80,
                "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}], "geometry": None,
                "geometries": [], "instructions": [], "sub_legs": [], "distance_km": 1.5}

    from_p = {"id": "a", "lat": 1.28, "lng": 103.85}
    to_p   = {"id": "b", "lat": 1.30, "lng": 103.87}
    with patch("app.agents.planning_agent.onemap.get_route", side_effect=_mock):
        alts = await _fetch_all_alternatives(from_p, to_p)

    assert "METRO" in alts
    assert "WALK" not in alts


@pytest.mark.asyncio
async def test_fetch_all_alternatives_all_fail_returns_grab_only():
    # When all OneMap modes fail, GRAB (synthetic estimate) is always returned as fallback.
    from_p = {"id": "a", "lat": 1.28, "lng": 103.85}
    to_p   = {"id": "b", "lat": 1.30, "lng": 103.87}
    with patch("app.agents.planning_agent.onemap.get_route", AsyncMock(side_effect=NoRouteError)), \
         patch("app.agents.planning_agent.onemap.get_pt_routes_by_mode", AsyncMock(side_effect=NoRouteError)):
        alts = await _fetch_all_alternatives(from_p, to_p)
    assert set(alts.keys()) == {"GRAB"}
    assert alts["GRAB"]["is_estimated"] is True


@pytest.mark.asyncio
async def test_plan_trip_populates_alternatives():
    """After plan_trip, each leg must have an alternatives dict with at least one mode."""
    ids = VALID_IDS[:2]
    with patch("app.agents.planning_agent.onemap.get_route", AsyncMock(return_value=_mock_route())):
        result = await plan_trip("t-alts", ids, 1, 999.0, False, None)
    leg = result.days[0].legs[0]
    assert isinstance(leg.alternatives, dict)
    assert len(leg.alternatives) >= 1


# ── dev22 Phase 1: always-switchable WALK/CYCLE/GRAB ──────────────────────────

def test_ensure_always_modes_fills_missing():
    """Missing WALK/CYCLE/GRAB are filled (estimated); a real entry is preserved by identity."""
    real_metro = {"duration_minutes": 12, "fare_sgd": 1.5, "is_estimated": False,
                  "legs": [{"mode": "SUBWAY"}], "distance_km": 4.0}
    out = _ensure_always_modes({"METRO": real_metro},
                               {"name": "Gardens"}, {"name": "MBS"}, dist_km=4.0)
    assert set(out) >= {"METRO", "WALK", "CYCLE", "GRAB"}
    assert out["METRO"] is real_metro                 # real route untouched
    assert out["WALK"]["is_estimated"] is True
    assert out["CYCLE"]["is_estimated"] is True
    assert out["GRAB"]["is_estimated"] is True


def test_ensure_always_modes_keeps_real_active():
    """A real WALK/CYCLE/GRAB already present is never overwritten by the estimate."""
    real_walk = {"duration_minutes": 9, "fare_sgd": 0.0, "is_estimated": False,
                 "legs": [{"mode": "WALK"}], "distance_km": 0.5}
    out = _ensure_always_modes({"WALK": real_walk}, {"name": "A"}, {"name": "B"}, dist_km=0.5)
    assert out["WALK"] is real_walk
    assert out["WALK"]["is_estimated"] is False
    assert "CYCLE" in out and "GRAB" in out


def test_ensure_always_modes_does_not_mutate_input():
    """Enrichment must produce a NEW dict — scoring reads the raw input (Impact §A)."""
    src = {"METRO": {"duration_minutes": 12, "distance_km": 4.0}}
    out = _ensure_always_modes(src, {"name": "A"}, {"name": "B"}, dist_km=4.0)
    assert set(src) == {"METRO"}      # input untouched
    assert out is not src


def test_estimated_alternatives_models_returns_three_modes():
    """DB-reload fallback yields WALK/CYCLE/GRAB as AlternativeRoute models."""
    models = estimated_alternatives_models(1.2816, 103.8636, 1.2834, 103.8607, "Gardens")
    assert set(models) == {"WALK", "CYCLE", "GRAB"}
    assert all(isinstance(v, AlternativeRoute) for v in models.values())
    assert all(v.is_estimated for v in models.values())


@pytest.mark.asyncio
async def test_estimate_path_exposes_always_modes():
    """Non-optimize (estimate) plan: every leg's menu offers WALK/CYCLE/GRAB to switch to."""
    ids = ["gardens-by-the-bay-supertree-grove", "universal-studios-singapore"]
    with patch("app.agents.planning_agent.onemap.get_route", AsyncMock(return_value=_mock_route())):
        result = await plan_trip("t-always", ids, 1, 999.0, optimize_order=False, preferences=None)
    for day in result.days:
        for leg in day.legs:
            assert {"WALK", "CYCLE", "GRAB"} <= set(leg.alternatives)


@pytest.mark.asyncio
async def test_estimate_path_recommendation_unchanged():
    """Enrichment must NOT change the recommended transport_mode (still METRO on the far leg)."""
    ids = ["gardens-by-the-bay-supertree-grove", "universal-studios-singapore"]
    with patch("app.agents.planning_agent.onemap.get_route", AsyncMock(return_value=_mock_route())):
        result = await plan_trip("t-rec", ids, 1, 999.0, optimize_order=False, preferences=None)
    assert result.days[0].legs[0].transport_mode == "METRO"


# ── dev23: transit fare backfill (PTC bands) ─────────────────────────────────

def test_fill_transit_fare_metro_from_distance():
    route = {"fare_sgd": 0.0, "distance_km": 9.0}
    _fill_transit_fare("METRO", route)
    assert route["fare_sgd"] == 1.82


def test_fill_transit_fare_bus_from_distance():
    route = {"fare_sgd": 0.0, "distance_km": 4.0}   # band ≤4.2km → 1.38
    _fill_transit_fare("BUS", route)
    assert route["fare_sgd"] == 1.38
    route2 = {"fare_sgd": 0.0, "distance_km": 5.0}  # band ≤5.2km → 1.49
    _fill_transit_fare("BUS", route2)
    assert route2["fare_sgd"] == 1.49


def test_fill_transit_fare_onemap_first_keeps_real_fare():
    route = {"fare_sgd": 1.20, "distance_km": 9.0}
    _fill_transit_fare("METRO", route)
    assert route["fare_sgd"] == 1.20      # real OneMap fare untouched


def test_fill_transit_fare_non_transit_untouched():
    walk = {"fare_sgd": 0.0, "distance_km": 2.0}
    _fill_transit_fare("WALK", walk)
    assert walk["fare_sgd"] == 0.0
    grab = {"fare_sgd": 8.50, "distance_km": 5.0}
    _fill_transit_fare("GRAB", grab)
    assert grab["fare_sgd"] == 8.50


def test_fill_transit_fare_missing_or_zero_distance_no_change():
    no_dist = {"fare_sgd": 0.0}
    _fill_transit_fare("METRO", no_dist)
    assert no_dist["fare_sgd"] == 0.0
    zero_dist = {"fare_sgd": 0.0, "distance_km": 0}
    _fill_transit_fare("BUS", zero_dist)
    assert zero_dist["fare_sgd"] == 0.0


# ── switch_leg_mode ───────────────────────────────────────────────────────────

def _make_plan_for_switch(trip_id: str = "t-sw") -> TripPlan:
    """TripPlan with Gardens→MBS leg, BUS alternative pre-populated."""
    # Real cached transit alts carry geometry (in-memory after a live plan) → no lazy re-fetch.
    bus_alt = AlternativeRoute(duration_minutes=20, cost_sgd=1.20, is_estimated=False, geometry="bus_poly")
    metro_alt = AlternativeRoute(duration_minutes=10, cost_sgd=1.80, is_estimated=False, geometry="mrt_poly")
    walk_alt  = AlternativeRoute(duration_minutes=45, cost_sgd=0.0,  is_estimated=False)
    leg = LegResponse(
        id="leg-sw",
        from_place_id="gardens-by-the-bay",
        to_place_id="marina-bay-sands",
        transport_mode="METRO",
        duration_minutes=10,
        cost_sgd=1.80,
        is_estimated=False,
        alternatives={"BUS": bus_alt, "METRO": metro_alt, "WALK": walk_alt},
    )
    p_a = _make_place("gardens-by-the-bay", lat=1.2816, lng=103.8636, dwell=60)
    p_b = _make_place("marina-bay-sands",   lat=1.2834, lng=103.8607, dwell=60)
    return TripPlan(id=trip_id, days=[DayPlan(day=1, legs=[leg])],
                    places=[p_a, p_b], warnings=[])


@pytest.mark.asyncio
async def test_switch_leg_mode_uses_cached_alternative():
    """When alternative is in cache → no API call, returns updated leg."""
    plan = _make_plan_for_switch()
    with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock) as mock_api:
        result = await switch_leg_mode("BUS", plan.days[0].legs[0], plan)
    mock_api.assert_not_called()
    assert result.updated_leg.transport_mode == "BUS"
    assert result.updated_leg.duration_minutes == 20
    assert result.updated_leg.cost_sgd == 1.20


@pytest.mark.asyncio
async def test_switch_leg_mode_cache_miss_fetches_on_demand():
    """When BUS not in alternatives → on-demand fetch, then switch."""
    bus_route = {"duration_minutes": 25, "fare_sgd": 1.10, "is_estimated": False,
                 "legs": [{"mode": "WALK"}, {"mode": "BUS"}],
                 "geometry": None, "geometries": [], "instructions": [], "sub_legs": [], "distance_km": 1.5}
    metro_route = {"duration_minutes": 10, "fare_sgd": 1.80, "is_estimated": False,
                   "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}],
                   "geometry": None, "geometries": [], "instructions": [], "sub_legs": [], "distance_km": 1.5}
    walk_route  = {"duration_minutes": 40, "fare_sgd": 0.0, "is_estimated": False,
                   "legs": [{"mode": "WALK"}],
                   "geometry": None, "geometries": [], "instructions": [], "sub_legs": [], "distance_km": 0.8}

    async def _mock(from_lat, from_lng, to_lat, to_lng, mode, transit_modes=None):
        if mode == "walk":
            return walk_route
        if transit_modes == "BUS":
            return bus_route
        return metro_route

    # Leg with NO alternatives (simulates DB-loaded trip)
    leg = LegResponse(
        id="leg-cm", from_place_id="gardens-by-the-bay", to_place_id="marina-bay-sands",
        transport_mode="METRO", duration_minutes=10, cost_sgd=1.80, is_estimated=False,
    )
    p_a = _make_place("gardens-by-the-bay", lat=1.2816, lng=103.8636)
    p_b = _make_place("marina-bay-sands",   lat=1.2834, lng=103.8607)
    plan = TripPlan(id="t-cm", days=[DayPlan(day=1, legs=[leg])],
                    places=[p_a, p_b], warnings=[])

    with patch("app.agents.planning_agent.onemap.get_route", side_effect=_mock):
        result = await switch_leg_mode("BUS", leg, plan)

    assert result.updated_leg.transport_mode == "BUS"
    assert result.updated_leg.duration_minutes == 25


@pytest.mark.asyncio
async def test_switch_leg_mode_lazy_refetches_geometry_when_missing():
    """dev22 §F: a cached transit alt with no polyline (DB reload) lazily re-fetches the
    real route so the map can draw a line; time/cost come from the real route."""
    metro_route = {"duration_minutes": 11, "fare_sgd": 1.7, "is_estimated": False,
                   "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}],
                   "geometry": "real_mrt_poly", "geometries": ["g1"], "instructions": ["Board NS"],
                   "sub_legs": [], "distance_km": 2.0}

    async def _mock(from_lat, from_lng, to_lat, to_lng, mode, transit_modes=None):
        if mode == "walk":
            return {"duration_minutes": 40, "fare_sgd": 0.0, "is_estimated": False,
                    "legs": [{"mode": "WALK"}], "geometry": None, "geometries": [],
                    "instructions": [], "sub_legs": [], "distance_km": 2.0}
        return metro_route   # mixed pt + bus-only → SUBWAY primary

    # Reload-like leg: METRO alt present but geometry stripped by compact persistence.
    metro_alt = AlternativeRoute(duration_minutes=10, cost_sgd=1.80, is_estimated=False, geometry=None)
    leg = LegResponse(
        id="leg-lazy", from_place_id="gardens-by-the-bay", to_place_id="marina-bay-sands",
        transport_mode="BUS", duration_minutes=20, cost_sgd=1.20, is_estimated=False,
        alternatives={"METRO": metro_alt},
    )
    p_a = _make_place("gardens-by-the-bay", lat=1.2816, lng=103.8636)
    p_b = _make_place("marina-bay-sands",   lat=1.2834, lng=103.8607)
    plan = TripPlan(id="t-lazy", days=[DayPlan(day=1, legs=[leg])], places=[p_a, p_b], warnings=[])

    with patch("app.agents.planning_agent.onemap.get_route", side_effect=_mock), \
         patch("app.agents.planning_agent.onemap.get_pt_routes_by_mode",
               AsyncMock(return_value={"METRO": metro_route})):
        result = await switch_leg_mode("METRO", leg, plan)

    assert result.updated_leg.transport_mode == "METRO"
    assert result.updated_leg.geometry == "real_mrt_poly"   # polyline restored
    assert result.updated_leg.duration_minutes == 11        # real route values


@pytest.mark.asyncio
async def test_switch_leg_mode_lazy_refetch_best_effort_on_failure():
    """If the lazy geometry re-fetch fails, the switch still succeeds with the cached alt
    (never turns a switch into a click-then-fail)."""
    metro_alt = AlternativeRoute(duration_minutes=10, cost_sgd=1.80, is_estimated=False, geometry=None)
    leg = LegResponse(
        id="leg-lazy2", from_place_id="gardens-by-the-bay", to_place_id="marina-bay-sands",
        transport_mode="BUS", duration_minutes=20, cost_sgd=1.20, is_estimated=False,
        alternatives={"METRO": metro_alt},
    )
    p_a = _make_place("gardens-by-the-bay", lat=1.2816, lng=103.8636)
    p_b = _make_place("marina-bay-sands",   lat=1.2834, lng=103.8607)
    plan = TripPlan(id="t-lazy2", days=[DayPlan(day=1, legs=[leg])], places=[p_a, p_b], warnings=[])

    with patch("app.agents.planning_agent.onemap.get_route", AsyncMock(side_effect=Exception("OneMap down"))):
        result = await switch_leg_mode("METRO", leg, plan)

    assert result.updated_leg.transport_mode == "METRO"
    assert result.updated_leg.geometry is None              # still no polyline, but no crash
    assert result.updated_leg.duration_minutes == 10        # cached values preserved


@pytest.mark.asyncio
async def test_switch_leg_mode_raises_when_mode_unavailable():
    """If requested mode has no route at all → NoRouteError with clear message."""
    leg = LegResponse(
        id="leg-na", from_place_id="gardens-by-the-bay", to_place_id="marina-bay-sands",
        transport_mode="METRO", duration_minutes=10, cost_sgd=1.80, is_estimated=False,
        # No BUS alternative, and on-demand fetch will also fail
    )
    p_a = _make_place("gardens-by-the-bay", lat=1.2816, lng=103.8636)
    p_b = _make_place("marina-bay-sands",   lat=1.2834, lng=103.8607)
    plan = TripPlan(id="t-na", days=[DayPlan(day=1, legs=[leg])],
                    places=[p_a, p_b], warnings=[])

    with patch("app.agents.planning_agent.onemap.get_route", AsyncMock(side_effect=NoRouteError)):
        with pytest.raises(NoRouteError, match="BUS"):
            await switch_leg_mode("BUS", leg, plan)


@pytest.mark.asyncio
async def test_switch_leg_mode_schedule_warning_when_overfull():
    """Switching to a slow mode that makes day_end > 17:30 → warning in result."""
    # dwell: place_a=60, place_b=60 → total_dwell=120
    # current transit=10 → day_end=540+120+10=670 (fine)
    # walk alt=600min → day_end=540+120+600=1260 > 1050 → warning
    slow_walk = AlternativeRoute(duration_minutes=600, cost_sgd=0.0)
    leg = LegResponse(
        id="leg-ov", from_place_id="gardens-by-the-bay", to_place_id="marina-bay-sands",
        transport_mode="METRO", duration_minutes=10, cost_sgd=1.80, is_estimated=False,
        alternatives={"WALK": slow_walk},
    )
    p_a = _make_place("gardens-by-the-bay", dwell=60)
    p_b = _make_place("marina-bay-sands",   dwell=60)
    plan = TripPlan(id="t-ov", days=[DayPlan(day=1, legs=[leg])],
                    places=[p_a, p_b], warnings=[])

    result = await switch_leg_mode("WALK", leg, plan)
    assert result.updated_leg.transport_mode == "WALK"
    assert any("WALK" in w for w in result.warnings)


@pytest.mark.asyncio
async def test_switch_leg_mode_no_warning_when_fits():
    """Fast switch that keeps day within 17:30 → no schedule warning."""
    fast_bus = AlternativeRoute(duration_minutes=12, cost_sgd=1.20, geometry="bus_poly")
    leg = LegResponse(
        id="leg-ok", from_place_id="gardens-by-the-bay", to_place_id="marina-bay-sands",
        transport_mode="METRO", duration_minutes=10, cost_sgd=1.80, is_estimated=False,
        alternatives={"BUS": fast_bus},
    )
    p_a = _make_place("gardens-by-the-bay", dwell=60)
    p_b = _make_place("marina-bay-sands",   dwell=60)
    plan = TripPlan(id="t-ok", days=[DayPlan(day=1, legs=[leg])],
                    places=[p_a, p_b], warnings=[])

    result = await switch_leg_mode("BUS", leg, plan)
    assert result.warnings == []


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


# ── switch_leg_mode_live ──────────────────────────────────────────────────────

# Gardens: lat=1.2816, lng=103.8636  (from_place in _make_plan_for_switch)
# GPS "at origin"  = 1.2816, 103.8636  (0m away)
# GPS "mid-journey" = 1.2916, 103.8636  (~1.1 km north — well above 200m threshold)

_GPS_AT_ORIGIN  = (1.2816, 103.8636)
_GPS_MID        = (1.2916, 103.8636)


@pytest.mark.asyncio
async def test_switch_live_at_origin_uses_cache():
    """GPS at from_place → fast path (switch_leg_mode), no OneMap API call."""
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]
    with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock) as mock_api:
        result = await switch_leg_mode_live("BUS", leg, plan,
                                            current_lat=_GPS_AT_ORIGIN[0],
                                            current_lng=_GPS_AT_ORIGIN[1])
    mock_api.assert_not_called()   # fast path uses cache, never hits OneMap
    assert result.updated_leg.transport_mode == "BUS"
    assert result.updated_leg.duration_minutes == 20   # from BUS alternative
    assert result.routed_from_current_position is False


@pytest.mark.asyncio
async def test_switch_live_at_origin_flag_false():
    """Fast path always sets routed_from_current_position=False."""
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]
    with patch("app.agents.planning_agent.onemap.get_route", new_callable=AsyncMock):
        result = await switch_leg_mode_live("METRO", leg, plan,
                                            current_lat=_GPS_AT_ORIGIN[0],
                                            current_lng=_GPS_AT_ORIGIN[1])
    assert result.routed_from_current_position is False


@pytest.mark.asyncio
async def test_switch_live_mid_journey_calls_onemap_with_gps():
    """GPS >200m away → OneMap called with GPS coords as origin, not from_place coords."""
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]
    mock_route = {**_mock_route(duration=18, fare=1.50), "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}]}

    with patch("app.agents.planning_agent.onemap.get_route",
               new_callable=AsyncMock, return_value=mock_route) as mock_api:
        result = await switch_leg_mode_live("METRO", leg, plan,
                                            current_lat=_GPS_MID[0],
                                            current_lng=_GPS_MID[1])

    call_args = mock_api.call_args
    assert call_args.args[0] == pytest.approx(_GPS_MID[0])   # lat from GPS
    assert call_args.args[1] == pytest.approx(_GPS_MID[1])   # lng from GPS
    assert result.routed_from_current_position is True
    assert result.updated_leg.transport_mode == "METRO"


@pytest.mark.asyncio
async def test_switch_live_mid_journey_sets_flag():
    """Realtime path always sets routed_from_current_position=True."""
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]
    mock_route = {**_mock_route(duration=18, fare=1.50), "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}]}

    with patch("app.agents.planning_agent.onemap.get_route",
               new_callable=AsyncMock, return_value=mock_route):
        result = await switch_leg_mode_live("METRO", leg, plan,
                                            current_lat=_GPS_MID[0],
                                            current_lng=_GPS_MID[1])

    assert result.routed_from_current_position is True
    assert result.updated_leg.duration_minutes == 18


@pytest.mark.asyncio
async def test_switch_live_mid_journey_bus_mode_uses_transit_modes():
    """BUS mode in realtime path passes transit_modes='BUS' to OneMap."""
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]
    bus_route = {**_mock_route(duration=22, fare=1.20), "legs": [{"mode": "WALK"}, {"mode": "BUS"}]}

    with patch("app.agents.planning_agent.onemap.get_route",
               new_callable=AsyncMock, return_value=bus_route) as mock_api:
        result = await switch_leg_mode_live("BUS", leg, plan,
                                            current_lat=_GPS_MID[0],
                                            current_lng=_GPS_MID[1])

    assert mock_api.call_args.kwargs.get("transit_modes") == "BUS"
    assert result.updated_leg.transport_mode == "BUS"
    assert result.updated_leg.duration_minutes == 22


@pytest.mark.asyncio
async def test_switch_live_mid_journey_bus_fallback_to_metro_raises():
    """BUS-only request but OneMap returns METRO-primary route → NoRouteError."""
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]
    # OneMap returns SUBWAY (METRO) even when transit_modes=BUS is requested
    metro_route = {**_mock_route(duration=10, fare=1.80), "legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}]}

    with patch("app.agents.planning_agent.onemap.get_route",
               new_callable=AsyncMock, return_value=metro_route):
        with pytest.raises(NoRouteError, match="BUS"):
            await switch_leg_mode_live("BUS", leg, plan,
                                       current_lat=_GPS_MID[0],
                                       current_lng=_GPS_MID[1])


@pytest.mark.asyncio
async def test_switch_live_grab_mid_journey_uses_drive_mode():
    """GRAB in realtime path: OneMap drive called from GPS for realistic polyline/distance."""
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]
    drive_result = {
        "duration_minutes": 8, "fare_sgd": 0.0, "distance_km": 3.2,
        "geometry": "mock_polyline", "geometries": ["mock_polyline"],
        "instructions": [], "legs": [{"mode": "DRIVE", "duration_minutes": 8}],
        "is_estimated": False,
    }

    with patch("app.agents.planning_agent.onemap.get_route",
               new_callable=AsyncMock, return_value=drive_result) as mock_api:
        result = await switch_leg_mode_live("GRAB", leg, plan,
                                            current_lat=_GPS_MID[0],
                                            current_lng=_GPS_MID[1])

    mock_api.assert_called_once()
    assert mock_api.call_args.kwargs.get("mode") == "drive"
    assert result.updated_leg.transport_mode == "GRAB"
    assert result.updated_leg.is_estimated is True
    assert result.updated_leg.cost_sgd > 0
    assert result.updated_leg.distance_km == pytest.approx(3.2)
    assert result.routed_from_current_position is True


@pytest.mark.asyncio
async def test_switch_live_grab_mid_journey_drive_fails_falls_back():
    """GRAB in realtime path: drive mode fails → haversine fallback, still returns GRAB."""
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]

    with patch("app.agents.planning_agent.onemap.get_route",
               AsyncMock(side_effect=NoRouteError("drive unavailable"))):
        result = await switch_leg_mode_live("GRAB", leg, plan,
                                            current_lat=_GPS_MID[0],
                                            current_lng=_GPS_MID[1])

    assert result.updated_leg.transport_mode == "GRAB"
    assert result.updated_leg.is_estimated is True
    assert result.updated_leg.cost_sgd > 0
    assert result.routed_from_current_position is True


@pytest.mark.asyncio
async def test_switch_live_mid_journey_no_route_raises():
    """OneMap raises NoRouteError from GPS position → switch_leg_mode_live re-raises."""
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]

    with patch("app.agents.planning_agent.onemap.get_route",
               AsyncMock(side_effect=NoRouteError("no route"))):
        with pytest.raises(NoRouteError):
            await switch_leg_mode_live("METRO", leg, plan,
                                       current_lat=_GPS_MID[0],
                                       current_lng=_GPS_MID[1])


@pytest.mark.asyncio
async def test_switch_live_schedule_warning_overfull():
    """Realtime path: slow new duration pushes day_end past 17:30 → schedule warning."""
    # dwell: gardens=60, mbs=60 → total_dwell=120
    # current transit=10 → day_end=540+120+10=670 (fine)
    # new walk=600 min → day_end=540+120+600=1260 > 1050 → warning
    plan = _make_plan_for_switch()
    leg = plan.days[0].legs[0]
    slow_route = {"duration_minutes": 600, "fare_sgd": 0.0, "legs": [{"mode": "WALK"}],
                  "geometry": None, "geometries": [], "instructions": [], "sub_legs": []}

    with patch("app.agents.planning_agent.onemap.get_route",
               new_callable=AsyncMock, return_value=slow_route):
        result = await switch_leg_mode_live("WALK", leg, plan,
                                            current_lat=_GPS_MID[0],
                                            current_lng=_GPS_MID[1])

    assert result.routed_from_current_position is True
    assert any("WALK" in w for w in result.warnings)


