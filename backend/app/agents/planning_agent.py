"""
Planning Agent — 75% code, 25% LLM.
LLM (Gemini) is called ONLY for edge cases not covered by rule-based logic.
"""

import json
import math
import uuid
from pathlib import Path

from app.services import onemap
from app.services.onemap import NoRouteError
from app.exceptions import PlaceDataMissingError, BudgetExceededError
from app.models.trip import TripPlan, DayPlan, LegResponse
from app.models.place import Place

_PLACES_PATH = Path(__file__).parent.parent / "data" / "places.json"

# Load once at import time — static dataset, no hot-reload needed
with open(_PLACES_PATH, encoding="utf-8") as _f:
    _PLACES: dict[str, dict] = {p["id"]: p for p in json.load(_f)}

# Map OneMap transit modes to display labels
_MODE_MAP = {"SUBWAY": "MRT", "TRAM": "LRT", "BUS": "BUS", "WALK": "WALK"}


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _sort_places_greedy(places: list[dict]) -> list[dict]:
    """Greedy nearest-neighbor sort — O(n²), acceptable for n≤50."""
    if len(places) <= 1:
        return list(places)
    result = [places[0]]
    remaining = list(places[1:])
    while remaining:
        last = result[-1]
        nearest = min(
            remaining,
            key=lambda p: _haversine_km(last["lat"], last["lng"], p["lat"], p["lng"]),
        )
        result.append(nearest)
        remaining.remove(nearest)
    return result


def _distribute_days(places: list[dict], num_days: int) -> list[list[dict]]:
    """Distribute places into days with max 480 min dwell per day."""
    days: list[list[dict]] = [[]]
    day_dwell = 0
    for place in places:
        dwell = place.get("dwell_minutes", 60)
        if day_dwell + dwell > 480 and days[-1] and len(days) < num_days:
            days.append([])
            day_dwell = 0
        days[-1].append(place)
        day_dwell += dwell
    return days


def _primary_mode(legs: list[dict]) -> str:
    """Pick the first non-WALK mode from OneMap leg list."""
    for leg in legs:
        raw = leg.get("mode", "").upper()
        if raw not in ("WALK", ""):
            return _MODE_MAP.get(raw, raw)
    return "WALK"


def _parse_hhmm(t: str) -> int:
    """'HH:MM' → minutes since midnight."""
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _fmt_hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


async def plan_trip(
    trip_id: str,
    place_ids: list[str],
    num_days: int,
    budget_sgd: float,
    optimize_order: bool,
    preferences: dict | None,
) -> TripPlan:
    prefs = preferences or {}

    # [CODE] 1. Validate all place_ids exist in curated dataset
    for pid in place_ids:
        if pid not in _PLACES:
            raise PlaceDataMissingError(pid)

    places = [_PLACES[pid] for pid in place_ids]

    # [CODE] 2. Greedy nearest-neighbor sort if requested
    if optimize_order:
        places = _sort_places_greedy(places)

    # [CODE] 3. Distribute across days (cap: 480 min dwell/day)
    day_groups = _distribute_days(places, num_days)

    # [CODE] 4. Build legs — call OneMap for each consecutive pair
    days: list[DayPlan] = []
    total_cost = 0.0
    warnings: list[str] = []

    for day_idx, day_places in enumerate(day_groups):
        legs: list[LegResponse] = []
        current_time = 540  # tour starts at 09:00 (minutes since midnight)

        for i, place in enumerate(day_places):
            # Check best_time for this place
            best_start = _parse_hhmm(place["best_time_start"])
            best_end = _parse_hhmm(place["best_time_end"])
            if not (best_start <= current_time <= best_end):
                warnings.append(
                    f"{place['name']}: best time {place['best_time_start']}–"
                    f"{place['best_time_end']}, you arrive at {_fmt_hhmm(current_time)}"
                )

            # Advance clock by dwell at this place
            current_time += place.get("dwell_minutes", 60)

            if i < len(day_places) - 1:
                from_p = place
                to_p = day_places[i + 1]
                try:
                    route = await onemap.get_route(
                        from_p["lat"], from_p["lng"],
                        to_p["lat"], to_p["lng"],
                        mode="pt",
                    )
                    transport_mode = _primary_mode(route.get("legs", []))
                    duration = route["duration_minutes"]
                    cost = route["fare_sgd"]
                    is_estimated = False
                except NoRouteError:
                    # Hard failure — no route exists → bubble up to router → HTTP 422
                    raise NoRouteError(
                        f"No route available from '{from_p['id']}' to '{to_p['id']}'"
                    )
                except Exception as exc:
                    # Network / transient error — raise as NoRouteError per anti-hallucination rule.
                    # We must never fabricate duration or cost values.
                    raise NoRouteError(
                        f"Transit routing unavailable from '{from_p['id']}' to '{to_p['id']}': {exc}"
                    ) from exc

                current_time += duration
                total_cost += cost
                legs.append(LegResponse(
                    id=str(uuid.uuid4()),
                    from_place_id=from_p["id"],
                    to_place_id=to_p["id"],
                    transport_mode=transport_mode,
                    duration_minutes=duration,
                    cost_sgd=cost,
                    is_estimated=is_estimated,
                ))

        days.append(DayPlan(day=day_idx + 1, legs=legs))

    # [CODE] 5. Budget check — after all legs are computed
    if total_cost > budget_sgd:
        raise BudgetExceededError(total_cost, budget_sgd)

    # [LLM] 6. Gemini not called — preferences are structured (prefer_mrt, max_walk_minutes,
    # budget_sgd). Free-text edge cases would require: # [LLM] call_gemini() here.

    response_places = [
        Place(
            id=p["id"],
            name=p["name"],
            lat=p["lat"],
            lng=p["lng"],
            dwell_minutes=p["dwell_minutes"],
            best_time_start=p["best_time_start"],
            best_time_end=p["best_time_end"],
            category=p["category"],
            is_outdoor=p["is_outdoor"],
            in_curated_dataset=True,
        )
        for p in places
    ]

    return TripPlan(id=trip_id, days=days, places=response_places, warnings=warnings)
