import time
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

import app.services.onemap as _onemap
from app.services.onemap import (
    geocode, get_route, NoRouteError, GeocodingError,
    _extract_sub_legs, _extract_all_geometries,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def _resp(json_data: dict) -> MagicMock:
    r = MagicMock()
    r.raise_for_status = MagicMock()
    r.json.return_value = json_data
    return r


def _err_resp(exc: Exception) -> MagicMock:
    r = MagicMock()
    r.raise_for_status.side_effect = exc
    return r


def _mock_client(*, get_json=None, post_json=None, get_exc=None, post_exc=None) -> AsyncMock:
    c = AsyncMock()
    c.__aenter__.return_value = c
    c.__aexit__.return_value = False
    if get_json is not None:
        c.get.return_value = _resp(get_json)
    if post_json is not None:
        c.post.return_value = _resp(post_json)
    if get_exc is not None:
        c.get.side_effect = get_exc
    if post_exc is not None:
        c.post.return_value = _err_resp(post_exc)
    return c


_TOKEN_JSON = {"access_token": "tok", "expiry_timestamp": str(time.time() + 86400)}

_ROUTE_JSON = {
    "plan": {
        "itineraries": [
            {
                "duration": 1800,
                "fare": 1.50,
                "legs": [
                    {"mode": "WALK", "duration": 300, "route": ""},
                    {"mode": "SUBWAY", "duration": 1200, "route": "NS"},
                    {"mode": "WALK", "duration": 300, "route": ""},
                ],
            }
        ]
    }
}

_ROUTE_JSON_WITH_GEOMETRY = {
    "plan": {
        "itineraries": [
            {
                "duration": 1800,
                "fare": 1.50,
                "legs": [
                    {
                        "mode": "WALK", "duration": 300, "route": "",
                        "legGeometry": {"points": "walk_poly"},
                        "from": {"name": "Origin"}, "to": {"name": "Bayfront Station"},
                    },
                    {
                        "mode": "SUBWAY", "duration": 1200, "route": "EW",
                        "legGeometry": {"points": "mrt_poly"},
                        "from": {"name": "Bayfront", "stopCode": "EW24/NS1"},
                        "to": {"name": "City Hall", "stopCode": "EW13/NS25"},
                        "numStops": 10,
                    },
                    {
                        "mode": "WALK", "duration": 300, "route": "",
                        "legGeometry": {"points": "walk2_poly"},
                        "from": {"name": "City Hall Station"}, "to": {"name": "Destination"},
                    },
                ],
            }
        ]
    }
}

_ROUTE_JSON_WITH_BUS = {
    "plan": {
        "itineraries": [
            {
                "duration": 1500,
                "fare": 1.20,
                "legs": [
                    {
                        "mode": "WALK", "duration": 300, "route": "",
                        "from": {"name": "Start"}, "to": {"name": "Bus Stop 22009"},
                    },
                    {
                        "mode": "BUS", "duration": 900, "route": "7",
                        "numStops": 5,
                        "from": {"name": "Bus Stop 22009", "stopCode": "22009"},
                        "to": {"name": "Bus Stop 11009", "stopCode": "11009"},
                    },
                    {
                        "mode": "WALK", "duration": 300, "route": "",
                        "from": {"name": "Bus Stop 11009"}, "to": {"name": "End"},
                    },
                ],
            }
        ]
    }
}


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_token_cache():
    _onemap._TOKEN_CACHE["token"] = None
    _onemap._TOKEN_CACHE["expires_at"] = 0.0
    yield
    _onemap._TOKEN_CACHE["token"] = None
    _onemap._TOKEN_CACHE["expires_at"] = 0.0


# ── geocode ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_geocode_returns_lat_lng():
    client = _mock_client(
        get_json={
            "found": 1,
            "results": [
                {"LATITUDE": "1.2806", "LONGITUDE": "103.8565", "ADDRESS": "Marina Bay Sands"}
            ],
        }
    )
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await geocode("Marina Bay Sands")

    assert result == {"lat": 1.2806, "lng": 103.8565, "address": "Marina Bay Sands"}


@pytest.mark.asyncio
async def test_geocode_no_results_raises():
    client = _mock_client(get_json={"found": 0, "results": []})
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        with pytest.raises(GeocodingError, match="No results"):
            await geocode("nonexistent-xyzzy-place")


@pytest.mark.asyncio
async def test_geocode_api_down_raises():
    client = _mock_client(
        get_exc=httpx.RequestError("Connection refused")
    )
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        with pytest.raises(GeocodingError, match="unavailable"):
            await geocode("Marina Bay Sands")


# ── get_route ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_route_pt_success():
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")

    assert result["duration_minutes"] == 30
    assert result["fare_sgd"] == 1.50
    assert len(result["legs"]) == 3
    assert result["legs"][1]["mode"] == "SUBWAY"


@pytest.mark.asyncio
async def test_get_route_no_route_raises():
    client = _mock_client(
        post_json=_TOKEN_JSON,
        get_json={"plan": {"itineraries": []}},
    )
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        with pytest.raises(NoRouteError):
            await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")


@pytest.mark.asyncio
async def test_get_route_auth_failure_raises():
    exc = httpx.HTTPStatusError("401", request=MagicMock(), response=MagicMock())
    client = _mock_client(post_exc=exc)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        with pytest.raises(NoRouteError, match="auth failed"):
            await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")


@pytest.mark.asyncio
async def test_get_route_retries_once_on_transient_failure():
    """A transient RequestError on the first attempt is retried and can still succeed."""
    client = _mock_client(post_json=_TOKEN_JSON)
    client.get.side_effect = [httpx.RequestError("timeout"), _resp(_ROUTE_JSON)]
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client), \
         patch("app.services.onemap.asyncio.sleep", new=AsyncMock()):
        result = await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")

    assert client.get.call_count == 2
    assert result["duration_minutes"] == 30


