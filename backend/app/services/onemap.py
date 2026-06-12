import asyncio
import time
import httpx
from datetime import datetime
from zoneinfo import ZoneInfo
from app.config import settings

_SGT = ZoneInfo("Asia/Singapore")


class NoRouteError(Exception):
    pass


class GeocodingError(Exception):
    pass


_TOKEN_CACHE: dict = {"token": None, "expires_at": 0.0}
_TOKEN_LOCK = asyncio.Lock()

_AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken"


_MODE_REMAP: dict[str, str] = {"SUBWAY": "METRO", "TRAM": "METRO", "BUS": "BUS", "WALK": "WALK"}


def _extract_sub_legs(legs: list[dict]) -> list[dict]:
    """Convert raw OneMap OTP legs into PTSubLeg-shaped dicts."""
    result = []
    for leg in legs:
        raw_mode = leg.get("mode", "WALK").upper()
        raw_stops = leg.get("intermediateStops", [])
        result.append({
            "mode": _MODE_REMAP.get(raw_mode, "WALK"),
            "route": leg.get("route", ""),
            "from_name": leg.get("from", {}).get("name", ""),
            "to_name": leg.get("to", {}).get("name", ""),
            "from_stop_code": leg.get("from", {}).get("stopCode", ""),
            "to_stop_code": leg.get("to", {}).get("stopCode", ""),
            "duration_minutes": int(round(float(leg.get("duration", 0) or 0) / 60)),
            "num_stops": int(leg.get("numStops") or 0),
            "geometry": leg.get("legGeometry", {}).get("points"),
            "intermediate_stops": [
                {"name": s.get("name", ""), "stop_code": s.get("stopCode", "")}
                for s in raw_stops
            ],
        })
    return result


def _extract_pt_geometry(legs: list[dict]) -> str | None:
    """Return encoded polyline from the first transit (non-WALK) leg; fall back to first leg."""
    for leg in legs:
        if leg.get("mode", "").upper() not in ("WALK", ""):
            return leg.get("legGeometry", {}).get("points")
    return legs[0].get("legGeometry", {}).get("points") if legs else None


def _extract_all_geometries(legs: list[dict]) -> list[str]:
    """Return encoded polylines for ALL legs (including WALK), preserving order."""
    return [
        leg["legGeometry"]["points"]
        for leg in legs
        if leg.get("legGeometry", {}).get("points")
    ]


def _build_pt_instructions(legs: list[dict]) -> list[str]:
    """Build a concise list of human-readable steps from OTP-format itinerary legs."""
    steps: list[str] = []
    for leg in legs:
        mode = leg.get("mode", "").upper()
        duration_min = int(round(float(leg.get("duration", 0) or 0) / 60))
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


def _pt_summary(sub_legs: list[dict]) -> str:
    """Derive a short human summary from PT sub-legs (e.g. 'via EW line')."""
    transit = next((s for s in sub_legs if s.get("mode") != "WALK" and s.get("route")), None)
    return f"via {transit['route']} line" if transit else ""


async def get_all_routes(
    from_lat: float, from_lng: float, to_lat: float, to_lng: float
) -> dict:
    """Fetch PT, walk, and cycle routes in parallel.

    Returns {"pt": {...}, "walk": {...}, "cycle": {...}}.
    Each value has keys: available, duration_minutes, fare_sgd, distance_km, summary.
    A mode that fails with NoRouteError returns available=False instead of raising.
    """
    _UNAVAILABLE = {"available": False, "duration_minutes": 0, "fare_sgd": 0.0, "distance_km": 0.0, "summary": ""}

    async def _safe(mode: str) -> dict:
        try:
            r = await get_route(from_lat, from_lng, to_lat, to_lng, mode)
            if mode == "pt":
                sub_legs = r.get("sub_legs", [])
                if not any(s.get("mode") != "WALK" for s in sub_legs):
                    return dict(_UNAVAILABLE)
                summary = _pt_summary(sub_legs)
            else:
                summary = "direct"
            return {
                "available": True,
                "duration_minutes": r["duration_minutes"],
                "fare_sgd": r.get("fare_sgd", 0.0),
                "distance_km": r.get("distance_km", 0.0),
                "summary": summary,
            }
        except NoRouteError:
            return dict(_UNAVAILABLE)

    pt, walk, cycle = await asyncio.gather(_safe("pt"), _safe("walk"), _safe("cycle"))
    return {"pt": pt, "walk": walk, "cycle": cycle}


