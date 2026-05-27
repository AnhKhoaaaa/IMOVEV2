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


def _validate_time(t: str, place_id: str, field: str) -> None:
    """Raise ValueError at startup if a time string in places.json is malformed."""
    parts = t.split(":")
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        raise ValueError(f"places.json [{place_id}] invalid {field}: '{t}' — expected HH:MM")


# Load and validate once at import time — bad data surfaces at startup, not runtime.
with open(_PLACES_PATH, encoding="utf-8") as _f:
    _raw: list[dict] = json.load(_f)

_REQUIRED_KEYS = {"id", "name", "lat", "lng", "category", "is_outdoor", "dwell_minutes", "best_time_start", "best_time_end"}
for _p in _raw:
    missing = _REQUIRED_KEYS - set(_p.keys())
    if missing:
        raise RuntimeError(f"places.json entry '{_p.get('id', '?')}' missing required keys: {missing}")
    _validate_time(_p["best_time_start"], _p["id"], "best_time_start")
    _validate_time(_p["best_time_end"], _p["id"], "best_time_end")

_PLACES: dict[str, dict] = {p["id"]: p for p in _raw}
del _raw


def get_curated_place(place_id: str) -> dict | None:
    """Public accessor for _PLACES — use this instead of importing _PLACES directly."""
    return _PLACES.get(place_id)


def get_all_places() -> dict:
    """Public accessor for the full _PLACES dict — use instead of importing _PLACES directly."""
    return _PLACES

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


async def _resolve_via_gemini(name: str) -> str | None:
    """Resolve an ambiguous place name to a curated ID via Gemini. Returns None on any failure."""
    try:
        from app.services import gemini  # lazy import — avoids circular issues and test noise
        candidates = await gemini.parse_places_input(name)
        if not candidates:
            return None
        first = candidates[0].lower().strip()
        for pid, place in _PLACES.items():
            place_lower = place["name"].lower()
            if first in place_lower or place_lower in first:
                return pid
        return None
    except Exception:
        return None  # never block planning on Gemini failure


async def plan_trip(
    trip_id: str,
    place_ids: list[str],
    num_days: int,
    budget_sgd: float,
    optimize_order: bool,
    preferences: dict | None,
) -> TripPlan:
    prefs = preferences or {}

    # [CODE] 1. Validate place_ids; try Gemini resolution for unrecognized entries
    resolved: list[str] = []
    for pid in place_ids:
        if pid in _PLACES:
            resolved.append(pid)
        else:
            # [LLM] Gemini fallback: treat as a free-text name, resolve to curated ID
            resolved_id = await _resolve_via_gemini(pid)
            if resolved_id is None:
                raise PlaceDataMissingError(pid)
            resolved.append(resolved_id)
    place_ids = resolved

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
                    geometry = route.get("geometry")
                    instructions = route.get("instructions", [])
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
                    instructions=instructions,
                    geometry=geometry,
                ))

        days.append(DayPlan(day=day_idx + 1, legs=legs))

    # [CODE] 5. Budget check — after all legs are computed
    if total_cost > budget_sgd:
        raise BudgetExceededError(total_cost, budget_sgd)

    # Inform caller when fewer days were needed than requested
    if len(days) < num_days:
        warnings.append(
            f"All {len(places)} places fit in {len(days)} day(s) — "
            f"add more places to fill {num_days} days."
        )

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