@pytest.mark.asyncio
async def test_get_route_raises_after_retry_exhausted():
    """Two consecutive transient failures raise NoRouteError (no infinite retry)."""
    client = _mock_client(post_json=_TOKEN_JSON)
    client.get.side_effect = httpx.RequestError("timeout")
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client), \
         patch("app.services.onemap.asyncio.sleep", new=AsyncMock()):
        with pytest.raises(NoRouteError):
            await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")

    assert client.get.call_count == 2


@pytest.mark.asyncio
async def test_get_route_token_cached():
    """Auth endpoint must be called only once when token is still valid."""
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")
        await get_route(1.3521, 103.8198, 1.2806, 103.8565, "pt")

    assert client.post.call_count == 1
    assert client.get.call_count == 2


# ── geometry + instructions extraction ───────────────────────────────────────

@pytest.mark.asyncio
async def test_get_route_pt_returns_transit_leg_geometry():
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON_WITH_GEOMETRY)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")
    # geometry should come from the transit (SUBWAY) leg, not the leading WALK leg
    assert result["geometry"] == "mrt_poly"


@pytest.mark.asyncio
async def test_get_route_pt_returns_instructions():
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON_WITH_GEOMETRY)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")
    instructions = result["instructions"]
    assert isinstance(instructions, list)
    assert any("Bayfront Station" in i for i in instructions)
    assert any("EW" in i for i in instructions)
    assert any("City Hall" in i for i in instructions)


@pytest.mark.asyncio
async def test_get_route_pt_geometry_none_when_no_leggeometry():
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")
    # No legGeometry in _ROUTE_JSON → geometry must be None
    assert result["geometry"] is None
    # Instructions list is always returned (may be empty or not depending on leg content)
    assert isinstance(result["instructions"], list)


@pytest.mark.asyncio
async def test_get_route_pt_existing_fields_unaffected():
    """Existing callers that only use duration/fare/legs still work."""
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON_WITH_GEOMETRY)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")
    assert result["duration_minutes"] == 30
    assert result["fare_sgd"] == 1.50
    assert len(result["legs"]) == 3


@pytest.mark.asyncio
async def test_get_route_fare_info_unavailable_returns_zero():
    """OneMap returns 'info unavailable' for some routes — must not crash."""
    route_json = {
        "plan": {
            "itineraries": [
                {
                    "duration": 900,
                    "fare": "info unavailable",
                    "legs": [{"mode": "WALK", "duration": 900, "route": ""}],
                }
            ]
        }
    }
    client = _mock_client(post_json=_TOKEN_JSON, get_json=route_json)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2816, 103.8636, 1.2530, 103.8198, "pt")
    assert result["fare_sgd"] == 0.0
    assert result["duration_minutes"] == 15


# ── dev24: request several itineraries, pick the first that rides transit ──────