_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search"
_ROUTE_URL = "https://www.onemap.gov.sg/api/public/routingsvc/route"

# /optimize fans out _fetch_all_alternatives() (5 routing calls) across every place
# pair via asyncio.gather — without a cap, a multi-day plan can fire dozens of
# concurrent requests and trip OneMap's rate limit, causing scattered failures
# that fall back to is_estimated=True routes (locking the day tabs in the UI).
_ROUTE_SEMAPHORE = asyncio.Semaphore(6)
_ROUTE_RETRY_DELAY_S = 0.5

# OTP returns its single best itinerary first; for short legs that is often all-walk,
# hiding viable transit. Request a few so we can pick the best one that actually rides transit.
_PT_NUM_ITINERARIES = 4


def _has_transit(itin: dict) -> bool:
    """True when an OTP itinerary uses at least one non-walk leg (bus/rail/etc.)."""
    return any(
        (leg.get("mode") or "").upper() not in ("WALK", "")
        for leg in itin.get("legs", [])
    )


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
    transit_modes: str | None = None,
) -> dict:
    """Get a route via OneMap Routing API.

    mode: "pt" (public transit), "walk", "drive", "cycle"
    transit_modes: optional OTP filter for PT mode, e.g. "BUS" for bus-only routes.
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
        now_sgt = datetime.now(tz=_SGT)
        params.update({
            "date": now_sgt.strftime("%m-%d-%Y"),
            "time": now_sgt.strftime("%H:%M:%S"),
            "mode": "TRANSIT",
            "numItineraries": _PT_NUM_ITINERARIES,
        })
        if transit_modes:
            params["transitModes"] = transit_modes  # e.g. "BUS" for bus-only routing
    last_exc: Exception | None = None
    for attempt in range(2):  # one retry on transient rate-limit/timeout
        if attempt:
            await asyncio.sleep(_ROUTE_RETRY_DELAY_S)
        try:
            async with _ROUTE_SEMAPHORE:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(_ROUTE_URL, params=params, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()
            break
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            last_exc = exc
    else:
        raise NoRouteError(f"OneMap routing unavailable: {last_exc}") from last_exc

    if mode.lower() == "pt":
        itineraries = data.get("plan", {}).get("itineraries", [])
        if not itineraries:
            raise NoRouteError(
                f"No PT route from ({from_lat},{from_lng}) to ({to_lat},{to_lng})"
            )
        # Prefer OTP's best transit itinerary; fall back to its first when every option is
        # all-walk (so a genuinely walk-only pair still resolves instead of disappearing).
        itin = next((it for it in itineraries if _has_transit(it)), itineraries[0])
        itin_legs = itin.get("legs", [])
        legs = [
            {
                "mode": leg["mode"],
                "duration_minutes": int(round(float(leg.get("duration", 0) or 0) / 60)),
                "instruction": leg.get("route", ""),
            }
            for leg in itin_legs
        ]
        total_distance_m = sum(float(leg.get("distance", 0) or 0) for leg in itin_legs)
        raw_fare = itin.get("fare", 0.0)
        try:
            fare_sgd = float(raw_fare)
        except (ValueError, TypeError):
            fare_sgd = 0.0  # OneMap returns "info unavailable" for some routes
        return {
            "duration_minutes": int(round(float(itin.get("duration", 0)) / 60)),
            "fare_sgd": fare_sgd,
            "legs": legs,
            "geometry": _extract_pt_geometry(itin_legs),
            "geometries": _extract_all_geometries(itin_legs),
            "instructions": _build_pt_instructions(itin_legs),
            "distance_km": round(total_distance_m / 1000, 2),
            "sub_legs": _extract_sub_legs(itin_legs),
        }
    else:
        summary = data.get("route_summary", {})
        if not summary:
            raise NoRouteError(
                f"No {mode} route from ({from_lat},{from_lng}) to ({to_lat},{to_lng})"
            )
        total_time     = float(summary.get("total_time",     0) or 0)
        total_distance = float(summary.get("total_distance", 0) or 0)
        duration_min   = int(round(total_time / 60))
        return {
            "duration_minutes": duration_min,
            "fare_sgd": 0.0,
            "legs": [
                {
                    "mode": mode.upper(),
                    "duration_minutes": duration_min,
                    "instruction": "",
                }
            ],
            "geometry": data.get("route_geometry"),
            "geometries": [data["route_geometry"]] if data.get("route_geometry") else [],
            "instructions": data.get("route_instructions") or [],
            "distance_km": round(total_distance / 1000, 2),
        }
