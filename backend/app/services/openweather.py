import httpx
from datetime import date, datetime, timezone
from app.config import settings

SINGAPORE_LAT = 1.3521
SINGAPORE_LNG = 103.8198

_BASE = "https://api.openweathermap.org/data/3.0/onecall"


class WeatherUnavailableError(Exception):
    pass


async def get_forecast(date_str: str) -> dict:
    """Return weather forecast for Singapore on the given date (YYYY-MM-DD).

    Uses OpenWeather One Call 3.0 daily forecast (8-day window).
    Raises WeatherUnavailableError if key is missing, API is down,
    or the date is outside the 8-day forecast window.
    """
    if not settings.openweather_api_key:
        raise WeatherUnavailableError("OpenWeather API key not configured")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                _BASE,
                params={
                    "lat": SINGAPORE_LAT,
                    "lon": SINGAPORE_LNG,
                    "appid": settings.openweather_api_key,
                    "units": "metric",
                    "exclude": "current,minutely,hourly,alerts",
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise WeatherUnavailableError(f"OpenWeather unavailable: {exc}") from exc

    try:
        target = date.fromisoformat(date_str)
    except ValueError:
        raise WeatherUnavailableError(
            f"Invalid date format: {date_str!r} — expected YYYY-MM-DD"
        )

    for day in data.get("daily", []):
        try:
            day_date = datetime.fromtimestamp(day["dt"], tz=timezone.utc).date()
            if day_date != target:
                continue
            weather = day.get("weather", [{}])[0]
            return {
                "date": date_str,
                "condition": weather.get("main", "Unknown"),
                "rain_probability": round(day.get("pop", 0.0) * 100),
                "temp_max": round(day["temp"]["max"], 1),
                "temp_min": round(day["temp"]["min"], 1),
            }
        except (KeyError, TypeError):
            continue  # skip malformed entries; fall through to WeatherUnavailableError

    raise WeatherUnavailableError(
        f"No forecast available for {date_str} (beyond 8-day window or date not returned)"
    )