_ROUTE_JSON_MULTI = {
    "plan": {
        "itineraries": [
            {  # OTP's "best" for a short leg is often all-walk → must be skipped
                "duration": 1000, "fare": 0.0,
                "legs": [{"mode": "WALK", "duration": 1000, "route": ""}],
            },
            {  # metro + walk → this is the one we want
                "duration": 1500, "fare": 1.50,
                "legs": [
                    {"mode": "WALK", "duration": 300, "route": ""},
                    {"mode": "SUBWAY", "duration": 900, "route": "NS"},
                    {"mode": "WALK", "duration": 300, "route": ""},
                ],
            },
            {  # bus + walk (later in the list)
                "duration": 1600, "fare": 1.20,
                "legs": [
                    {"mode": "WALK", "duration": 300, "route": ""},
                    {"mode": "BUS", "duration": 1300, "route": "7"},
                ],
            },
        ]
    }
}


def test_has_transit_true_for_metro_leg():
    assert _onemap._has_transit({"legs": [{"mode": "WALK"}, {"mode": "SUBWAY"}]}) is True


def test_has_transit_false_for_all_walk():
    assert _onemap._has_transit({"legs": [{"mode": "WALK"}, {"mode": "WALK"}]}) is False


def test_has_transit_false_for_empty_legs():
    assert _onemap._has_transit({"legs": []}) is False


@pytest.mark.asyncio
async def test_get_route_pt_picks_first_transit_itinerary():
    """When OTP's first itinerary is all-walk, get_route returns the first transit one."""
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON_MULTI)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")
    # metro+walk itinerary chosen, not the leading all-walk one
    assert any(leg["mode"] == "SUBWAY" for leg in result["legs"])
    assert result["fare_sgd"] == 1.50
    assert result["duration_minutes"] == 25     # 1500 / 60


@pytest.mark.asyncio
async def test_get_route_pt_requests_multiple_itineraries():
    """The PT request must ask OTP for several itineraries (not just 1)."""
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        await get_route(1.28, 103.85, 1.30, 103.82, "pt")
    params = client.get.call_args.kwargs.get("params", {})
    assert params.get("numItineraries") == _onemap._PT_NUM_ITINERARIES
    assert _onemap._PT_NUM_ITINERARIES > 1


@pytest.mark.asyncio
async def test_get_route_pt_all_walk_itineraries_falls_back():
    """When every itinerary is all-walk, fall back to OTP's first (no raise)."""
    all_walk = {"plan": {"itineraries": [
        {"duration": 900, "fare": 0.0, "legs": [{"mode": "WALK", "duration": 900, "route": ""}]},
    ]}}
    client = _mock_client(post_json=_TOKEN_JSON, get_json=all_walk)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2816, 103.8636, 1.2530, 103.8198, "pt")
    assert result["duration_minutes"] == 15
    assert all(leg["mode"] == "WALK" for leg in result["legs"])


# ── _extract_sub_legs ─────────────────────────────────────────────────────────

def test_extract_sub_legs_maps_subway_to_metro():
    legs = [{"mode": "SUBWAY", "duration": 600, "route": "EW",
             "from": {"name": "Bayfront", "stopCode": "EW24"},
             "to": {"name": "City Hall", "stopCode": "EW13"},
             "numStops": 3,
             "legGeometry": {"points": "mrt_poly"},
             "intermediateStops": [
                 {"name": "Raffles Place", "stopCode": "EW14/NS26"},
             ]}]
    result = _extract_sub_legs(legs)
    assert result[0]["mode"] == "METRO"
    assert result[0]["route"] == "EW"
    assert result[0]["from_name"] == "Bayfront"
    assert result[0]["to_name"] == "City Hall"
    assert result[0]["from_stop_code"] == "EW24"
    assert result[0]["to_stop_code"] == "EW13"
    assert result[0]["num_stops"] == 3
    assert result[0]["duration_minutes"] == 10
    assert result[0]["geometry"] == "mrt_poly"
    assert result[0]["intermediate_stops"] == [{"name": "Raffles Place", "stop_code": "EW14/NS26"}]


def test_extract_sub_legs_maps_tram_to_metro():
    legs = [{"mode": "TRAM", "duration": 300, "route": "BP",
             "from": {"name": "Bukit Panjang"}, "to": {"name": "Petir"}, "numStops": 2}]
    result = _extract_sub_legs(legs)
    assert result[0]["mode"] == "METRO"
    assert result[0]["route"] == "BP"


def test_extract_sub_legs_walk_has_no_stop_code():
    legs = [{"mode": "WALK", "duration": 180, "route": "",
             "from": {"name": "Origin"}, "to": {"name": "Station"}}]
    result = _extract_sub_legs(legs)
    assert result[0]["mode"] == "WALK"
    assert result[0]["from_stop_code"] == ""
    assert result[0]["to_stop_code"] == ""
    assert result[0]["num_stops"] == 0


