import pytest
import httpx
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.openweather import get_forecast, WeatherUnavailableError
import app.services.openweather as _ow


def _make_daily_entry(date_offset_days: int, pop: float = 0.82) -> dict:
    """Build a daily forecast entry for today + offset days."""
    dt = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    dt += timedelta(days=date_offset_days)
    return {
        "dt": int(dt.timestamp()),
        "temp": {"max": 33.5, "min": 26.0},
        "weather": [{"main": "Rain", "description": "moderate rain"}],
        "pop": pop,
    }


def _target_date(offset: int = 1) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=offset)).strftime("%Y-%m-%d")


def _mock_client(json_data: dict) -> AsyncMock:
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = json_data
    c = AsyncMock()
    c.__aenter__.return_value = c
    c.__aexit__.return_value = False
    c.get.return_value = resp
    return c


@pytest.mark.asyncio
async def test_get_forecast_returns_dict(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    date_str = _target_date(1)
    data = {"daily": [_make_daily_entry(1)]}
    client = _mock_client(data)
    with patch("app.services.openweather.httpx.AsyncClient", return_value=client):
        result = await get_forecast(date_str)

    assert result["date"] == date_str
    assert result["condition"] == "Rain"
    assert result["temp_max"] == 33.5
    assert result["temp_min"] == 26.0


@pytest.mark.asyncio
async def test_get_forecast_rain_probability_as_percent(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    date_str = _target_date(1)
    data = {"daily": [_make_daily_entry(1, pop=0.82)]}
    client = _mock_client(data)
    with patch("app.services.openweather.httpx.AsyncClient", return_value=client):
        result = await get_forecast(date_str)

    assert result["rain_probability"] == 82


@pytest.mark.asyncio
async def test_get_forecast_date_not_found_raises(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    data = {"daily": [_make_daily_entry(1)]}  # only tomorrow, not 10 days later
    client = _mock_client(data)
    far_future = _target_date(10)
    with patch("app.services.openweather.httpx.AsyncClient", return_value=client):
        with pytest.raises(WeatherUnavailableError, match="8-day window"):
            await get_forecast(far_future)


@pytest.mark.asyncio
async def test_get_forecast_invalid_date_raises(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    data = {"daily": [_make_daily_entry(1)]}
    client = _mock_client(data)
    with patch("app.services.openweather.httpx.AsyncClient", return_value=client):
        with pytest.raises(WeatherUnavailableError, match="Invalid date format"):
            await get_forecast("not-a-date")


@pytest.mark.asyncio
async def test_get_forecast_malformed_daily_entry_skipped(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    # One malformed entry (missing "dt") followed by a valid one
    good_entry = _make_daily_entry(1)
    data = {"daily": [{"no_dt_field": True}, good_entry]}
    client = _mock_client(data)
    date_str = _target_date(1)
    with patch("app.services.openweather.httpx.AsyncClient", return_value=client):
        result = await get_forecast(date_str)
    assert result["date"] == date_str


@pytest.mark.asyncio
async def test_get_forecast_no_key_raises(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", None)
    with pytest.raises(WeatherUnavailableError, match="not configured"):
        await get_forecast("2024-01-15")


@pytest.mark.asyncio
async def test_get_forecast_api_down_raises(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    c = AsyncMock()
    c.__aenter__.return_value = c
    c.__aexit__.return_value = False
    bad_resp = MagicMock()
    bad_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
        "500", request=MagicMock(), response=MagicMock()
    )
    c.get.return_value = bad_resp
    with patch("app.services.openweather.httpx.AsyncClient", return_value=c):
        with pytest.raises(WeatherUnavailableError, match="unavailable"):
            await get_forecast("2024-01-15")
