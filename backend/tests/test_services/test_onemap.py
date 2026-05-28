import time
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

import app.services.onemap as _onemap
from app.services.onemap import geocode, get_route, NoRouteError, GeocodingError, _extract_sub_legs


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


# ── _extract_sub_legs ─────────────────────────────────────────────────────────

def test_extract_sub_legs_maps_subway_to_mrt():
    legs = [{"mode": "SUBWAY", "duration": 600, "route": "EW",
             "from": {"name": "Bayfront", "stopCode": "EW24"},
             "to": {"name": "City Hall", "stopCode": "EW13"},
             "numStops": 3}]
    result = _extract_sub_legs(legs)
    assert result[0]["mode"] == "MRT"
    assert result[0]["route"] == "EW"
    assert result[0]["from_name"] == "Bayfront"
    assert result[0]["to_name"] == "City Hall"
    assert result[0]["from_stop_code"] == "EW24"
    assert result[0]["to_stop_code"] == "EW13"
    assert result[0]["num_stops"] == 3
    assert result[0]["duration_minutes"] == 10


def test_extract_sub_legs_maps_tram_to_lrt():
    legs = [{"mode": "TRAM", "duration": 300, "route": "BP",
             "from": {"name": "Bukit Panjang"}, "to": {"name": "Petir"}, "numStops": 2}]
    result = _extract_sub_legs(legs)
    assert result[0]["mode"] == "LRT"
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
    mrt = next(s for s in sub_legs if s["mode"] == "MRT")
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
