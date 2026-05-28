"""
Planning Agent — 75% code, 25% LLM.
LLM (Gemini) is called ONLY for edge cases not covered by rule-based logic.
"""

import asyncio
import json
import math
import uuid
from pathlib import Path

from app.services import onemap
from app.services.onemap import NoRouteError
from app.exceptions import PlaceDataMissingError, BudgetExceededError
from app.models.trip import TripPlan, DayPlan, LegResponse, GapNotification
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


_TRAVEL_SPEED_KM_MIN = 0.3   # used only inside greedy for eligibility — never stored
_SG_CENTER = {"lat": 1.3521, "lng": 103.8198}


def _classify_place(place: dict) -> str:
    """Classify a place by its best-visit time window.

    evening : best_time_start >= 17:00
    day     : best_time_end <= 17:00 OR no constraint
    overlap : window straddles 17:00
    """
    start = place.get("best_time_start")
    end   = place.get("best_time_end")
    if not start or not end:
        return "day"
    s, e = _parse_hhmm(start), _parse_hhmm(end)
    if s >= 17 * 60:
        return "evening"
    if e <= 17 * 60:
        return "day"
    return "overlap"


def _pre_assign_evening_places(
    evening: list[dict],
    num_days: int,
    seed_groups: list[list[dict]],
) -> dict[int, list[dict]]:
    """Distribute evening places evenly across days, tie-broken by centroid proximity."""
    result: dict[int, list[dict]] = {i: [] for i in range(num_days)}
    if not evening:
        return result

    def centroid(places: list[dict]) -> tuple[float, float]:
        if not places:
            return (_SG_CENTER["lat"], _SG_CENTER["lng"])
        return (
            sum(p["lat"] for p in places) / len(places),
            sum(p["lng"] for p in places) / len(places),
        )

    centroids = [centroid(seed_groups[i] if i < len(seed_groups) else []) for i in range(num_days)]
    cap = math.ceil(len(evening) / num_days)

    for ep in evening:
        sorted_days = sorted(
            range(num_days),
            key=lambda i: _haversine_km(ep["lat"], ep["lng"], centroids[i][0], centroids[i][1]),
        )
        for day_idx in sorted_days:
            if len(result[day_idx]) < cap:
                result[day_idx].append(ep)
                break
        else:
            least_full = min(range(num_days), key=lambda i: len(result[i]))
            result[least_full].append(ep)

    return result


def _day_bucketed_greedy(
    day_overlap: list[dict],
    evening_by_day: dict[int, list[dict]],
    num_days: int,
) -> tuple[list[list[dict]], list[str]]:
    """Assign and order places across days in a single time-window-aware greedy pass.

    Replaces both _sort_places_greedy and _distribute_days on the optimize path.
    Travel-time estimates (haversine / 0.3 km/min) are used only for eligibility
    checks — they are never stored or returned.
    """
    START_MIN = 540   # 09:00
    END_MIN   = 1020  # 17:00

    day_groups: list[list[dict]] = [[] for _ in range(num_days)]
    pool = list(day_overlap)
    extra_warnings: list[str] = []

    anchor = day_overlap[0] if day_overlap else _SG_CENTER

    for day_idx in range(num_days):
        clock = START_MIN
        last_pos = day_groups[day_idx - 1][-1] if day_idx > 0 and day_groups[day_idx - 1] else anchor

        while clock < END_MIN and pool:
            candidates = []
            for p in pool:
                travel_est = _haversine_km(last_pos["lat"], last_pos["lng"], p["lat"], p["lng"]) / _TRAVEL_SPEED_KM_MIN
                arrival    = clock + travel_est
                dwell      = p.get("dwell_minutes", 60)
                bt_start   = _parse_hhmm(p.get("best_time_start", "00:00"))
                bt_end     = _parse_hhmm(p.get("best_time_end", "23:59"))
                if bt_start <= arrival <= bt_end and arrival + dwell <= END_MIN:
                    candidates.append(p)

            if not candidates:
                # Relax best_time window; still enforce day-end constraint
                for p in pool:
                    t_est = _haversine_km(last_pos["lat"], last_pos["lng"], p["lat"], p["lng"]) / _TRAVEL_SPEED_KM_MIN
                    if clock + t_est + p.get("dwell_minutes", 60) <= END_MIN:
                        candidates.append(p)
                if not candidates:
                    break  # nothing fits today → remaining places flow to next day

            pick = min(candidates, key=lambda p: _haversine_km(last_pos["lat"], last_pos["lng"], p["lat"], p["lng"]))
            travel_est = _haversine_km(last_pos["lat"], last_pos["lng"], pick["lat"], pick["lng"]) / _TRAVEL_SPEED_KM_MIN
            clock += travel_est + pick.get("dwell_minutes", 60)
            day_groups[day_idx].append(pick)
            pool.remove(pick)
            last_pos = pick

        # Evening places: second distance-only greedy pass (17:00–22:00 slot)
        ev = list(evening_by_day.get(day_idx, []))
        while ev:
            pick = min(ev, key=lambda p: _haversine_km(last_pos["lat"], last_pos["lng"], p["lat"], p["lng"]))
            day_groups[day_idx].append(pick)
            ev.remove(pick)
            last_pos = pick

    # Overflow: places that didn't fit any day's daytime window
    for p in pool:
        lightest = min(range(num_days), key=lambda i: len(day_groups[i]))
        day_groups[lightest].append(p)
        extra_warnings.append(
            f"{p['name']}: could not fit in scheduled time window, appended to day {lightest + 1}"
        )

    return [d for d in day_groups if d], extra_warnings


