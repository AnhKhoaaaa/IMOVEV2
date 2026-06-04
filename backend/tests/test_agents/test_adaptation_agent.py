import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents.adaptation_agent import (
    poll_lta_alerts,
    poll_weather_alerts,
    adapt_trip,
    check_alerts_for_trip,
    _nearest_indoor,
    _apply_weather_swap,
    _leg_uses_disrupted_line,
    _reroute_mrt_legs,
)
from app.agents.planning_agent import _PLACES
from app.models.trip import TripPlan, DayPlan, LegResponse, AdaptResponse
from app.models.place import Place
from app.services.lta import LTAUnavailableError
from app.services.openweather import WeatherUnavailableError


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_supabase_mock(trips=None, legs=None, places_data=None, alert=None):
    """Build a mock Supabase client with configurable return data.
    Returns the same table mock object for each table name (cached)."""
    sb = MagicMock()
    # _nearest_indoor calls supabase.rpc("find_nearest_indoor", ...) directly on the
    # client (not via .table()). Return a real-looking indoor place dict so that:
    # (a) poll/check functions see a truthy result and proceed to insert alerts, and
    # (b) _apply_weather_swap gets a valid string id — not a MagicMock — preventing
    #     Pydantic ValidationError when building the swapped LegResponse.
    sb.rpc.return_value.execute.return_value = MagicMock(data=[{
        "id": "artscience-museum",
        "name": "ArtScience Museum",
        "lat": 1.2863,
        "lng": 103.8593,
        "is_outdoor": False,
        "dwell_minutes": 120,
        "best_time_start": "10:00",
        "best_time_end": "22:00",
        "category": "museum",
        "in_curated_dataset": True,
    }])
    _cache: dict = {}

    def _table(name):
        if name in _cache:
            return _cache[name]
        t = MagicMock()
        t.select.return_value = t
        t.insert.return_value = t
        t.update.return_value = t
        t.upsert.return_value = t
        t.eq.return_value = t
        t.in_.return_value = t
        t.is_.return_value = t
        t.gte.return_value = t

        if name == "trips":
            t.execute.return_value = MagicMock(data=trips or [])
        elif name == "route_legs":
            t.execute.return_value = MagicMock(data=legs or [])
        elif name == "trip_places":
            t.execute.return_value = MagicMock(data=places_data or [])
        elif name == "lta_alerts":
            t.execute.return_value = MagicMock(data=alert or [])
        else:
            t.execute.return_value = MagicMock(data=[])
        _cache[name] = t
        return t

    sb.table.side_effect = _table
    return sb


def _make_plan(trip_id="t1", transport_mode="METRO") -> TripPlan:
    leg = LegResponse(
        id="leg-1",
        from_place_id="gardens-by-the-bay",
        to_place_id="marina-bay-sands",
        transport_mode=transport_mode,
        duration_minutes=15,
        cost_sgd=1.80,
        is_estimated=False,
    )
    places = [
        Place(id="gardens-by-the-bay", name="Gardens by the Bay",
              lat=1.2816, lng=103.8636, dwell_minutes=180,
              best_time_start="08:00", best_time_end="11:00",
              category="nature", is_outdoor=True, in_curated_dataset=True),
        Place(id="marina-bay-sands", name="Marina Bay Sands",
              lat=1.2834, lng=103.8607, dwell_minutes=120,
              best_time_start="10:00", best_time_end="22:00",
              category="landmark", is_outdoor=False, in_curated_dataset=True),
    ]
    return TripPlan(id=trip_id, days=[DayPlan(day=1, legs=[leg])], places=places, warnings=[])


# ── poll_lta_alerts ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_poll_lta_no_supabase_returns_immediately():
    # When supabase is None, function should return without error
    with patch("app.agents.adaptation_agent.supabase", None):
        await poll_lta_alerts()  # Should not raise


@pytest.mark.asyncio
async def test_poll_lta_no_active_trips_skips_lta_call():
    sb = _make_supabase_mock(trips=[])
    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.lta.get_train_alerts", new_callable=AsyncMock) as mock_lta:
            await poll_lta_alerts()
    mock_lta.assert_not_called()


