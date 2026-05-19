import httpx

SINGAPORE_LAT = 1.3521
SINGAPORE_LNG = 103.8198

class WeatherUnavailableError(Exception):
    pass

# [CODE] Get weather forecast for a date (Singapore coordinates)
# Returns {date, condition, rain_probability, temp_max, temp_min}
# Raises WeatherUnavailableError on API failure — soft error, Adaptation Agent skips weather check
async def get_forecast(date: str) -> dict:
    raise NotImplementedError