def _parse_opening_hours(s: str) -> tuple[int, int]:
    """Parse "HH:MM-HH:MM" or "24h" → (open_min, close_min) since midnight."""
    if not s or s.strip().lower() == "24h":
        return 0, 1439  # 00:00–23:59
    parts = s.strip().split("-")
    if len(parts) != 2:
        return 0, 1439
    try:
        return _parse_hhmm(parts[0].strip()), _parse_hhmm(parts[1].strip())
    except (ValueError, IndexError):
        return 0, 1439


def _distribute_days(
    places: list[dict],
    num_days: int,
    route_durations: dict[tuple, int] | None = None,
) -> list[list[dict]]:
    """Distribute places into days by simulating a 09:00–17:00 tourist day.

    Each day starts at 09:00 (540 min). A place is added to the current day
    only when arrival_time + dwell ≤ 17:00 (1020 min) AND arrival_time falls
    within the place's opening_hours window. Otherwise the next day is tried.
    Falls back to old 480-min-cap behaviour when no route_durations are given.
    """
    START_MIN = 540    # 09:00
    END_MIN   = 1020   # 17:00

    if route_durations is None:
        # Legacy fallback — used by tests that don't supply transit data
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

    days: list[list[dict]] = [[] for _ in range(num_days)]
    clock: list[int] = [START_MIN] * num_days  # current time per day

    for place in places:
        dwell   = place.get("dwell_minutes", 60)
        oh_open, oh_close = _parse_opening_hours(place.get("opening_hours", "24h"))

        placed = False
        for day_idx in range(num_days):
            # Travel time from last place in this day (0 if day is empty)
            if days[day_idx]:
                prev_id = days[day_idx][-1]["id"]
                travel  = route_durations.get((prev_id, place["id"]), 15)
            else:
                travel = 0

            arrival = clock[day_idx] + travel

            # Opening-hours check: entire visit (arrival → arrival+dwell) must be within hours
            in_hours = oh_open <= arrival and (arrival + dwell) <= oh_close
            # Day-end check
            fits_day = arrival + dwell <= END_MIN

            if in_hours and fits_day:
                days[day_idx].append(place)
                clock[day_idx] = arrival + dwell
                placed = True
                break

        if not placed:
            # Best-effort: put it in the day with the most remaining capacity.
            # Compute prev_id BEFORE appending so [-1] is the last existing place, not the new one.
            best_day = min(range(num_days), key=lambda i: clock[i])
            prev_id = days[best_day][-1]["id"] if days[best_day] else None
            travel = route_durations.get((prev_id, place["id"]), 15) if prev_id else 0
            days[best_day].append(place)
            clock[best_day] += travel + dwell

    return [d for d in days if d]  # drop empty trailing days


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


