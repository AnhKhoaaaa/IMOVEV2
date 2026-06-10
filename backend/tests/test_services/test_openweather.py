import pytest
import httpx
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.openweather import get_forecast, get_forecast_window, WeatherUnavailableError
import app.services.openweather as _ow


@pytest.fixture(autouse=True)
def _clear_weather_cache():
    """The forecast window is cached per coord; clear it so tests stay isolated."""
    _ow._clear_forecast_cache()
    yield
    _ow._clear_forecast_cache()


def _make_entry(date_offset_days: int, hour: int = 12, pop: float = 0.82) -> dict:
    """Build a 3-hour forecast entry for today + offset days at the given hour."""
    dt = datetime.now(timezone.utc).replace(hour=hour, minute=0, second=0, microsecond=0)
    dt += timedelta(days=date_offset_days)
    return {
        "dt": int(dt.timestamp()),
        "main": {"temp": 28.5, "temp_max": 33.5, "temp_min": 26.0},
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
    data = {"list": [_make_entry(1)]}
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
    data = {"list": [_make_entry(1, pop=0.82)]}
    client = _mock_client(data)
    with patch("app.services.openweather.httpx.AsyncClient", return_value=client):
        result = await get_forecast(date_str)

    assert result["rain_probability"] == 82


@pytest.mark.asyncio
async def test_get_forecast_aggregates_multiple_entries(monkeypatch):
    """Multiple 3-hour entries for same day: picks max temp_max, min temp_min, max pop."""
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    date_str = _target_date(1)
    entries = [
        {**_make_entry(1, hour=6),  "main": {"temp": 26.0, "temp_max": 28.0, "temp_min": 25.0}, "pop": 0.2},
        {**_make_entry(1, hour=12), "main": {"temp": 31.0, "temp_max": 33.5, "temp_min": 26.0}, "pop": 0.82},
        {**_make_entry(1, hour=18), "main": {"temp": 29.0, "temp_max": 30.0, "temp_min": 25.5}, "pop": 0.5},
    ]
    data = {"list": entries}
    client = _mock_client(data)
    with patch("app.services.openweather.httpx.AsyncClient", return_value=client):
        result = await get_forecast(date_str)

    assert result["temp_max"] == 33.5
    assert result["temp_min"] == 25.0
    assert result["rain_probability"] == 82


@pytest.mark.asyncio
async def test_get_forecast_date_not_found_raises(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    data = {"list": [_make_entry(1)]}  # only tomorrow, not 10 days later
    client = _mock_client(data)
    far_future = _target_date(10)
    with patch("app.services.openweather.httpx.AsyncClient", return_value=client):
        with pytest.raises(WeatherUnavailableError, match="5-day window"):
            await get_forecast(far_future)


@pytest.mark.asyncio
async def test_get_forecast_invalid_date_raises(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    with pytest.raises(WeatherUnavailableError, match="Invalid date format"):
        await get_forecast("not-a-date")


@pytest.mark.asyncio
async def test_get_forecast_malformed_entry_skipped(monkeypatch):
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    good_entry = _make_entry(1)
    data = {"list": [{"no_dt_field": True}, good_entry]}
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
async def test_get_forecast_window_caches_single_http_call(monkeypatch):
    """Second call within TTL is served from cache — only one HTTP request is made."""
    monkeypatch.setattr(_ow.settings, "openweather_api_key", "test-key")
    data = {"list": [_make_entry(1, hour=4, pop=0.82)]}  # 04:00 UTC → 12:00 SGT, same date
    client = _mock_client(data)
    with patch("app.services.openweather.httpx.AsyncClient", return_value=client):
        w1 = await get_forecast_window(1.30, 103.85)
        w2 = await get_forecast_window(1.30, 103.85)

    assert client.get.call_count == 1
    assert w1 == w2
    day = next(iter(w1.values()))
    assert "slots" in day and day["slots"][0]["pop"] == 0.82
    assert day["rain_probability"] == 82


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