@pytest.mark.asyncio
async def test_poll_lta_unavailable_inserts_service_unavailable():
    # Trip must have an MRT leg; otherwise function returns early without alerting
    sb = _make_supabase_mock(
        trips=[{"id": "trip-1"}],
        legs=[{"trip_id": "trip-1", "transport_mode": "MRT"}],
    )
    inserted_rows = []

    def capture_insert(row):
        inserted_rows.append(row)
        m = MagicMock()
        m.execute.return_value = MagicMock(data=[])
        return m

    sb.table("lta_alerts").insert = capture_insert

    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.lta.get_train_alerts",
                   new_callable=AsyncMock,
                   side_effect=LTAUnavailableError("LTA down")):
            await poll_lta_alerts()

    assert len(inserted_rows) == 1
    assert inserted_rows[0]["alert_type"] == "service_unavailable"
    assert inserted_rows[0]["trip_id"] == "trip-1"


@pytest.mark.asyncio
async def test_poll_lta_normal_no_alerts_no_insert():
    sb = _make_supabase_mock(
        trips=[{"id": "trip-1"}],
        legs=[{"trip_id": "trip-1", "transport_mode": "MRT"}],
    )
    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.lta.get_train_alerts",
                   new_callable=AsyncMock,
                   return_value=[]):  # No disruptions
            await poll_lta_alerts()
    # lta_alerts insert should not be called
    assert not sb.table("lta_alerts").insert.called


# ── poll_weather_alerts ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_poll_weather_unavailable_does_not_crash():
    with patch("app.agents.adaptation_agent.supabase", None):
        await poll_weather_alerts()  # No supabase → return immediately


@pytest.mark.asyncio
async def test_poll_weather_error_does_not_crash():
    sb = _make_supabase_mock(trips=[{"id": "trip-1"}])
    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.openweather.get_forecast",
                   new_callable=AsyncMock,
                   side_effect=WeatherUnavailableError("API down")):
            await poll_weather_alerts()  # Should log warning and return, not raise


@pytest.mark.asyncio
async def test_poll_weather_low_rain_no_alert():
    sb = _make_supabase_mock(trips=[{"id": "trip-1"}])
    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.openweather.get_forecast",
                   new_callable=AsyncMock,
                   return_value={"rain_probability": 30, "condition": "Clear", "date": "2026-05-20", "temp_max": 32, "temp_min": 26}):
            await poll_weather_alerts()

    # No alert should be inserted
    calls = [str(call) for call in sb.table.call_args_list]
    assert not any("lta_alerts" in c for c in calls)


@pytest.mark.asyncio
async def test_poll_weather_high_rain_with_outdoor_places_inserts_alert():
    outdoor_place_id = "gardens-by-the-bay-supertree-grove"  # is_outdoor=True in _PLACES
    # places_data now includes trip_id because poll_weather_alerts uses a bulk IN query
    sb = _make_supabase_mock(
        trips=[{"id": "trip-1"}],
        places_data=[{"trip_id": "trip-1", "place_id": outdoor_place_id}],
    )
    insert_calls = []

    def track_insert(rows):
        insert_calls.append(rows)
        m = MagicMock()
        m.execute.return_value = MagicMock(data=[])
        return m

    sb.table("lta_alerts").insert = track_insert

    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.openweather.get_forecast",
                   new_callable=AsyncMock,
                   return_value={"rain_probability": 80, "condition": "Rain",
                                 "date": "2026-05-20", "temp_max": 29, "temp_min": 25}):
            await poll_weather_alerts()

    assert len(insert_calls) == 1
    assert insert_calls[0]["alert_type"] == "weather_warning"
    assert "80%" in insert_calls[0]["message"]


# ── adapt_trip ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_adapt_trip_no_supabase_returns_unchanged():
    plan = _make_plan()
    with patch("app.agents.adaptation_agent.supabase", None):
        result = await adapt_trip("t1", "alert-1", plan)
    assert result.adapted is False
    assert result.updated_trip == plan


