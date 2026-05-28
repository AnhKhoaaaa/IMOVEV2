import asyncio
import time
import httpx
from app.config import settings


class NoRouteError(Exception):
    pass


class GeocodingError(Exception):
    pass


_TOKEN_CACHE: dict = {"token": None, "expires_at": 0.0}
_TOKEN_LOCK = asyncio.Lock()

_AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken"


def _extract_pt_geometry(legs: list[dict]) -> str | None:
    """Return encoded polyline from the first transit (non-WALK) leg; fall back to first leg."""
    for leg in legs:
        if leg.get("mode", "").upper() not in ("WALK", ""):
            return leg.get("legGeometry", {}).get("points")
    return legs[0].get("legGeometry", {}).get("points") if legs else None


def _build_pt_instructions(legs: list[dict]) -> list[str]:
    """Build a concise list of human-readable steps from OTP-format itinerary legs."""
    steps: list[str] = []
    for leg in legs:
        mode = leg.get("mode", "").upper()
        duration_min = round(leg.get("duration", 0) / 60)
        from_name = leg.get("from", {}).get("name", "")
        to_name = leg.get("to", {}).get("name", "")
        route = leg.get("route", "")

        if mode == "WALK":
            if to_name:
                steps.append(f"Walk to {to_name} ({duration_min} min)")
            elif duration_min:
                steps.append(f"Walk ({duration_min} min)")
        else:
            if route and from_name:
                steps.append(f"Board {route} line at {from_name}")
            elif from_name:
                steps.append(f"Board at {from_name}")
            if to_name:
                steps.append(f"Alight at {to_name} ({duration_min} min)")
    return steps
_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
_ROUTE_URL = "https://www.onemap.gov.sg/api/public/routingsvc/route"


async def _get_token() -> str:
    # Fast path — no lock needed for a cache hit
    if _TOKEN_CACHE["token"] and time.time() < _TOKEN_CACHE["expires_at"] - 60:
        return _TOKEN_CACHE["token"]
    # Slow path — serialise refresh so only one coroutine hits the auth endpoint
    async with _TOKEN_LOCK:
        if _TOKEN_CACHE["token"] and time.time() < _TOKEN_CACHE["expires_at"] - 60:
            return _TOKEN_CACHE["token"]
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    _AUTH_URL,
                    json={"email": settings.onemap_email, "password": settings.onemap_password},
                )
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            raise NoRouteError(f"OneMap auth failed: {exc}") from exc
        _TOKEN_CACHE["token"] = data["access_token"]
        _TOKEN_CACHE["expires_at"] = float(data["expiry_timestamp"])
        return _TOKEN_CACHE["token"]


async def geocode(place_name: str) -> dict:
    """Search OneMap for a place name. Returns {lat, lng, address} of the top result.

    Raises GeocodingError on HTTP/network failure or when no results are found.
    """
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                _SEARCH_URL,
                params={
                    "searchVal": place_name,
                    "returnGeom": "Y",
                    "getAddrDetails": "Y",
                    "pageNum": 1,
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise GeocodingError(f"OneMap geocode unavailable: {exc}") from exc
    if not data.get("results"):
        raise GeocodingError(f"No results for '{place_name}'")
    first = data["results"][0]
    return {
        "lat": float(first["LATITUDE"]),
        "lng": float(first["LONGITUDE"]),
        "address": first.get("ADDRESS", place_name),
    }


async def get_route(
    from_lat: float,
    from_lng: float,
    to_lat: float,
    to_lng: float,
    mode: str,
) -> dict:
    """Get a route via OneMap Routing API.

    mode: "pt" (public transit), "walk", "drive", "cycle"
    Returns {duration_minutes, fare_sgd, legs}.
    Raises NoRouteError when no viable route exists or the API is unavailable.
    """
    token = await _get_token()
    headers = {"Authorization": f"Bearer {token}"}
    params: dict = {
        "start": f"{from_lat},{from_lng}",
        "end": f"{to_lat},{to_lng}",
        "routeType": mode.lower(),
    }
    if mode.lower() == "pt":
        now = time.gmtime()
        params.update({
            "date": time.strftime("%m-%d-%Y", now),
            "time": time.strftime("%H:%M:%S", now),
            "mode": "TRANSIT",
            "numItineraries": 1,
        })
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(_ROUTE_URL, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        raise NoRouteError(f"OneMap routing unavailable: {exc}") from exc

    if mode.lower() == "pt":
        itineraries = data.get("plan", {}).get("itineraries", [])
        if not itineraries:
            raise NoRouteError(
                f"No PT route from ({from_lat},{from_lng}) to ({to_lat},{to_lng})"
            )
        itin = itineraries[0]
        itin_legs = itin.get("legs", [])
        legs = [
            {
                "mode": leg["mode"],
                "duration_minutes": round(leg["duration"] / 60),
                "instruction": leg.get("route", ""),
            }
            for leg in itin_legs
        ]
        total_distance_m = sum(leg.get("distance", 0) for leg in itin_legs)
        raw_fare = itin.get("fare", 0.0)
        try:
            fare_sgd = float(raw_fare)
        except (ValueError, TypeError):
            fare_sgd = 0.0  # OneMap returns "info unavailable" for some routes
        return {
            "duration_minutes": round(itin["duration"] / 60),
            "fare_sgd": fare_sgd,
            "legs": legs,
            "geometry": _extract_pt_geometry(itin_legs),
            "instructions": _build_pt_instructions(itin_legs),
            "distance_km": round(total_distance_m / 1000, 2),
        }
    else:
        summary = data.get("route_summary", {})
        if not summary:
            raise NoRouteError(
                f"No {mode} route from ({from_lat},{from_lng}) to ({to_lat},{to_lng})"
            )
        return {
            "duration_minutes": round(summary["total_time"] / 60),
            "fare_sgd": 0.0,
            "legs": [
                {
                    "mode": mode.upper(),
                    "duration_minutes": round(summary["total_time"] / 60),
                    "instruction": "",
                }
            ],
            "geometry": data.get("route_geometry"),
            "instructions": [],
            "distance_km": round(summary.get("total_distance", 0) / 1000, 2),
        }
