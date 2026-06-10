import time
import httpx
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from app.config import settings

SINGAPORE_LAT = 1.3521
SINGAPORE_LNG = 103.8198
_SGT = ZoneInfo("Asia/Singapore")

_BASE = "https://api.openweathermap.org/data/2.5/forecast"
_CURRENT_BASE = "https://api.openweathermap.org/data/2.5/weather"

# In-process TTL cache for the 5-day window: {(round_lat, round_lng): (expires_monotonic, day_map)}.
# Collapses N per-day calls into one HTTP request per coord per TTL (dev19 P1.1).
_forecast_cache: dict[tuple[float, float], tuple[float, dict]] = {}


class WeatherUnavailableError(Exception):
    pass


def _clear_forecast_cache() -> None:
    """Test/maintenance hook — drop all cached forecast windows."""
    _forecast_cache.clear()


async def get_current_weather(
    lat: float = SINGAPORE_LAT,
    lng: float = SINGAPORE_LNG,
) -> dict:
    """Return current weather for the given coordinates.

    Returns dict with keys: condition, temp_c, rain_1h (mm).
    rain_1h = 0.0 when it is not raining.
    Raises WeatherUnavailableError on API failure or missing key.
    """
    if not settings.openweather_api_key:
        raise WeatherUnavailableError("OpenWeather API key not configured")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                _CURRENT_BASE,
                params={
                    "lat": lat,
                    "lon": lng,
                    "appid": settings.openweather_api_key,
                    "units": "metric",
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise WeatherUnavailableError(f"OpenWeather current unavailable: {exc}") from exc

    condition = data.get("weather", [{}])[0].get("main", "Unknown")
    temp_c    = data.get("main", {}).get("temp", 0.0)
    rain_1h   = float(data.get("rain", {}).get("1h", 0.0) or 0.0)

    return {
        "condition": condition,
        "temp_c":    round(temp_c, 1),
        "rain_1h":   rain_1h,
    }


async def get_forecast_window(
    lat: float = SINGAPORE_LAT,
    lng: float = SINGAPORE_LNG,
) -> dict[str, dict]:
    """Return the whole 5-day window as { "YYYY-MM-DD": day_agg }, fetched in ONE call.

    Each day_agg aggregates that day's 3-hour entries (dates/hours in SGT, since the app
    is Singapore-local and best_time_* are local):
        { date, condition, rain_probability(0-100), temp_max, temp_min,
          slots: [ { hour(0-23 SGT), pop(0-1), condition } ] }

    Result is cached per rounded coord for `weather_forecast_ttl_s`. Raises
    WeatherUnavailableError if the key is missing or the API is down.
    """
    if not settings.openweather_api_key:
        raise WeatherUnavailableError("OpenWeather API key not configured")

    key = (round(lat, 2), round(lng, 2))
    cached = _forecast_cache.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                _BASE,
                params={
                    "lat": lat,
                    "lon": lng,
                    "appid": settings.openweather_api_key,
                    "units": "metric",
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise WeatherUnavailableError(f"OpenWeather unavailable: {exc}") from exc

    by_day: dict[str, list[tuple[datetime, dict]]] = {}
    for entry in data.get("list", []):
        try:
            dt = datetime.fromtimestamp(entry["dt"], tz=timezone.utc).astimezone(_SGT)
        except (KeyError, TypeError, OSError):
            continue
        by_day.setdefault(dt.date().isoformat(), []).append((dt, entry))

    day_map: dict[str, dict] = {}
    for date_str, items in by_day.items():
        entries = [e for _, e in items]
        temp_max = max(e["main"]["temp_max"] for e in entries)
        temp_min = min(e["main"]["temp_min"] for e in entries)
        rain_prob = max(e.get("pop", 0.0) for e in entries)
        best = max(entries, key=lambda e: e.get("pop", 0.0))
        day_map[date_str] = {
            "date": date_str,
            "condition": best.get("weather", [{}])[0].get("main", "Unknown"),
            "rain_probability": round(rain_prob * 100),
            "temp_max": round(temp_max, 1),
            "temp_min": round(temp_min, 1),
            "slots": [
                {
                    "hour": dt.hour,
                    "pop": float(e.get("pop", 0.0)),
                    "condition": e.get("weather", [{}])[0].get("main", "Unknown"),
                }
                for dt, e in items
            ],
        }

    _forecast_cache[key] = (time.monotonic() + settings.weather_forecast_ttl_s, day_map)
    return day_map


async def get_forecast(
    date_str: str,
    lat: float = SINGAPORE_LAT,
    lng: float = SINGAPORE_LNG,
) -> dict:
    """Return the aggregated forecast for one date (YYYY-MM-DD). Thin wrapper over
    get_forecast_window (single cached fetch). Raises WeatherUnavailableError if the
    key is missing, the API is down, or the date is outside the 5-day window.
    """
    try:
        date.fromisoformat(date_str)
    except ValueError:
        raise WeatherUnavailableError(
            f"Invalid date format: {date_str!r} — expected YYYY-MM-DD"
        )

    window = await get_forecast_window(lat, lng)
    day = window.get(date_str)
    if not day:
        raise WeatherUnavailableError(
            f"No forecast available for {date_str} (beyond 5-day window or date not returned)"
        )
    return {k: v for k, v in day.items() if k != "slots"}