@pytest.mark.asyncio
async def test_adapt_trip_alert_not_found_returns_unchanged():
    plan = _make_plan()
    sb = _make_supabase_mock(alert=[])
    with patch("app.agents.adaptation_agent.supabase", sb):
        result = await adapt_trip("t1", "no-such-alert", plan)
    assert result.adapted is False


@pytest.mark.asyncio
async def test_adapt_trip_train_delay_reroutes_mrt_legs():
    plan = _make_plan(transport_mode="METRO")
    alert_data = [{"id": "alert-1", "alert_type": "train_delay", "affected_line": "NS", "message": "Delay"}]
    sb = _make_supabase_mock(alert=alert_data)

    mock_route = {"duration_minutes": 20, "fare_sgd": 1.60, "legs": [{"mode": "BUS"}]}
    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.onemap.get_route",
                   new_callable=AsyncMock, return_value=mock_route):
            result = await adapt_trip("t1", "alert-1", plan)

    assert result.adapted is True
    rerouted_leg = result.updated_trip.days[0].legs[0]
    assert rerouted_leg.transport_mode == "BUS"
    assert rerouted_leg.duration_minutes == 20
    assert rerouted_leg.is_estimated is False


@pytest.mark.asyncio
async def test_adapt_trip_train_delay_onemap_fails_keeps_original():
    plan = _make_plan(transport_mode="METRO")
    alert_data = [{"id": "alert-1", "alert_type": "train_delay", "affected_line": "NS", "message": "Delay"}]
    sb = _make_supabase_mock(alert=alert_data)

    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.onemap.get_route",
                   new_callable=AsyncMock, side_effect=Exception("Network error")):
            result = await adapt_trip("t1", "alert-1", plan)

    # When rerouting fails, keep original leg
    leg = result.updated_trip.days[0].legs[0]
    assert leg.transport_mode == "METRO"
    assert result.adapted is False  # No changes were made


@pytest.mark.asyncio
async def test_adapt_trip_weather_swap_outdoor_to_indoor():
    plan = _make_plan(transport_mode="WALK")
    alert_data = [{"id": "alert-1", "alert_type": "weather_warning", "message": "Rain 80%"}]
    sb = _make_supabase_mock(alert=alert_data)

    # gardens-by-the-bay is outdoor in _PLACES — should be swapped
    mock_route = {"duration_minutes": 10, "fare_sgd": 0.0, "legs": [{"mode": "WALK"}]}
    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.onemap.get_route",
                   new_callable=AsyncMock, return_value=mock_route):
            result = await adapt_trip("t1", "alert-1", plan)

    assert result.adapted is True
    # The outdoor place (gardens-by-the-bay) must be replaced — not in final places
    swapped_ids = {p.id for p in result.updated_trip.places}
    assert "gardens-by-the-bay" not in swapped_ids
    # Leg must have been recalculated via OneMap (not estimated fallback)
    leg = result.updated_trip.days[0].legs[0]
    assert leg.is_estimated is False
    assert leg.duration_minutes == 10  # matches mock_route


# ── _nearest_indoor ───────────────────────────────────────────────────────────

def test_nearest_indoor_finds_within_2km():
    # Merlion Park (outdoor) at 1.28681, 103.85453 — fullerton-hotel-singapore (indoor) ~0.18 km away
    result = _nearest_indoor(1.28681, 103.85453, exclude_ids={"merlion-park"})
    assert result is not None
    assert result["is_outdoor"] is False


def test_nearest_indoor_excludes_self():
    # From Merlion Park area, excluding the nearest indoor (fullerton-hotel-singapore)
    # must force a different indoor result.
    result = _nearest_indoor(1.28681, 103.85453, exclude_ids={"fullerton-hotel-singapore"})
    assert result is None or result["id"] != "fullerton-hotel-singapore"


def test_nearest_indoor_excludes_already_chosen_target():
    """Bug #2: if the nearest indoor is already in the plan, it must be skipped."""
    # From Merlion Park coords, fullerton-hotel-singapore is nearest indoor (~0.18 km).
    # Passing it in exclude_ids must force the function to return the *next* nearest instead.
    first = _nearest_indoor(1.28681, 103.85453, exclude_ids={"merlion-park"})
    assert first is not None
    first_id = first["id"]

    # Now exclude that first result too — function must return a different place
    second = _nearest_indoor(1.28681, 103.85453, exclude_ids={"merlion-park", first_id})
    assert second is None or second["id"] != first_id