def _check_schedule_fit(
    day_groups: list[list[dict]],
    route_durations: dict[tuple, int] | None,
) -> tuple[str | None, list[dict]]:
    """Detect overfull/underfull days.

    Returns (issue_type, days_summary) where issue_type is "overfull",
    "underfull", or None.  days_summary is always the full list so the
    caller can forward it to Gemini.
    """
    START_MIN = 540
    # 30-min grace period beyond the 17:00 hard cutoff in _distribute_days: flags only
    # genuinely over-packed days while letting schedules that slip slightly still pass.
    END_MIN_HARD = 1050  # 17:30

    days_summary = []
    has_overfull = False
    has_underfull = False

    for day_idx, places in enumerate(day_groups):
        clock = START_MIN
        total_occupied = 0
        for i, place in enumerate(places):
            dwell = place.get("dwell_minutes", 60)
            if i > 0 and route_durations:
                travel = route_durations.get((places[i - 1]["id"], place["id"]), 15)
                clock += travel
                total_occupied += travel
            clock += dwell
            total_occupied += dwell

        days_summary.append({"day": day_idx + 1, "occupied_minutes": total_occupied})
        if clock > END_MIN_HARD:
            has_overfull = True
        if total_occupied < 240 and len(places) > 0:
            has_underfull = True

    if has_overfull:
        return "overfull", days_summary
    if has_underfull:
        return "underfull", days_summary
    return None, days_summary


