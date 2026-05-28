import httpx
from datetime import date, datetime, timezone
from app.config import settings

SINGAPORE_LAT = 1.3521
SINGAPORE_LNG = 103.8198

_BASE = "https://api.openweathermap.org/data/2.5/forecast"


class WeatherUnavailableError(Exception):
    pass


async def get_forecast(
    date_str: str,
    lat: float = SINGAPORE_LAT,
    lng: float = SINGAPORE_LNG,
) -> dict:
    """Return weather forecast for the given coordinates on the given date (YYYY-MM-DD).

    Uses OpenWeather Forecast 2.5 (free tier, 5-day / 3-hour intervals).
    Aggregates all 3-hour entries for the target day: max temp, min temp,
    max rain probability, and condition from the highest-pop entry.
    Raises WeatherUnavailableError if key is missing, API is down,
    or the date is outside the 5-day forecast window.
    """
    if not settings.openweather_api_key:
        raise WeatherUnavailableError("OpenWeather API key not configured")

    try:
        target = date.fromisoformat(date_str)
    except ValueError:
        raise WeatherUnavailableError(
            f"Invalid date format: {date_str!r} — expected YYYY-MM-DD"
        )

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

    entries = []
    for entry in data.get("list", []):
        try:
            entry_date = datetime.fromtimestamp(entry["dt"], tz=timezone.utc).date()
            if entry_date == target:
                entries.append(entry)
        except (KeyError, TypeError, OSError):
            continue

    if not entries:
        raise WeatherUnavailableError(
            f"No forecast available for {date_str} (beyond 5-day window or date not returned)"
        )

    temp_max = max(e["main"]["temp_max"] for e in entries)
    temp_min = min(e["main"]["temp_min"] for e in entries)
    rain_prob = max(e.get("pop", 0.0) for e in entries)
    best = max(entries, key=lambda e: e.get("pop", 0.0))
    condition = best.get("weather", [{}])[0].get("main", "Unknown")

    return {
        "date": date_str,
        "condition": condition,
        "rain_probability": round(rain_prob * 100),
        "temp_max": round(temp_max, 1),
        "temp_min": round(temp_min, 1),
    }