def test_apply_weather_swap_no_duplicate_targets():
    """Bug #1: two outdoor places must not both be swapped to the same indoor target."""
    # Two outdoor places that are close together → both would normally map to MBS
    place_a = Place(id="merlion-park", name="Merlion Park",
                    lat=1.2868, lng=103.8545, dwell_minutes=30,
                    best_time_start="07:00", best_time_end="10:00",
                    category="landmark", is_outdoor=True, in_curated_dataset=True)
    place_b = Place(id="marina-barrage", name="Marina Barrage",
                    lat=1.2795, lng=103.8712, dwell_minutes=60,
                    best_time_start="09:00", best_time_end="21:00",
                    category="viewpoint", is_outdoor=True, in_curated_dataset=True)
    leg = LegResponse(id="leg-x", from_place_id="merlion-park", to_place_id="marina-barrage",
                      transport_mode="WALK", duration_minutes=20, cost_sgd=0.0, is_estimated=False)
    plan = TripPlan(id="t-dup", days=[DayPlan(day=1, legs=[leg])],
                    places=[place_a, place_b], warnings=[])

    import asyncio

    async def _run():
        with patch("app.agents.adaptation_agent.onemap.get_route",
                   new_callable=AsyncMock,
                   return_value={"duration_minutes": 10, "fare_sgd": 0.0,
                                 "legs": [{"mode": "WALK"}], "sub_legs": [],
                                 "geometry": None, "geometries": [], "instructions": []}):
            return await _apply_weather_swap(plan)

    updated_plan, changes = asyncio.run(_run())

    swapped_ids = [p.id for p in updated_plan.places]
    # No duplicate: if both outdoor places were swapped, their targets must differ
    assert len(swapped_ids) == len(set(swapped_ids)), (
        f"Duplicate swap target detected: {swapped_ids}"
    )


# ── _leg_uses_disrupted_line — bulletproof mode-first check ──────────────────

def test_leg_uses_disrupted_line_detects_metro_leg():
    sub_legs = [
        {"mode": "WALK", "route": ""},
        {"mode": "METRO", "route": "EW12"},     # disrupted EWL
        {"mode": "WALK", "route": ""},
    ]
    assert _leg_uses_disrupted_line(sub_legs, {"EW"}) is True


def test_leg_uses_disrupted_line_ignores_bus_with_mrt_code_in_name():
    """Bus stop names in Singapore often contain MRT line codes (e.g. 'Bugis Stn Exit B EW12').
    The helper must NOT flag these BUS sub-legs as disrupted METRO legs."""
    sub_legs = [
        # Bus sub-leg whose from_name/route contains "EW12" as wayfinding hint
        {"mode": "BUS", "route": "EW12", "from_name": "Bugis Stn Exit B EW12"},
    ]
    assert _leg_uses_disrupted_line(sub_legs, {"EW"}) is False


def test_leg_uses_disrupted_line_returns_false_when_different_line():
    sub_legs = [{"mode": "METRO", "route": "NS27"}]   # North South Line — not disrupted
    assert _leg_uses_disrupted_line(sub_legs, {"EW"}) is False


def test_leg_uses_disrupted_line_returns_false_on_empty_prefixes():
    sub_legs = [{"mode": "METRO", "route": "EW12"}]
    assert _leg_uses_disrupted_line(sub_legs, set()) is False


def test_leg_uses_disrupted_line_returns_false_on_empty_sub_legs():
    assert _leg_uses_disrupted_line([], {"EW"}) is False


# ── _reroute_mrt_legs — post-filter + retry ───────────────────────────────────