async def _get_route_with_fallback(from_p: dict, to_p: dict) -> dict:
    """Distance-based routing: < 1.5km → walk API; ≥ 1.5km → PT API.
    NoRouteError falls back to haversine walking estimate (is_estimated=True).
    Generic network exceptions re-raise as NoRouteError (not estimated).
    """
    dist_km = _haversine_km(from_p["lat"], from_p["lng"], to_p["lat"], to_p["lng"])
    mode = "walk" if dist_km < 1.5 else "pt"
    try:
        route = await onemap.get_route(
            from_p["lat"], from_p["lng"],
            to_p["lat"], to_p["lng"],
            mode=mode,
        )
        route["is_estimated"] = False
        return route
    except NoRouteError:
        pass  # fall through to haversine estimate
    except Exception as exc:
        raise NoRouteError(
            f"Transit routing unavailable from '{from_p['id']}' to '{to_p['id']}': {exc}"
        ) from exc

    # Haversine walking estimate — only reached when API returns no itinerary
    duration_min = max(1, round(dist_km / 5.0 * 60))
    return {
        "duration_minutes": duration_min,
        "fare_sgd": 0.0,
        "legs": [{"mode": "WALK", "duration_minutes": duration_min, "instruction": ""}],
        "geometry": None,
        "instructions": [],
        "distance_km": round(dist_km, 2),
        "is_estimated": True,
    }


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

    # [CODE] 2+4. Day-bucketed greedy with time-window constraints
    # Replaces _sort_places_greedy (step 2) and _distribute_days (step 4) on the optimize path.
    greedy_warnings: list[str] = []
    if optimize_order:
        classified     = {p["id"]: _classify_place(p) for p in places}
        day_overlap    = [p for p in places if classified[p["id"]] != "evening"]
        evening        = [p for p in places if classified[p["id"]] == "evening"]
        seed_groups    = [day_overlap[i::num_days] for i in range(num_days)]
        evening_by_day = _pre_assign_evening_places(evening, num_days, seed_groups)
        day_groups, greedy_warnings = _day_bucketed_greedy(day_overlap, evening_by_day, num_days)
    else:
        day_groups = _distribute_days(places, num_days)

    # [CODE] 3. Parallel OneMap fetch — all unique consecutive pairs across all days
    seen: set[tuple] = set()
    unique_pairs: list[tuple[dict, dict]] = []
    for day_places in day_groups:
        for i in range(len(day_places) - 1):
            key = (day_places[i]["id"], day_places[i + 1]["id"])
            if key not in seen:
                seen.add(key)
                unique_pairs.append((day_places[i], day_places[i + 1]))

    fetch_results = await asyncio.gather(
        *[_get_route_with_fallback(a, b) for a, b in unique_pairs],
        return_exceptions=True,
    )
    route_cache: dict[tuple, dict] = {}
    for (a, b), result in zip(unique_pairs, fetch_results):
        if not isinstance(result, Exception):
            route_cache[(a["id"], b["id"])] = result
    route_durations = {k: v["duration_minutes"] for k, v in route_cache.items()}

    # [LLM] 5. Check over/under-fill — call Gemini once if issue detected
    issue_type, days_summary = _check_schedule_fit(day_groups, route_durations)
    schedule_warning: str | None = None
    if issue_type:
        try:
            from app.services import gemini as _gemini
            schedule_warning = await _gemini.generate_schedule_warning(days_summary, issue_type)
        except Exception:
            pass  # never block planning on Gemini failure

    # [CODE] 6. Build legs from pre-fetched routes + track estimated timing + opening-hours warnings
    days: list[DayPlan] = []
    total_cost = 0.0
    warnings: list[str] = list(greedy_warnings)
    if schedule_warning:
        warnings.append(schedule_warning)

    place_timing: dict[str, dict] = {}   # place_id → {arrival, departure, day_index, name}
    gap_events: list[dict] = []

    for day_idx, day_places in enumerate(day_groups):
        legs: list[LegResponse] = []
        current_time = 540  # tour starts at 09:00 (minutes since midnight)

        for i, place in enumerate(day_places):
            arrival_time = current_time
            dwell = place.get("dwell_minutes", 60)

            place_timing[place["id"]] = {
                "arrival":   arrival_time,
                "departure": arrival_time + dwell,
                "day_index": day_idx,
                "name":      place["name"],
            }

            # Gap detection: transit time from previous place in the same day
            if i > 0:
                prev = day_places[i - 1]
                gap = arrival_time - place_timing[prev["id"]]["departure"]
                if gap >= 30:
                    gap_events.append({
                        "day_index":    day_idx,
                        "gap_start":    _fmt_hhmm(place_timing[prev["id"]]["departure"]),
                        "gap_end":      _fmt_hhmm(arrival_time),
                        "gap_minutes":  gap,
                        "place_before": prev["name"],
                        "place_after":  place["name"],
                    })

            # Check best_time for this place
            best_start = _parse_hhmm(place["best_time_start"])
            best_end = _parse_hhmm(place["best_time_end"])
            if not (best_start <= current_time <= best_end):
                warnings.append(
                    f"{place['name']}: best time {place['best_time_start']}–"
                    f"{place['best_time_end']}, you arrive at {_fmt_hhmm(current_time)}"
                )

            # Advance clock by dwell at this place
            current_time += dwell

            if i < len(day_places) - 1:
                from_p = place
                to_p = day_places[i + 1]
                route_key = (from_p["id"], to_p["id"])
                if route_key in route_cache:
                    route = route_cache[route_key]
                else:
                    route = await _get_route_with_fallback(from_p, to_p)
                    route_cache[route_key] = route

                transport_mode = _primary_mode(route.get("legs", []))
                duration = route["duration_minutes"]
                cost = route["fare_sgd"]
                geometry = route.get("geometry")
                instructions = route.get("instructions", [])
                distance_km = route.get("distance_km")
                is_estimated = route.get("is_estimated", False)
                # Apply user preferences (rule-based, no LLM)
                if prefs.get("prefer_mrt") is False and transport_mode == "MRT":
                    transport_mode = "BUS"
                if transport_mode == "WALK" and duration > prefs.get("max_walk_minutes", 20):
                    transport_mode = "BUS"

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
                    distance_km=distance_km,
                    sub_legs=route.get("sub_legs", []),
                ))

        days.append(DayPlan(day=day_idx + 1, legs=legs))

    # [CODE+LLM] 6b. Batch Gemini call for all gap notifications
    gap_notifications: list[GapNotification] = []
    if gap_events:
        try:
            from app.services import gemini as _gemini
            messages = await _gemini.generate_gap_notifications(gap_events)
        except Exception:
            messages = [
                f"You have {e['gap_minutes']} minutes free between {e['place_before']} and {e['place_after']}."
                for e in gap_events
            ]
        for e, msg in zip(gap_events, messages):
            gap_notifications.append(GapNotification(
                day_index=e["day_index"],
                gap_start=e["gap_start"],
                gap_end=e["gap_end"],
                gap_minutes=e["gap_minutes"],
                message=msg,
            ))

    # [CODE] 7. Budget check — warn instead of raising so planning still completes
    if total_cost > budget_sgd:
        warnings.append(
            f"Estimated transit cost S${total_cost:.2f} exceeds your budget of S${budget_sgd:.2f}. "
            "Consider fewer stops or choosing a different route."
        )

    # Inform caller when fewer days were needed than requested
    if len(days) < num_days:
        warnings.append(
            f"All {len(places)} places fit in {len(days)} day(s) — "
            f"add more places to fill {num_days} days."
        )

    # [LLM] 8. Gemini not called — preferences are structured (prefer_mrt, max_walk_minutes,
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
            image_url=p.get("image_url"),
            opening_hours=p.get("opening_hours"),
        )
        for p in places
    ]

    return TripPlan(
        id=trip_id,
        days=days,
        places=response_places,
        warnings=warnings,
        gap_notifications=gap_notifications,
    )