def test_extract_sub_legs_bus_preserves_stop_codes():
    legs = [{"mode": "BUS", "duration": 600, "route": "7",
             "from": {"name": "Bus Stop 22009", "stopCode": "22009"},
             "to": {"name": "Bus Stop 11009", "stopCode": "11009"},
             "numStops": 5}]
    result = _extract_sub_legs(legs)
    assert result[0]["mode"] == "BUS"
    assert result[0]["route"] == "7"
    assert result[0]["from_stop_code"] == "22009"
    assert result[0]["to_stop_code"] == "11009"
    assert result[0]["num_stops"] == 5


def test_extract_sub_legs_empty_returns_empty():
    assert _extract_sub_legs([]) == []


@pytest.mark.asyncio
async def test_get_route_pt_returns_sub_legs():
    """get_route PT branch must return 'sub_legs' key with structured per-leg data."""
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON_WITH_GEOMETRY)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")
    assert "sub_legs" in result
    sub_legs = result["sub_legs"]
    assert len(sub_legs) == 3
    # MRT sub-leg has route and stop codes
    mrt = next(s for s in sub_legs if s["mode"] == "METRO")
    assert mrt["route"] == "EW"
    assert mrt["from_stop_code"] == "EW24/NS1"
    assert mrt["num_stops"] == 10


@pytest.mark.asyncio
async def test_get_route_pt_sub_legs_bus_stop_codes():
    """Bus legs must carry from_stop_code / to_stop_code from OneMap data."""
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON_WITH_BUS)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.28, 103.85, 1.30, 103.82, "pt")
    bus = next(s for s in result["sub_legs"] if s["mode"] == "BUS")
    assert bus["route"] == "7"
    assert bus["from_stop_code"] == "22009"
    assert bus["to_stop_code"] == "11009"


@pytest.mark.asyncio
async def test_get_route_walk_mode_has_no_sub_legs():
    """Non-PT modes (walk, drive, cycle) must NOT include sub_legs key."""
    walk_json = {"route_summary": {"total_time": 600, "total_distance": 800}}
    client = _mock_client(post_json=_TOKEN_JSON, get_json=walk_json)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.28, 103.85, 1.30, 103.82, "walk")
    assert "sub_legs" not in result


# ── _extract_all_geometries ────────────────────────────────────────────────────

def test_extract_all_geometries_returns_all_legs():
    legs = [
        {"mode": "WALK", "legGeometry": {"points": "walk_poly1"}},
        {"mode": "SUBWAY", "legGeometry": {"points": "mrt_poly"}},
        {"mode": "WALK", "legGeometry": {"points": "walk_poly2"}},
    ]
    result = _extract_all_geometries(legs)
    assert result == ["walk_poly1", "mrt_poly", "walk_poly2"]


def test_extract_all_geometries_skips_missing():
    legs = [
        {"mode": "WALK"},  # no legGeometry
        {"mode": "SUBWAY", "legGeometry": {"points": "mrt_poly"}},
    ]
    result = _extract_all_geometries(legs)
    assert result == ["mrt_poly"]


def test_extract_all_geometries_empty_returns_empty():
    assert _extract_all_geometries([]) == []


@pytest.mark.asyncio
async def test_get_route_pt_returns_geometries_list():
    """get_route PT must return 'geometries' key with all leg polylines."""
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON_WITH_GEOMETRY)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2806, 103.8565, 1.3521, 103.8198, "pt")
    assert "geometries" in result
    assert result["geometries"] == ["walk_poly", "mrt_poly", "walk2_poly"]


@pytest.mark.asyncio
async def test_get_route_walk_returns_geometries_list():
    """Walk route must return 'geometries' with the single route_geometry."""
    walk_json = {"route_summary": {"total_time": 600, "total_distance": 800},
                 "route_geometry": "walk_route_poly"}
    client = _mock_client(post_json=_TOKEN_JSON, get_json=walk_json)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.28, 103.85, 1.30, 103.82, "walk")
    assert result["geometries"] == ["walk_route_poly"]


@pytest.mark.asyncio
async def test_get_route_walk_no_geometry_returns_empty_list():
    walk_json = {"route_summary": {"total_time": 600, "total_distance": 800}}
    client = _mock_client(post_json=_TOKEN_JSON, get_json=walk_json)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.28, 103.85, 1.30, 103.82, "walk")
    assert result["geometries"] == []