@pytest.mark.asyncio
async def test_reroute_detects_disrupted_line_and_retries_bus_only():
    """When PT result still routes via disrupted EWL, we must retry with transit_modes=BUS."""
    plan = _make_plan(transport_mode="METRO")

    # Step 1 (PT): returns a route with an EWL METRO sub_leg → triggers retry
    pt_route = {
        "duration_minutes": 25, "fare_sgd": 1.80,
        "legs": [{"mode": "SUBWAY"}],
        "sub_legs": [{"mode": "METRO", "route": "EW2", "from_stop_code": ""}],
        "geometry": None, "geometries": [], "instructions": [], "distance_km": 3.0,
    }
    # Step 2 (BUS retry): returns a clean bus route
    bus_route = {
        "duration_minutes": 35, "fare_sgd": 1.20,
        "legs": [{"mode": "BUS"}],
        "sub_legs": [{"mode": "BUS", "route": "65", "from_stop_code": "83139"}],
        "geometry": None, "geometries": [], "instructions": [], "distance_km": 3.5,
    }

    call_args: list = []

    async def mock_get_route(*args, **kwargs):
        call_args.append(kwargs.get("transit_modes"))
        if kwargs.get("transit_modes") == "BUS":
            return bus_route
        return pt_route

    with patch("app.agents.adaptation_agent.onemap.get_route", side_effect=mock_get_route):
        updated_plan, changes = await _reroute_mrt_legs(plan, disrupted_lines=["East West Line"])

    # Two calls: first PT, then BUS retry
    assert len(call_args) == 2
    assert call_args[0] is None        # first call: no transit_modes filter
    assert call_args[1] == "BUS"       # retry: BUS-only

    leg = updated_plan.days[0].legs[0]
    assert leg.transport_mode == "BUS"
    assert leg.duration_minutes == 35
    assert leg.first_bus_stop_code == "83139"
    assert len(changes) == 1


