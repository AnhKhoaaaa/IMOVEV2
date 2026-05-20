import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents.adaptation_agent import (
    poll_lta_alerts,
    poll_weather_alerts,
    adapt_trip,
    _nearest_indoor,
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


def _make_plan(trip_id="t1", transport_mode="MRT") -> TripPlan:
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
    outdoor_place_id = "gardens-by-the-bay"  # is_outdoor=True in _PLACES
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
    plan = _make_plan(transport_mode="MRT")
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
    plan = _make_plan(transport_mode="MRT")
    alert_data = [{"id": "alert-1", "alert_type": "train_delay", "affected_line": "NS", "message": "Delay"}]
    sb = _make_supabase_mock(alert=alert_data)

    with patch("app.agents.adaptation_agent.supabase", sb):
        with patch("app.agents.adaptation_agent.onemap.get_route",
                   new_callable=AsyncMock, side_effect=Exception("Network error")):
            result = await adapt_trip("t1", "alert-1", plan)

    # When rerouting fails, keep original leg
    leg = result.updated_trip.days[0].legs[0]
    assert leg.transport_mode == "MRT"
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
    # Gardens by the Bay (outdoor) at 1.2816, 103.8636 — marina-bay-sands (indoor) is ~0.33 km away
    result = _nearest_indoor(1.2816, 103.8636, exclude_id="gardens-by-the-bay")
    assert result is not None
    assert result["is_outdoor"] is False


def test_nearest_indoor_excludes_self():
    result = _nearest_indoor(1.2834, 103.8607, exclude_id="marina-bay-sands")
    assert result is None or result["id"] != "marina-bay-sands"