# ── get_all_routes ─────────────────────────────────────────────────────────────

_PT_RESULT = {
    "duration_minutes": 30, "fare_sgd": 1.50, "distance_km": 5.2,
    "sub_legs": [
        {"mode": "WALK", "route": "", "from_name": "Origin", "to_name": "Bayfront Station",
         "from_stop_code": "", "to_stop_code": "", "duration_minutes": 5, "num_stops": 0,
         "geometry": None, "intermediate_stops": []},
        {"mode": "METRO", "route": "EW", "from_name": "Bayfront", "to_name": "City Hall",
         "from_stop_code": "EW24/NS1", "to_stop_code": "EW13/NS25", "duration_minutes": 20,
         "num_stops": 10, "geometry": "mrt_poly", "intermediate_stops": []},
        {"mode": "WALK", "route": "", "from_name": "City Hall Station", "to_name": "Destination",
         "from_stop_code": "", "to_stop_code": "", "duration_minutes": 5, "num_stops": 0,
         "geometry": None, "intermediate_stops": []},
    ],
}
_WALK_RESULT = {"duration_minutes": 45, "fare_sgd": 0.0, "distance_km": 3.5, "sub_legs": []}
_CYCLE_RESULT = {"duration_minutes": 18, "fare_sgd": 0.0, "distance_km": 3.5, "sub_legs": []}


async def _mock_get_route(from_lat, from_lng, to_lat, to_lng, mode):
    if mode == "pt":
        return _PT_RESULT
    if mode == "walk":
        return _WALK_RESULT
    return _CYCLE_RESULT


# ── transit_modes param ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_route_pt_with_transit_modes_bus_passes_param():
    """transit_modes='BUS' must be forwarded as transitModes in the OneMap request."""
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        await get_route(1.28, 103.85, 1.30, 103.82, "pt", transit_modes="BUS")
    call_params = client.get.call_args.kwargs.get("params") or client.get.call_args.args[1] if client.get.call_args.args else {}
    if not call_params and client.get.call_args.kwargs:
        call_params = client.get.call_args.kwargs.get("params", {})
    assert call_params.get("transitModes") == "BUS"


@pytest.mark.asyncio
async def test_get_route_pt_without_transit_modes_no_param():
    """When transit_modes=None (default), transitModes must NOT appear in the request."""
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_ROUTE_JSON)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        await get_route(1.28, 103.85, 1.30, 103.82, "pt")
    call_params = client.get.call_args.kwargs.get("params", {})
    assert "transitModes" not in call_params


# ── get_all_routes ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_all_routes_returns_three_modes():
    """get_all_routes must return pt, walk, cycle keys."""
    from app.services.onemap import get_all_routes
    with patch("app.services.onemap.get_route", side_effect=_mock_get_route):
        result = await get_all_routes(1.28, 103.85, 1.30, 103.82)
    assert set(result.keys()) == {"pt", "walk", "cycle"}


@pytest.mark.asyncio
async def test_get_all_routes_pt_values():
    """PT result must carry duration, fare, distance, available=True."""
    from app.services.onemap import get_all_routes
    with patch("app.services.onemap.get_route", side_effect=_mock_get_route):
        result = await get_all_routes(1.28, 103.85, 1.30, 103.82)
    pt = result["pt"]
    assert pt["available"] is True
    assert pt["duration_minutes"] == 30
    assert pt["fare_sgd"] == 1.50
    assert pt["distance_km"] == 5.2


@pytest.mark.asyncio
async def test_get_all_routes_pt_summary_from_sub_legs():
    """PT summary must be derived from the first non-WALK sub-leg route."""
    from app.services.onemap import get_all_routes
    with patch("app.services.onemap.get_route", side_effect=_mock_get_route):
        result = await get_all_routes(1.28, 103.85, 1.30, 103.82)
    assert result["pt"]["summary"] == "via EW line"


@pytest.mark.asyncio
async def test_get_all_routes_walk_cycle_summary_direct():
    """Walk and cycle summaries must be 'direct'."""
    from app.services.onemap import get_all_routes
    with patch("app.services.onemap.get_route", side_effect=_mock_get_route):
        result = await get_all_routes(1.28, 103.85, 1.30, 103.82)
    assert result["walk"]["summary"] == "direct"
    assert result["cycle"]["summary"] == "direct"