@pytest.mark.asyncio
async def test_reroute_skips_retry_when_otp_already_avoids_disrupted_line():
    """If OTP routes around the disruption (no EW sub-leg), no retry should happen."""
    plan = _make_plan(transport_mode="METRO")

    # PT result uses NS line (not disrupted)
    pt_route = {
        "duration_minutes": 20, "fare_sgd": 1.60,
        "legs": [{"mode": "SUBWAY"}],
        "sub_legs": [{"mode": "METRO", "route": "NS27", "from_stop_code": ""}],
        "geometry": None, "geometries": [], "instructions": [], "distance_km": 2.5,
    }

    call_count = 0

    async def mock_get_route(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return pt_route

    with patch("app.agents.adaptation_agent.onemap.get_route", side_effect=mock_get_route):
        updated_plan, changes = await _reroute_mrt_legs(plan, disrupted_lines=["East West Line"])

    assert call_count == 1    # only one call — no retry needed
    assert updated_plan.days[0].legs[0].transport_mode == "METRO"
    assert changes == []


@pytest.mark.asyncio
async def test_reroute_bus_with_mrt_code_in_stop_name_not_falsely_retried():
    """BUS sub-leg whose stop name contains 'EW12' must NOT trigger a retry."""
    plan = _make_plan(transport_mode="METRO")

    pt_route = {
        "duration_minutes": 30, "fare_sgd": 1.20,
        "legs": [{"mode": "BUS"}],
        # BUS sub-leg, route field happens to start with "EW" as a bus route name
        "sub_legs": [{"mode": "BUS", "route": "EW", "from_stop_code": "99999",
                      "from_name": "Bugis Stn Exit B EW12"}],
        "geometry": None, "geometries": [], "instructions": [], "distance_km": 3.0,
    }

    call_count = 0

    async def mock_get_route(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return pt_route

    with patch("app.agents.adaptation_agent.onemap.get_route", side_effect=mock_get_route):
        updated_plan, _ = await _reroute_mrt_legs(plan, disrupted_lines=["East West Line"])

    assert call_count == 1   # no retry — BUS sub-leg was correctly ignored


@pytest.mark.asyncio
async def test_reroute_fallback_keeps_original_when_bus_also_unavailable():
    """When BUS retry also raises NoRouteError, keep original leg + is_estimated=True."""
    plan = _make_plan(transport_mode="METRO")

    pt_route = {
        "duration_minutes": 25, "fare_sgd": 1.80,
        "legs": [{"mode": "SUBWAY"}],
        "sub_legs": [{"mode": "METRO", "route": "EW12", "from_stop_code": ""}],
        "geometry": None, "geometries": [], "instructions": [], "distance_km": 3.0,
    }

    from app.services.onemap import NoRouteError

    async def mock_get_route(*args, **kwargs):
        if kwargs.get("transit_modes") == "BUS":
            raise NoRouteError("No bus route")
        return pt_route

    with patch("app.agents.adaptation_agent.onemap.get_route", side_effect=mock_get_route):
        updated_plan, changes = await _reroute_mrt_legs(plan, disrupted_lines=["East West Line"])

    leg = updated_plan.days[0].legs[0]
    assert leg.transport_mode == "METRO"   # kept original mode
    assert leg.is_estimated is True        # flagged as estimated
    assert changes == []                   # no change recorded
    # Warning must be added to plan
    assert any("retained" in w for w in updated_plan.warnings)


# ── check_alerts_for_trip ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_check_alerts_for_trip_no_supabase_returns_zero():
    plan = _make_plan(transport_mode="METRO")
    with patch("app.agents.adaptation_agent.supabase", None):
        result = await check_alerts_for_trip("t1", plan)
    assert result == {"lta_checked": False, "weather_checked": False, "alerts_inserted": 0}


@pytest.mark.asyncio
async def test_check_alerts_for_trip_lta_inserts_on_disruption():
    """Plan with METRO leg + active LTA alert → alert should be inserted."""
    plan = _make_plan(transport_mode="METRO")
    sb = _make_supabase_mock()
    # Simulate no existing dedup row (empty data)
    sb.table("lta_alerts").execute.return_value = MagicMock(data=[])

    train_alert = [{"affected_line": "East West Line", "message": "Disruption on EWL"}]

    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.lta.get_train_alerts",
                   new_callable=AsyncMock, return_value=train_alert):
            result = await check_alerts_for_trip("t1", plan)

    assert result["lta_checked"] is True
    assert result["alerts_inserted"] >= 1
    # Verify insert was called on lta_alerts table
    insert_calls = [
        call_args[0][0]
        for call_args in sb.table("lta_alerts").insert.call_args_list
        if call_args[0]
    ]
    assert any(c.get("alert_type") == "train_delay" for c in insert_calls)


@pytest.mark.asyncio
async def test_check_alerts_for_trip_weather_inserts_on_heavy_rain():
    """Plan with outdoor place + rain forecast > 70% → weather warning should be inserted."""
    plan = _make_plan(transport_mode="WALK")   # gardens-by-the-bay is outdoor
    sb = _make_supabase_mock()
    sb.table("lta_alerts").execute.return_value = MagicMock(data=[])

    forecast = {"rain_probability": 80, "temp_c": 28, "description": "Heavy rain"}

    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.lta.get_train_alerts",
                   new_callable=AsyncMock, return_value=[]):
            with patch("app.agents.adaptation_agent.openweather.get_forecast",
                       new_callable=AsyncMock, return_value=forecast):
                result = await check_alerts_for_trip("t1", plan)

    assert result["weather_checked"] is True
    insert_calls = [
        call_args[0][0]
        for call_args in sb.table("lta_alerts").insert.call_args_list
        if call_args[0]
    ]
    assert any(c.get("alert_type") == "weather_warning" for c in insert_calls)


@pytest.mark.asyncio
async def test_check_alerts_for_trip_dedup_skips_recent_alert():
    """If an identical alert was inserted in the last 10 min, no duplicate is inserted."""
    plan = _make_plan(transport_mode="METRO")
    sb = _make_supabase_mock()
    # Simulate existing recent dedup row — should block insert
    sb.table("lta_alerts").execute.return_value = MagicMock(data=[{"id": "existing"}])

    train_alert = [{"affected_line": "East West Line", "message": "Disruption"}]

    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.lta.get_train_alerts",
                   new_callable=AsyncMock, return_value=train_alert):
            result = await check_alerts_for_trip("t1", plan)

    assert result["alerts_inserted"] == 0   # dedup blocked the insert
