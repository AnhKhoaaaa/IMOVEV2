import httpx
from datetime import datetime, timezone
from app.config import settings

class LTAUnavailableError(Exception):
    pass

_BASE = "https://datamall2.mytransport.sg/ltaodataservice"


def _headers() -> dict:
    return {"AccountKey": settings.lta_api_key, "accept": "application/json"}


def _minutes_until(iso_str: str) -> int:
    if not iso_str:
        return -1
    try:
        arrival = datetime.fromisoformat(iso_str)
    except ValueError:
        return -1
    # Naive timestamps are LTA "no bus" placeholders (e.g. "0001-01-01T00:00:00")
    if arrival.tzinfo is None:
        return -1
    delta = (arrival - datetime.now(timezone.utc)).total_seconds()
    return max(0, round(delta / 60))


async def get_bus_arrival(bus_stop_code: str) -> list[dict]:
    """Return next arrivals for every service at a bus stop.

    Raises LTAUnavailableError on any HTTP or network failure.
    """
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{_BASE}/v3/BusArrival",
                params={"BusStopCode": bus_stop_code},
                headers=_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise LTAUnavailableError(f"LTA BusArrival unavailable: {exc}") from exc

    return [
        {
            "service_no": svc["ServiceNo"],
            "next_arrival_minutes": _minutes_until(
                svc.get("NextBus", {}).get("EstimatedArrival", "")
            ),
            "next_arrival_2_minutes": _minutes_until(
                svc.get("NextBus2", {}).get("EstimatedArrival", "")
            ),
            "load": svc.get("NextBus", {}).get("Load", ""),
        }
        for svc in data.get("Services") or []
    ]


async def get_train_alerts() -> list[dict]:
    """Return active train disruption alerts.

    Returns [] when all lines are normal (Status == 1).
    Raises LTAUnavailableError on any HTTP or network failure.
    """
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{_BASE}/TrainServiceAlerts",
                headers=_headers(),
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise LTAUnavailableError(f"LTA TrainServiceAlerts unavailable: {exc}") from exc

    value = data.get("value") or {}
    if value.get("Status", 1) == 1:
        return []

    messages = [m.get("Content", "") for m in value.get("Message", [])]
    top_message = messages[0] if messages else ""

    return [
        {
            "status": 2,
            "affected_line": seg.get("Line", ""),
            "message": top_message,
        }
        for seg in value.get("AffectedSegments", [])
    ]
