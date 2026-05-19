"""
Adaptation Agent.
- Automatic trigger: polls LTA every 2 min while a trip is active.
- Manual trigger: POST /trips/{id}/adapt.
- Weather trigger: polls OpenWeather every 30 min; rain_probability > 70% → suggest indoor swap.
"""

async def poll_lta_alerts():
    # [CODE] Poll LTA DataMall every 2 minutes
    # [CODE] If delay affects active trip → insert lta_alerts, recalculate remaining legs
    # On LTAUnavailableError → insert alert type="service_unavailable", do not recalculate
    raise NotImplementedError

async def poll_weather_alerts():
    # [CODE] Poll OpenWeather every 30 minutes
    # [CODE] If rain_probability > 70% + outdoor places in active trip
    #        → insert lta_alerts with alert_type="weather_warning"
    # On WeatherUnavailableError → log warning, skip (do not insert)
    raise NotImplementedError

async def adapt_trip(trip_id: str, reason: str | None = None):
    # [CODE] Recalculate plan from current position
    # [CODE] If weather context: replace outdoor places with indoor alternatives
    # [CODE] Recalculate route_legs via OneMap for new places
    raise NotImplementedError