@pytest.mark.asyncio
async def test_get_all_routes_mode_failure_returns_unavailable():
    """A NoRouteError for one mode must not fail the whole call."""
    from app.services.onemap import get_all_routes

    async def _mock_failing(from_lat, from_lng, to_lat, to_lng, mode):
        if mode == "cycle":
            raise NoRouteError("No cycle route")
        return await _mock_get_route(from_lat, from_lng, to_lat, to_lng, mode)

    with patch("app.services.onemap.get_route", side_effect=_mock_failing):
        result = await get_all_routes(1.28, 103.85, 1.30, 103.82)
    assert result["cycle"]["available"] is False
    assert result["cycle"]["duration_minutes"] == 0
    assert result["pt"]["available"] is True


@pytest.mark.asyncio
async def test_get_all_routes_all_modes_fail():
    """All modes failing must return three unavailable entries (no exception raised)."""
    from app.services.onemap import get_all_routes

    async def _all_fail(*_args, **_kwargs):
        raise NoRouteError("no route")

    with patch("app.services.onemap.get_route", side_effect=_all_fail):
        result = await get_all_routes(1.28, 103.85, 1.30, 103.82)
    assert all(not result[m]["available"] for m in ("pt", "walk", "cycle"))


@pytest.mark.asyncio
async def test_get_all_routes_pt_no_transit_sub_leg_summary_empty():
    """When PT result has no non-WALK sub-legs, summary must be empty string."""
    from app.services.onemap import get_all_routes

    async def _mock_walk_only(from_lat, from_lng, to_lat, to_lng, mode):
        if mode == "pt":
            return {**_PT_RESULT, "sub_legs": [
                {"mode": "WALK", "route": "", "from_name": "A", "to_name": "B",
                 "from_stop_code": "", "to_stop_code": "", "duration_minutes": 30, "num_stops": 0}
            ]}
        return await _mock_get_route(from_lat, from_lng, to_lat, to_lng, mode)

    with patch("app.services.onemap.get_route", side_effect=_mock_walk_only):
        result = await get_all_routes(1.28, 103.85, 1.30, 103.82)
    assert result["pt"]["summary"] == ""


# ── Patch 2 — type coercion (string fields from OneMap) ──────────────────────

@pytest.mark.asyncio
async def test_get_route_walk_with_string_total_time():
    """[PATCH 2] OneMap returns total_time as string → duration_minutes is still an int."""
    walk_json = {
        "route_summary": {
            "total_time": "900",        # ← string instead of int
            "total_distance": "1200",   # ← string instead of int
        }
    }
    client = _mock_client(post_json=_TOKEN_JSON, get_json=walk_json)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.28, 103.85, 1.29, 103.85, "walk")
    assert isinstance(result["duration_minutes"], int)
    assert result["duration_minutes"] == 15       # 900 / 60 = 15
    assert isinstance(result["distance_km"], float)
    assert result["distance_km"] == 1.2           # 1200 / 1000 = 1.2


@pytest.mark.asyncio
async def test_get_route_pt_with_string_distance():
    """[PATCH 2] OneMap returns leg distance as string → total_distance_m computed correctly."""
    pt_json_str_dist = {
        "plan": {
            "itineraries": [
                {
                    "duration": 1800,
                    "fare": 1.50,
                    "legs": [
                        {"mode": "WALK", "duration": "300", "route": "", "distance": "500"},
                        {"mode": "SUBWAY", "duration": "1200", "route": "NS", "distance": "4500"},
                    ],
                }
            ]
        }
    }
    client = _mock_client(post_json=_TOKEN_JSON, get_json=pt_json_str_dist)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.28, 103.85, 1.35, 103.82, "pt")
    # Should not crash; distance_km = (500+4500)/1000 = 5.0
    assert result["distance_km"] == pytest.approx(5.0, abs=0.01)
    assert isinstance(result["duration_minutes"], int)


def test_extract_sub_legs_string_duration():
    """[PATCH 2] OneMap returns duration/numStops as strings → should coerce to int."""
    legs = [
        {
            "mode": "SUBWAY",
            "duration": "600",     # ← string
            "route": "EW",
            "from": {"name": "Bayfront", "stopCode": "EW24"},
            "to": {"name": "City Hall", "stopCode": "EW13"},
            "numStops": "3",       # ← string
        }
    ]
    result = _extract_sub_legs(legs)
    assert result[0]["duration_minutes"] == 10    # int(round(float("600") / 60))
    assert result[0]["num_stops"] == 3             # int("3")
