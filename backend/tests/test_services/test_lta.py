import pytest
import httpx
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.lta import get_bus_arrival, get_train_alerts, LTAUnavailableError, _minutes_until


# ── helpers ──────────────────────────────────────────────────────────────────

def _resp(json_data: dict) -> MagicMock:
    r = MagicMock()
    r.raise_for_status = MagicMock()
    r.json.return_value = json_data
    return r


def _mock_client(json_data: dict) -> AsyncMock:
    c = AsyncMock()
    c.__aenter__.return_value = c
    c.__aexit__.return_value = False
    c.get.return_value = _resp(json_data)
    return c


def _iso(minutes_from_now: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes_from_now)).isoformat()


# ── _minutes_until ────────────────────────────────────────────────────────────

def test_minutes_until_empty_string():
    assert _minutes_until("") == -1


def test_minutes_until_malformed_timestamp():
    # LTA occasionally returns placeholder strings that are not valid ISO 8601
    assert _minutes_until("not-a-date") == -1
    assert _minutes_until("0001-01-01T00:00:00") == -1  # LTA no-bus placeholder (naive, no tz) → -1


# ── bus arrival ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_bus_arrival_success():
    data = {
        "BusStopCode": "83139",
        "Services": [
            {
                "ServiceNo": "65",
                "NextBus": {"EstimatedArrival": _iso(5), "Load": "SEA"},
                "NextBus2": {"EstimatedArrival": _iso(12), "Load": "SDA"},
            }
        ],
    }
    client = _mock_client(data)
    with patch("app.services.lta.httpx.AsyncClient", return_value=client):
        result = await get_bus_arrival("83139")

    assert len(result) == 1
    assert result[0]["service_no"] == "65"
    assert result[0]["next_arrival_minutes"] == 5
    assert result[0]["next_arrival_2_minutes"] == 12
    assert result[0]["load"] == "SEA"


@pytest.mark.asyncio
async def test_get_bus_arrival_null_services_returns_empty():
    client = _mock_client({"BusStopCode": "83139", "Services": None})
    with patch("app.services.lta.httpx.AsyncClient", return_value=client):
        result = await get_bus_arrival("83139")
    assert result == []


@pytest.mark.asyncio
async def test_get_bus_arrival_api_down_raises():
    c = AsyncMock()
    c.__aenter__.return_value = c
    c.__aexit__.return_value = False
    bad_resp = MagicMock()
    bad_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
        "500", request=MagicMock(), response=MagicMock()
    )
    c.get.return_value = bad_resp

    with patch("app.services.lta.httpx.AsyncClient", return_value=c):
        with pytest.raises(LTAUnavailableError):
            await get_bus_arrival("83139")


# ── train alerts ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_train_alerts_normal_returns_empty():
    data = {"value": {"Status": 1, "AffectedSegments": [], "Message": []}}
    client = _mock_client(data)
    with patch("app.services.lta.httpx.AsyncClient", return_value=client):
        result = await get_train_alerts()

    assert result == []


@pytest.mark.asyncio
async def test_get_train_alerts_disruption_returns_list():
    data = {
        "value": {
            "Status": 2,
            "AffectedSegments": [
                {"Line": "NSL", "Direction": "towards Jurong East", "Stations": "NS1-NS5"},
                {"Line": "NSL", "Direction": "towards Pasir Ris", "Stations": "NS5-NS1"},
            ],
            "Message": [{"Content": "Train service disrupted on NSL"}],
        }
    }
    client = _mock_client(data)
    with patch("app.services.lta.httpx.AsyncClient", return_value=client):
        result = await get_train_alerts()

    assert len(result) == 2
    assert result[0]["status"] == 2
    assert result[0]["affected_line"] == "NSL"
    assert result[0]["message"] == "Train service disrupted on NSL"


@pytest.mark.asyncio
async def test_get_train_alerts_null_value_returns_empty():
    client = _mock_client({"value": None})
    with patch("app.services.lta.httpx.AsyncClient", return_value=client):
        result = await get_train_alerts()
    assert result == []


@pytest.mark.asyncio
async def test_get_train_alerts_network_error_raises():
    c = AsyncMock()
    c.__aenter__.return_value = c
    c.__aexit__.return_value = False
    c.get.side_effect = httpx.RequestError("Connection refused")

    with patch("app.services.lta.httpx.AsyncClient", return_value=c):
        with pytest.raises(LTAUnavailableError):
            await get_train_alerts()
