import time
import pytest
import httpx
from unittest.mock import AsyncMock, MagicMock, patch

import app.services.onemap as _onemap
from app.services.onemap import geocode, get_route, NoRouteError, GeocodingError


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

_WALK_ROUTE_JSON = {"route_summary": {"total_time": 1200}}


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
async def test_get_route_walk_success_includes_required_time_params():
    client = _mock_client(post_json=_TOKEN_JSON, get_json=_WALK_ROUTE_JSON)
    with patch("app.services.onemap.httpx.AsyncClient", return_value=client):
        result = await get_route(1.2816, 103.8636, 1.2869, 103.8545, "walk")

    assert result["duration_minutes"] == 20
    assert result["fare_sgd"] == 0.0
    assert result["legs"] == [
        {"mode": "WALK", "duration_minutes": 20, "instruction": ""}
    ]

    params = client.get.call_args.kwargs["params"]
    assert params["routeType"] == "walk"
    assert "date" in params
    assert "time" in params
    assert "mode" not in params
    assert "numItineraries" not in params


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
