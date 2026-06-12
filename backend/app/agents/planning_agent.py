"""
Planning Agent — 75% code, 25% LLM.
LLM (Gemini) is called ONLY for edge cases not covered by rule-based logic.
"""

import asyncio
import json
import logging
import math
import uuid
from datetime import date, timedelta
from pathlib import Path

log = logging.getLogger(__name__)

from app.services import onemap
from app.services.onemap import NoRouteError
from app.services.scoring import score_alternatives
from app.exceptions import PlaceDataMissingError
from app.models.trip import (
    TripPlan, DayPlan, LegResponse, GapNotification,
    AlternativeRoute, LegSwapResult, TransportMode,
)
from app.models.place import Place
from app.models.preferences import UserPreferenceProfile, ContextSnapshot

_PLACES_PATH = Path(__file__).parent.parent / "data" / "singapore_places.json"
_MAX_RECOMMENDED_CYCLE_MINUTES = 60


def _validate_time(t: str, place_id: str, field: str) -> None:
    """Raise ValueError at startup if a time string in the data file is malformed."""
    parts = t.split(":")
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        raise ValueError(f"singapore_places.json [{place_id}] invalid {field}: '{t}' — expected HH:MM")


def _normalise_place(p: dict) -> dict:
    """Map singapore_places.json schema → internal schema expected by all agents.
    Only transformation: suggested_duration_minutes → dwell_minutes.
    best_time_start / best_time_end are pre-enriched directly in the JSON.
    """
    return {
        **p,
        "dwell_minutes": p.get("suggested_duration_minutes", 60),
    }


# Load and validate once at import time — bad data surfaces at startup, not runtime.
with open(_PLACES_PATH, encoding="utf-8") as _f:
    _raw: list[dict] = json.load(_f)

_REQUIRED_KEYS = {
    "id", "name", "lat", "lng", "category", "is_outdoor",
    "suggested_duration_minutes", "opening_hours",
    "best_time_start", "best_time_end",
}
for _p in _raw:
    missing = _REQUIRED_KEYS - set(_p.keys())
    if missing:
        raise RuntimeError(f"singapore_places.json entry '{_p.get('id', '?')}' missing required keys: {missing}")
    _validate_time(_p["best_time_start"], _p["id"], "best_time_start")
    _validate_time(_p["best_time_end"], _p["id"], "best_time_end")

_PLACES: dict[str, dict] = {p["id"]: _normalise_place(p) for p in _raw}
del _raw


def get_curated_place(place_id: str) -> dict | None:
    """Public accessor for _PLACES — use this instead of importing _PLACES directly."""
    return _PLACES.get(place_id)


def get_all_places() -> dict:
    """Public accessor for the full _PLACES dict — use instead of importing _PLACES directly."""
    return _PLACES


# Re-exported so tests can patch at app.agents.planning_agent.suggest_places
from app.services.gemini import suggest_places  # noqa: E402

# Map OneMap transit modes to TransportMode labels
_MODE_MAP: dict[str, str] = {"SUBWAY": "METRO", "TRAM": "METRO", "BUS": "BUS", "WALK": "WALK"}


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


_TRAVEL_SPEED_KM_MIN = 0.25  # MRT-biased average for Singapore (2–8 km tourist routes); greedy only, never stored
_MIN_TRANSIT_MIN     = 10   # minimum transit time per leg (waiting + walking to stop)
_SG_CENTER = {"lat": 1.3521, "lng": 103.8198}
_AT_ORIGIN_THRESHOLD_KM = 0.2  # 200m — GPS ≤ 200m from from_place → "at origin" fast path


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


def _assign_evening_to_days(evening: list[dict], day_groups: list[list[dict]]) -> None:
    """Assign evening places to days after daytime distribution is known.

    Primary criterion : day with least accumulated dwell time (balances total day length).
    Tie-break          : geographic proximity to the last place of that day.
    Mutates day_groups in-place.
    """
    if not evening:
        return
    num_days = len(day_groups)
    for ep in evening:
        def score(i: int) -> tuple[float, float]:
            day_dwell = sum(p.get("dwell_minutes", 60) for p in day_groups[i])
            last = day_groups[i][-1] if day_groups[i] else _SG_CENTER
            dist = _haversine_km(ep["lat"], ep["lng"], last["lat"], last["lng"])
            return (day_dwell, dist)
        best = min(range(num_days), key=score)
        day_groups[best].append(ep)


# dev21 P2: a place whose opening window closes within this many minutes (relative to the
# current schedule clock) is treated as "urgent" and picked before a merely-nearer place.
_URGENCY_CLOSE_MIN = 90


def _weekdays_for_days(start_date: date | None, num_days: int) -> list[str] | None:
    """Map each day index 0..num_days-1 → weekday name (e.g. 'Monday', as date.strftime('%A')).

    Returns None when start_date is unknown → all close_days gating becomes a graceful no-op.
    """
    if start_date is None:
        return None
    return [(start_date + timedelta(days=i)).strftime("%A") for i in range(num_days)]


def _is_open_on_weekday(place: dict, weekday_name: str) -> bool:
    """False only if the place explicitly lists this weekday in its close_days."""
    return weekday_name not in (place.get("close_days") or [])


def _relocate_closed_day_places(
    day_groups: list[list[dict]],
    weekdays: list[str] | None,
    warnings_out: list[str],
) -> None:
    """[dev21 P1] Move any place scheduled on a day it is closed to the nearest open day.

    Mutates day_groups in place; appends a clear warning per relocation and a distinct one
    when a place is closed every day of the trip. No-op when weekdays is None (start_date
    unknown). Hotel / 24h / no-close_days places are never affected (empty close_days).
    """
    if not weekdays:
        return
    num_days = len(day_groups)
    for day_idx in range(min(num_days, len(weekdays))):
        for place in list(day_groups[day_idx]):
            if _is_open_on_weekday(place, weekdays[day_idx]):
                continue
            target = next(
                (alt for alt in range(num_days)
                 if alt != day_idx and alt < len(weekdays)
                 and _is_open_on_weekday(place, weekdays[alt])),
                None,
            )
            label = place.get("name") or place.get("id", "A place")
            if target is not None:
                day_groups[day_idx].remove(place)
                day_groups[target].append(place)
                warnings_out.append(
                    f"{label}: closed on {weekdays[day_idx]} — moved to day {target + 1}"
                )
            else:
                warnings_out.append(
                    f"{label}: closed every day of your trip — consider different dates"
                )


def _day_bucketed_greedy(
    day_overlap: list[dict],
    num_days: int,
    hotel: dict | None = None,
) -> tuple[list[list[dict]], list[str]]:
    """Assign and order daytime places across days using a time-budget greedy pass.

    Each non-last day stops accepting places once its accumulated dwell time
    reaches (total_daytime_dwell / num_days).  This prevents day 1 from being
    over-packed when haversine transit estimates are optimistic.

    Evening places are NOT handled here — call _assign_evening_to_days afterwards
    so they are balanced against the known daytime dwell of each day.
    """
    START_MIN = 540   # 09:00
    END_MIN   = 1020  # 17:00

    day_groups: list[list[dict]] = [[] for _ in range(num_days)]
    pool = list(day_overlap)
    extra_warnings: list[str] = []

    # Time-based budget: split total daytime dwell evenly across days.
    # Each non-last day stops when its accumulated dwell reaches this target,
    # leaving room for later days instead of packing everything into day 1.
    total_dwell = sum(p.get("dwell_minutes", 60) for p in day_overlap)
    dwell_budget = total_dwell / num_days if num_days > 1 else float("inf")

    # Hotel is the anchor: used as Day 1 start and as the overnight base for each day.
    anchor = hotel if hotel else (day_overlap[0] if day_overlap else _SG_CENTER)

    for day_idx in range(num_days):
        clock = START_MIN
        if day_idx > 0:
            # Tourists return to their hotel at night → hotel is daily start for Day 2+.
            last_pos = hotel if hotel else (day_groups[day_idx - 1][-1] if day_groups[day_idx - 1] else anchor)
        else:
            last_pos = anchor
        is_last_day = (day_idx == num_days - 1)
        day_dwell_used = 0.0

        while clock < END_MIN and pool:
            if not is_last_day and day_dwell_used >= dwell_budget:
                break

            candidates = []
            for p in pool:
                travel_est = max(_haversine_km(last_pos["lat"], last_pos["lng"], p["lat"], p["lng"]) / _TRAVEL_SPEED_KM_MIN, _MIN_TRANSIT_MIN)
                arrival    = clock + travel_est
                dwell      = p.get("dwell_minutes", 60)
                oh_open, oh_close = _parse_opening_hours(p.get("opening_hours", "24h"))
                if oh_open <= arrival and arrival + dwell <= min(oh_close, END_MIN):
                    candidates.append(p)

            if not candidates:
                # Relax opening_hours; still enforce day-end constraint
                for p in pool:
                    t_est = max(_haversine_km(last_pos["lat"], last_pos["lng"], p["lat"], p["lng"]) / _TRAVEL_SPEED_KM_MIN, _MIN_TRANSIT_MIN)
                    if clock + t_est + p.get("dwell_minutes", 60) <= END_MIN:
                        candidates.append(p)
                if not candidates:
                    break  # nothing fits today → remaining places flow to next day

            # dev21 P2: among feasible candidates, prefer one whose opening window is about to
            # close over a merely-nearer one — so a tight-window stop isn't deferred until it
            # becomes infeasible. When nothing is urgent (e.g. 24h places), nearest still wins.
            def _pick_key(p: dict) -> tuple:
                dist  = _haversine_km(last_pos["lat"], last_pos["lng"], p["lat"], p["lng"])
                t_est = max(dist / _TRAVEL_SPEED_KM_MIN, _MIN_TRANSIT_MIN)
                _, oh_close = _parse_opening_hours(p.get("opening_hours", "24h"))
                slack = oh_close - (clock + t_est + p.get("dwell_minutes", 60))
                return (0, slack) if slack < _URGENCY_CLOSE_MIN else (1, dist)

            pick = min(candidates, key=_pick_key)
            dwell = pick.get("dwell_minutes", 60)
            travel_est = max(_haversine_km(last_pos["lat"], last_pos["lng"], pick["lat"], pick["lng"]) / _TRAVEL_SPEED_KM_MIN, _MIN_TRANSIT_MIN)
            clock += travel_est + dwell
            day_dwell_used += dwell
            day_groups[day_idx].append(pick)
            pool.remove(pick)
            last_pos = pick

    # Overflow: places that exceeded all days' time windows
    for p in pool:
        lightest = min(range(num_days), key=lambda i: sum(q.get("dwell_minutes", 60) for q in day_groups[i]))
        day_groups[lightest].append(p)
        extra_warnings.append(
            f"{p['name']}: could not fit in scheduled time window, appended to day {lightest + 1}"
        )

    return [d for d in day_groups if d], extra_warnings


def _parse_single_slot(s: str) -> tuple[int, int]:
    """Parse a single 'HH:MM-HH:MM' or '24h' string → (open_min, close_min)."""
    if not s or s.strip().lower() == "24h":
        return 0, 1439
    parts = s.strip().split("-")
    if len(parts) != 2:
        return 0, 1439
    try:
        return _parse_hhmm(parts[0].strip()), _parse_hhmm(parts[1].strip())
    except (ValueError, IndexError):
        return 0, 1439


def _parse_opening_hours(s: str | list[str]) -> tuple[int, int]:
    """Parse "HH:MM-HH:MM", "24h", or list thereof → (open_min, close_min) since midnight.

    For a list of slots, returns (earliest open, latest close) across all slots —
    the widest reachable window. This prevents falsely excluding places with split
    hours (e.g. hawker centres closed for lunch, temples with two prayer windows).
    Scheduling during an inter-slot gap is possible but rare; _is_open_now() in
    the adaptation agent provides real-time accuracy during active trips.
    """
    if isinstance(s, list):
        if not s:
            return 0, 1439
        opens_closes = [_parse_single_slot(slot) for slot in s]
        return min(o for o, _ in opens_closes), max(c for _, c in opens_closes)
    return _parse_single_slot(s)


def _distribute_days(
    places: list[dict],
    num_days: int,
    route_durations: dict[tuple, int] | None = None,
    hotel: dict | None = None,
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
            # Travel time from last place in this day (or hotel if day is empty and hotel provided)
            if days[day_idx]:
                prev_id = days[day_idx][-1]["id"]
                travel  = route_durations.get((prev_id, place["id"]), 15)
            elif hotel:
                travel = route_durations.get(("hotel", place["id"]), 15)
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
    """Detect overfull or genuinely underfull days.

    overfull : any day's clock exceeds 17:30 (END_MIN_HARD=1050)
    underfull: any day has < 120 min total activity — meaning 0–1 short place,
               not a properly-distributed 2+ place day (which is typically ≥ 135 min)

    Returns (issue_type, days_summary) or (None, days_summary).
    """
    START_MIN = 540
    END_MIN_HARD = 1050  # 17:30 — 30-min grace beyond the 17:00 greedy cutoff
    UNDERFULL_MIN = 120  # < 2 hours → genuinely sparse, not just a light day

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
        if total_occupied < UNDERFULL_MIN and len(places) > 0:
            has_underfull = True

    if has_overfull:
        return "overfull", days_summary
    if has_underfull:
        return "underfull", days_summary
    return None, days_summary


def _normalize_instructions(raw: list) -> list[str]:
    """Flatten OneMap's list-of-list instructions into list[str].

    OneMap walking steps arrive as inner lists like:
      ["Right", "", 352, "...", "walking", "Turn right onto Orchard Rd"]
    The last string element is the human-readable instruction.
    Plain strings are passed through unchanged.
    """
    result = []
    for item in raw:
        if isinstance(item, list):
            text = next((str(x) for x in reversed(item) if isinstance(x, str) and x), None)
            if text:
                result.append(text)
        elif isinstance(item, str) and item:
            result.append(item)
    return result


def _to_alternative(route_dict: dict) -> AlternativeRoute:
    """Convert a raw OneMap route dict into an AlternativeRoute model."""
    return AlternativeRoute(
        duration_minutes=route_dict["duration_minutes"],
        cost_sgd=route_dict.get("fare_sgd", 0.0),
        is_estimated=route_dict.get("is_estimated", False),
        geometry=route_dict.get("geometry"),
        geometries=route_dict.get("geometries", []),
        instructions=_normalize_instructions(route_dict.get("instructions", [])),
        distance_km=route_dict.get("distance_km"),
        sub_legs=route_dict.get("sub_legs", []),
    )


_GRAB_LOCATION_SURCHARGES: dict[str, float] = {
    "changi":              6.00,
    "sentosa":             3.00,
    "gardens by the bay": 3.00,
    "marina bay cruise":  3.00,
}


def _estimate_grab(distance_km: float, from_place_name: str = "") -> dict:
    """Haversine-based GRAB fallback — used when OneMap drive mode is unavailable.

    Formula based on Singapore 2026 Grab pricing (JustGrab/GrabCar):
      road_km  = distance_km × 1.3  (road ≈ 1.3× straight-line)
      road_min = road_km / 30 × 60  (avg city speed 30 km/h)
      F_base   = 3.00 + road_km×0.70 + road_min×0.16
      F_trip   = max(5.80, F_base)   (minimum fare)
      S_fixed  = 1.70                (platform 1.20 + fuel 0.50)
      S_loc    = location surcharge from from_place_name
    M_surge and S_ERP are excluded (not modellable without realtime data).
    """
    road_km  = distance_km * 1.3
    road_min = (road_km / 30.0) * 60.0
    return _grab_fare(road_km, road_min, from_place_name, geometry=None, geometries=[])


def _grab_fare(
    road_km: float,
    road_min: float,
    from_place_name: str = "",
    geometry: str | None = None,
    geometries: list[str] | None = None,
) -> dict:
    """Build a GRAB route dict from computed road_km / road_min and optional drive geometry."""
    f_base = 3.00 + (road_km * 0.70) + (road_min * 0.16)
    f_trip = max(5.80, f_base)
    s_loc  = next(
        (v for k, v in _GRAB_LOCATION_SURCHARGES.items()
         if k in from_place_name.lower()),
        0.0,
    )
    fare = round(f_trip + 1.70 + s_loc, 2)
    return {
        "duration_minutes": max(1, round(road_min)),
        "fare_sgd":         fare,
        "is_estimated":     True,
        "geometry":         geometry,
        "geometries":       geometries or [],
        "instructions":     [],
        "distance_km":      round(road_km, 2),
        "sub_legs":         [],
        "legs":             [],
    }


# Walk/Cycle/Grab are point-to-point and always estimable → guaranteed switchable.
# Bus/Metro are NOT here: they require a real OneMap line (never fabricate transit).
_WALK_SPEED_KM_H  = 5.0
_CYCLE_SPEED_KM_H = 15.0


def _estimated_active_route(dist_km: float, mode: str) -> dict:
    """Haversine estimate for WALK or CYCLE as a raw route dict (is_estimated=True)."""
    speed = _WALK_SPEED_KM_H if mode == "WALK" else _CYCLE_SPEED_KM_H
    dur = max(1, round(dist_km / speed * 60))
    return {
        "duration_minutes": dur, "fare_sgd": 0.0, "is_estimated": True,
        "geometry": None, "geometries": [], "instructions": [],
        "legs": [{"mode": mode, "duration_minutes": dur}],
        "distance_km": round(dist_km, 2), "sub_legs": [],
    }


def _ensure_always_modes(alts: dict[str, dict], from_p: dict, to_p: dict, dist_km: float) -> dict[str, dict]:
    """Return a copy of `alts` with WALK, CYCLE, GRAB guaranteed present.

    Real OneMap routes already in `alts` are kept as-is; only missing modes are filled
    with haversine estimates. Bus/Metro are never added here (never fabricate transit).

    MENU enrichment only — produces a NEW dict and never mutates `alts`, so the raw dict
    that score_alternatives / route_cache read from is untouched (see dev22 Impact §A).
    """
    out = dict(alts)
    if "WALK" not in out:
        out["WALK"] = _estimated_active_route(dist_km, "WALK")
    if "CYCLE" not in out:
        out["CYCLE"] = _estimated_active_route(dist_km, "CYCLE")
    if "GRAB" not in out:
        out["GRAB"] = _estimate_grab(dist_km, from_place_name=from_p.get("name", ""))
    return out


def estimated_alternatives_models(
    from_lat: float, from_lng: float, to_lat: float, to_lng: float, from_name: str = "",
) -> dict[str, AlternativeRoute]:
    """WALK/CYCLE/GRAB estimates as AlternativeRoute models (for DB-reload fallback, Phase 2)."""
    dist_km = _haversine_km(from_lat, from_lng, to_lat, to_lng)
    raw = _ensure_always_modes({}, {"name": from_name}, {}, dist_km)
    return {m: _to_alternative(r) for m, r in raw.items()}


async def _fetch_all_alternatives(from_p: dict, to_p: dict) -> dict[str, dict]:
    """Fetch PT (mixed), PT bus-only, Walk, and Cycle routes in parallel.

    Returns dict[TransportMode, route_dict] — only populated for modes OneMap can route.
    PT routes where the itinerary is all-walk are excluded (WALK already covers those).
    Failures are logged at DEBUG and treated as unavailable.
    """
    async def _safe(mode: str, transit_modes: str | None = None) -> dict | None:
        try:
            r = await onemap.get_route(
                from_p["lat"], from_p["lng"],
                to_p["lat"], to_p["lng"],
                mode=mode,
                transit_modes=transit_modes,
            )
            r["is_estimated"] = False
            return r
        except Exception as exc:
            log.debug("OneMap %s route unavailable (%s→%s): %s",
                      mode, from_p.get("id"), to_p.get("id"), exc)
            return None

    pt_route, bus_route, walk_route, cycle_route, drive_route = await asyncio.gather(
        _safe("pt"),
        _safe("pt", transit_modes="BUS"),
        _safe("walk"),
        _safe("cycle"),
        _safe("drive"),
    )

    result: dict[str, dict] = {}

    # PT mixed → key = primary transit mode; skip if OneMap returned an all-walk itinerary
    if pt_route:
        primary = _primary_mode(pt_route.get("legs", []))
        if primary != "WALK":
            result[primary] = pt_route
        else:
            log.debug("PT route %s→%s is all-walk — no transit available for this pair",
                      from_p.get("id"), to_p.get("id"))

    # PT bus-only → add as "BUS" only when OneMap actually routes via bus
    if bus_route:
        bus_primary = _primary_mode(bus_route.get("legs", []))
        if bus_primary == "BUS":
            result["BUS"] = bus_route

    # Walk
    if walk_route:
        result["WALK"] = walk_route

    # Cycle — OneMap supports mode="cycle"; always fetch so Cycle is a real option
    if cycle_route:
        result["CYCLE"] = cycle_route

    # GRAB — use real drive polyline/distance/duration; fall back to haversine if drive fails
    if drive_route:
        result["GRAB"] = _grab_fare(
            road_km=drive_route["distance_km"],
            road_min=float(drive_route["duration_minutes"]),
            from_place_name=from_p.get("name", ""),
            geometry=drive_route.get("geometry"),
            geometries=drive_route.get("geometries", []),
        )
    else:
        dist_km = _haversine_km(from_p["lat"], from_p["lng"], to_p["lat"], to_p["lng"])
        result["GRAB"] = _estimate_grab(dist_km, from_place_name=from_p.get("name", ""))

    return result


def _apply_mode_safety_guard(best_key: str, alternatives: dict[str, dict], dist_km: float) -> str:
    """Single source of truth for downgrading impractical active-travel recommendations.

    Keeps CYCLE/WALK available in `alternatives` (so the UI can still show them) but
    avoids recommending them by default when they are impractical:
      - CYCLE recommended for > _MAX_RECOMMENDED_CYCLE_MINUTES → switch away
      - WALK recommended for a leg >= 1.5 km                   → switch away
    Replacement = fastest available transit (METRO/BUS by duration); else Grab when
    dist_km >= 2.0. Returns best_key unchanged when no safer practical mode exists.
    """
    def _fastest_practical() -> str | None:
        transit = [m for m in ("METRO", "BUS") if m in alternatives]
        if transit:
            return min(transit, key=lambda m: alternatives[m].get("duration_minutes", float("inf")))
        if dist_km >= 2.0 and "GRAB" in alternatives:
            return "GRAB"
        return None

    impractical = (
        (best_key == "CYCLE"
         and alternatives["CYCLE"].get("duration_minutes", 0) > _MAX_RECOMMENDED_CYCLE_MINUTES)
        or (best_key == "WALK" and dist_km >= 1.5)
    )
    if impractical:
        return _fastest_practical() or best_key
    return best_key


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
    profile: UserPreferenceProfile | None = None,
    context: ContextSnapshot | None = None,
    start_date: date | None = None,
    hotel_name: str | None = None,
    hotel_lat: float | None = None,
    hotel_lng: float | None = None,
    force_real_routes: bool = False,
    existing_real_legs: list[dict] | None = None,
) -> TripPlan:
    prefs = preferences or {}
    effective_profile = profile or UserPreferenceProfile()
    effective_ctx     = context or ContextSnapshot.now()

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

    # Build hotel_place dict if coordinates are provided
    hotel_place: dict | None = None
    if hotel_lat is not None and hotel_lng is not None:
        hotel_place = {
            "id": "hotel",
            "name": hotel_name or "Hotel",
            "lat": hotel_lat,
            "lng": hotel_lng,
            "dwell_minutes": 0,
            "category": "Hotel",
            "is_outdoor": False,
            "opening_hours": "24h",
            "best_time_start": "09:00",
            "best_time_end": "23:59",
        }

    # [CODE] 2+4. Day-bucketed greedy with time-window constraints
    # Replaces _sort_places_greedy (step 2) and _distribute_days (step 4) on the optimize path.
    greedy_warnings: list[str] = []
    # Pre-initialise caches so non-optimize pre-fetch can populate them before Step 3.
    route_cache:    dict[tuple, dict] = {}
    alt_cache:      dict[tuple, dict] = {}
    best_key_cache: dict[tuple, str]  = {}

    # Phương án A: pre-populate caches from caller-supplied real legs so OneMap is not
    # re-called for pairs whose routes are already known.  Pairs present in alt_cache are
    # automatically skipped in the all_pairs build below (key not in alt_cache guard).
    _place_by_id = {p["id"]: p for p in places}
    if hotel_place:
        _place_by_id["hotel"] = hotel_place
    for leg in (existing_real_legs or []):
        from_id = leg.get("from_place_id")
        to_id   = leg.get("to_place_id")
        if not from_id or not to_id:
            continue
        mode = leg.get("transport_mode", "WALK")
        dur  = int(leg.get("duration_minutes") or 0)
        route = {
            "duration_minutes": dur,
            "fare_sgd":         float(leg.get("cost_sgd") or 0.0),
            "is_estimated":     False,
            "geometry":         leg.get("geometry"),
            "geometries":       leg.get("geometries") or [],
            "instructions":     leg.get("instructions") or [],
            "legs":             [{"mode": mode, "duration_minutes": dur}],
            "distance_km":      leg.get("distance_km"),
            "sub_legs":         leg.get("sub_legs") or [],
        }
        # Menu enrichment: keep WALK/CYCLE/GRAB switchable on caller-supplied real legs too
        # (recommendation = the supplied mode; route_cache/best_key unchanged). Only possible
        # when both endpoints resolve to coordinates for the haversine estimate.
        _fp = _place_by_id.get(from_id)
        _tp = _place_by_id.get(to_id)
        _e_dist = leg.get("distance_km")
        if _fp and _tp and (_e_dist is None or _e_dist <= 0):
            _e_dist = _haversine_km(_fp["lat"], _fp["lng"], _tp["lat"], _tp["lng"])
        if _fp and _e_dist:
            alt_cache[(from_id, to_id)] = _ensure_always_modes({mode: route}, _fp, _tp or {}, _e_dist)
        else:
            alt_cache[(from_id, to_id)] = {mode: route}
        route_cache[(from_id, to_id)]    = route
        best_key_cache[(from_id, to_id)] = mode

    if optimize_order:
        classified  = {p["id"]: _classify_place(p) for p in places}
        day_overlap = [p for p in places if classified[p["id"]] != "evening"]
        evening     = [p for p in places if classified[p["id"]] == "evening"]
        day_groups, greedy_warnings = _day_bucketed_greedy(day_overlap, num_days, hotel=hotel_place)
        # Assign evening places after daytime so they balance against known per-day dwell
        _assign_evening_to_days(evening, day_groups)
    else:
        # Non-optimize: haversine-only distribution — no OneMap calls here.
        # User can freely add/remove places without waiting for API round-trips.
        # Real routes are fetched only when the user explicitly clicks Optimize Route.
        day_groups = _distribute_days(places, num_days, hotel=hotel_place)

    # [CODE] dev21 P1: relocate any place that landed on a day it is closed (close_days) to an
    # open day — applies to both paths, before routes are built. No-op when start_date unknown.
    closeday_warnings: list[str] = []
    _relocate_closed_day_places(day_groups, _weekdays_for_days(start_date, len(day_groups)), closeday_warnings)

    # [CODE] 3. Build route data for all unique consecutive pairs + hotel→first pairs.
    # optimize_order=True  → parallel OneMap fetch (real transit routes).
    # optimize_order=False → instant haversine estimates, all marked is_estimated=True.
    seen: set[tuple] = set()
    all_pairs: list[tuple[dict, dict]] = []
    for day_places in day_groups:
        if hotel_place and day_places:
            key = ("hotel", day_places[0]["id"])
            if key not in seen and key not in alt_cache:
                seen.add(key)
                all_pairs.append((hotel_place, day_places[0]))
            ret_key = (day_places[-1]["id"], "hotel")
            if ret_key not in seen and ret_key not in alt_cache:
                seen.add(ret_key)
                all_pairs.append((day_places[-1], hotel_place))
        for i in range(len(day_places) - 1):
            key = (day_places[i]["id"], day_places[i + 1]["id"])
            if key not in seen and key not in alt_cache:
                seen.add(key)
                all_pairs.append((day_places[i], day_places[i + 1]))

    if optimize_order or force_real_routes:
        alt_results = await asyncio.gather(
            *[_fetch_all_alternatives(a, b) for a, b in all_pairs],
            return_exceptions=True,
        )
        for (a, b), alts in zip(all_pairs, alt_results):
            if isinstance(alts, Exception):
                alts = {}
            dist_km = _haversine_km(a["lat"], a["lng"], b["lat"], b["lng"])
            transit_only = {m: r for m, r in alts.items() if m != "GRAB"}
            if not transit_only:
                if dist_km < 2.0:
                    # < 2km without any API route: haversine walk is always feasible
                    dur = max(1, round(dist_km / 5.0 * 60))
                    alts["WALK"] = {
                        "duration_minutes": dur,
                        "fare_sgd": 0.0,
                        "is_estimated": True,
                        "geometry": None,
                        "geometries": [],
                        "instructions": [],
                        "legs": [{"mode": "WALK", "duration_minutes": dur}],
                        "distance_km": round(dist_km, 2),
                        "sub_legs": [],
                    }
                    transit_only = {m: r for m, r in alts.items() if m != "GRAB"}
                elif "GRAB" in alts:
                    # ≥ 2km no transit → GRAB is the recommended option, but WALK/CYCLE stay
                    # switchable in the menu (estimated; recommendation/route_cache unchanged).
                    alt_cache[(a["id"], b["id"])]    = _ensure_always_modes(alts, a, b, dist_km)
                    route_cache[(a["id"], b["id"])]  = alts["GRAB"]
                    best_key_cache[(a["id"], b["id"])] = "GRAB"
                    continue
                else:
                    raise NoRouteError(
                        f"No route available from '{a['id']}' to '{b['id']}' — "
                        "all routing modes unavailable"
                    )
            # Menu enrichment: cache always-switchable WALK/CYCLE/GRAB (new dict; never the
            # `alts`/`transit_only` that scoring reads from — see dev22 Impact §A).
            alt_cache[(a["id"], b["id"])] = _ensure_always_modes(alts, a, b, dist_km)
            # GRAB excluded from scoring — it is only selected via the 2km guard below
            alt_models = {m: _to_alternative(r) for m, r in transit_only.items()}
            scoring    = score_alternatives(alt_models, profile=effective_profile, context=effective_ctx, dist_km=dist_km)
            best_key   = scoring.recommended_mode
            # Safety guard: downgrade impractical WALK/CYCLE → fastest transit (else Grab ≥ 2km)
            best_key   = _apply_mode_safety_guard(best_key, alts, dist_km)
            route_cache[(a["id"], b["id"])]    = alts[best_key]
            best_key_cache[(a["id"], b["id"])] = best_key
    else:
        # Haversine estimates — no OneMap calls, instant response
        for a, b in all_pairs:
            dist_km = _haversine_km(a["lat"], a["lng"], b["lat"], b["lng"])
            if dist_km < 1.5:
                dur      = max(1, round(dist_km / 5.0 * 60))
                mode_key = "WALK"
            else:
                dur      = max(_MIN_TRANSIT_MIN, round(dist_km / _TRAVEL_SPEED_KM_MIN))
                mode_key = "METRO"
            est_route = {
                "duration_minutes": dur,
                "fare_sgd": 0.0,
                "is_estimated": True,
                "geometry": None,
                "geometries": [],
                "instructions": [],
                "legs": [{"mode": mode_key, "duration_minutes": dur}],
                "distance_km": round(dist_km, 2),
                "sub_legs": [],
            }
            route_cache[(a["id"], b["id"])]    = est_route
            # Estimate path stores a single synthetic mode; enrich the menu so WALK/CYCLE/GRAB
            # are always switchable after non-optimize plans/edits (route_cache default unchanged).
            alt_cache[(a["id"], b["id"])]      = _ensure_always_modes({mode_key: est_route}, a, b, dist_km)
            best_key_cache[(a["id"], b["id"])] = mode_key

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
    warnings: list[str] = list(greedy_warnings) + closeday_warnings
    if schedule_warning:
        warnings.append(schedule_warning)

    place_timing: dict[str, dict] = {}   # place_id → {arrival, departure, day_index, name}
    gap_events: list[dict] = []

    for day_idx, day_places in enumerate(day_groups):
        legs: list[LegResponse] = []
        current_time = 540  # tour starts at 09:00 (minutes since midnight)

        # Hotel → first place leg (departs at 09:00, arrives at 09:00 + travel_time)
        if hotel_place and day_places:
            h_route_key = ("hotel", day_places[0]["id"])
            if h_route_key in route_cache:
                h_route        = route_cache[h_route_key]
                h_alts         = alt_cache.get(h_route_key, {})
                h_best_key     = best_key_cache.get(h_route_key, "WALK")
            else:
                h_fresh = await _fetch_all_alternatives(hotel_place, day_places[0])
                h_dist  = _haversine_km(hotel_place["lat"], hotel_place["lng"], day_places[0]["lat"], day_places[0]["lng"])
                h_transit = {m: r for m, r in h_fresh.items() if m != "GRAB"}
                if not h_transit:
                    dur = max(1, round(h_dist / 5.0 * 60))
                    h_fresh["WALK"] = {"duration_minutes": dur, "fare_sgd": 0.0, "is_estimated": True,
                                       "geometry": None, "geometries": [], "instructions": [],
                                       "legs": [{"mode": "WALK"}], "distance_km": round(h_dist, 2), "sub_legs": []}
                    h_transit = {m: r for m, r in h_fresh.items() if m != "GRAB"}
                h_models   = {m: _to_alternative(r) for m, r in h_transit.items()}
                h_scoring  = score_alternatives(h_models, profile=effective_profile, context=effective_ctx, dist_km=h_dist)
                h_best_key = h_scoring.recommended_mode
                h_best_key = _apply_mode_safety_guard(h_best_key, h_fresh, h_dist)
                h_route = h_fresh[h_best_key]
                h_fresh = _ensure_always_modes(h_fresh, hotel_place, day_places[0], h_dist)
                h_alts  = h_fresh
                alt_cache[h_route_key]      = h_fresh
                route_cache[h_route_key]    = h_route
                best_key_cache[h_route_key] = h_best_key

            if h_best_key == "WALK":
                h_transport = "WALK"
            elif h_best_key == "GRAB":
                h_transport = "GRAB"
            else:
                h_transport = _primary_mode(h_route.get("legs", []))
            legs.append(LegResponse(
                id=str(uuid.uuid4()),
                from_place_id="hotel",
                to_place_id=day_places[0]["id"],
                transport_mode=h_transport,
                duration_minutes=h_route["duration_minutes"],
                cost_sgd=h_route.get("fare_sgd", 0.0),
                is_estimated=h_route.get("is_estimated", False),
                instructions=_normalize_instructions(h_route.get("instructions", [])),
                geometry=h_route.get("geometry"),
                geometries=h_route.get("geometries", []),
                distance_km=h_route.get("distance_km"),
                sub_legs=h_route.get("sub_legs", []),
                alternatives={m: _to_alternative(r) for m, r in h_alts.items()},
            ))
            current_time += h_route["duration_minutes"]

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
                    transit_mode = best_key_cache.get((prev["id"], place["id"]), "METRO")
                    gap_events.append({
                        "day_index":      day_idx,
                        "gap_start":      _fmt_hhmm(place_timing[prev["id"]]["departure"]),
                        "gap_end":        _fmt_hhmm(arrival_time),
                        "gap_minutes":    gap,
                        "place_before":   prev["name"],
                        "place_after":    place["name"],
                        "transport_mode": transit_mode,
                    })

            # Advance clock by dwell at this place
            current_time += dwell

            if i < len(day_places) - 1:
                from_p = place
                to_p = day_places[i + 1]
                route_key = (from_p["id"], to_p["id"])
                if route_key in route_cache:
                    route         = route_cache[route_key]
                    alts_for_leg  = alt_cache.get(route_key, {})
                    best_key_used = best_key_cache.get(route_key, "WALK")
                else:
                    # Cache miss — fetch fresh alternatives on-the-fly
                    fresh_alts = await _fetch_all_alternatives(from_p, to_p)
                    dist_km = _haversine_km(from_p["lat"], from_p["lng"], to_p["lat"], to_p["lng"])
                    # Separate OneMap-sourced routes from the synthetic GRAB estimate.
                    # GRAB is excluded from scoring — it is only selected via the 2km guard.
                    fresh_transit = {m: r for m, r in fresh_alts.items() if m != "GRAB"}
                    best_key_used = None
                    if not fresh_transit:
                        if dist_km < 2.0:
                            # < 2km without any API route: haversine walk is always feasible
                            dur = max(1, round(dist_km / 5.0 * 60))
                            fresh_alts["WALK"] = {
                                "duration_minutes": dur, "fare_sgd": 0.0,
                                "is_estimated": True, "geometry": None, "geometries": [],
                                "instructions": [], "legs": [{"mode": "WALK"}],
                                "distance_km": round(dist_km, 2), "sub_legs": [],
                            }
                            fresh_transit = {m: r for m, r in fresh_alts.items() if m != "GRAB"}
                        elif "GRAB" in fresh_alts:
                            best_key_used = "GRAB"  # ≥ 2km no transit → Grab only viable option
                        else:
                            raise NoRouteError(
                                f"No route from '{from_p['id']}' to '{to_p['id']}' — "
                                "all routing modes unavailable"
                            )
                    if best_key_used is None:
                        fresh_models  = {m: _to_alternative(r) for m, r in fresh_transit.items()}
                        fresh_scoring = score_alternatives(fresh_models, profile=effective_profile, context=effective_ctx, dist_km=dist_km)
                        best_key_used = fresh_scoring.recommended_mode
                    best_key_used = _apply_mode_safety_guard(best_key_used, fresh_alts, dist_km)
                    route = fresh_alts[best_key_used]
                    fresh_alts = _ensure_always_modes(fresh_alts, from_p, to_p, dist_km)
                    alt_cache[route_key]      = fresh_alts
                    route_cache[route_key]    = route
                    best_key_cache[route_key] = best_key_used
                    alts_for_leg = fresh_alts

                # Transport mode: WALK/GRAB keys are literals; PT keys derive from legs
                if best_key_used == "WALK":
                    transport_mode = "WALK"
                elif best_key_used == "GRAB":
                    transport_mode = "GRAB"
                else:
                    transport_mode = _primary_mode(route.get("legs", []))

                alternatives  = {m: _to_alternative(r) for m, r in alts_for_leg.items()}
                duration      = route["duration_minutes"]
                cost          = route.get("fare_sgd", 0.0)
                geometry      = route.get("geometry")
                geometries    = route.get("geometries", [])
                instructions  = _normalize_instructions(route.get("instructions", []))
                distance_km   = route.get("distance_km")
                is_estimated  = route.get("is_estimated", False)
                sub_legs_data = route.get("sub_legs", [])

                # Expose first LTA bus stop code so frontend can call
                # GET /transit/bus-arrivals/{code} for real-time countdown.
                bus_stop_code: str | None = None
                if transport_mode == "BUS":
                    bus_sub = next(
                        (sl for sl in sub_legs_data if sl.get("mode") == "BUS"), None
                    )
                    if bus_sub:
                        bus_stop_code = bus_sub.get("from_stop_code") or None

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
                    geometries=geometries,
                    distance_km=distance_km,
                    sub_legs=sub_legs_data,
                    alternatives=alternatives,
                    first_bus_stop_code=bus_stop_code,
                ))

        # Return leg: last place → hotel (tourists return to hotel each evening)
        if hotel_place and day_places:
            last_p   = day_places[-1]
            ret_key  = (last_p["id"], "hotel")
            if ret_key in route_cache:
                ret_route = route_cache[ret_key]
                ret_alts  = alt_cache.get(ret_key, {})
                ret_best  = best_key_cache.get(ret_key, "WALK")
            else:
                # Fallback haversine (symmetric to outbound estimate)
                dist_km  = _haversine_km(last_p["lat"], last_p["lng"], hotel_place["lat"], hotel_place["lng"])
                if dist_km < 1.5:
                    dur      = max(1, round(dist_km / 5.0 * 60))
                    ret_best = "WALK"
                else:
                    dur      = max(_MIN_TRANSIT_MIN, round(dist_km / _TRAVEL_SPEED_KM_MIN))
                    ret_best = "METRO"
                ret_route = {
                    "duration_minutes": dur, "fare_sgd": 0.0, "is_estimated": True,
                    "geometry": None, "geometries": [], "instructions": [],
                    "legs": [{"mode": ret_best, "duration_minutes": dur}],
                    "distance_km": round(dist_km, 2), "sub_legs": [],
                }
                ret_alts = _ensure_always_modes({ret_best: ret_route}, last_p, hotel_place, dist_km)
            if ret_best == "WALK":
                ret_transport = "WALK"
            elif ret_best == "GRAB":
                ret_transport = "GRAB"
            else:
                ret_transport = _primary_mode(ret_route.get("legs", []))
            legs.append(LegResponse(
                id=str(uuid.uuid4()),
                from_place_id=last_p["id"],
                to_place_id="hotel",
                transport_mode=ret_transport,
                duration_minutes=ret_route["duration_minutes"],
                cost_sgd=ret_route.get("fare_sgd", 0.0),
                is_estimated=ret_route.get("is_estimated", False),
                instructions=_normalize_instructions(ret_route.get("instructions", [])),
                geometry=ret_route.get("geometry"),
                geometries=ret_route.get("geometries", []),
                distance_km=ret_route.get("distance_km"),
                sub_legs=ret_route.get("sub_legs", []),
                alternatives={m: _to_alternative(r) for m, r in ret_alts.items()},
            ))

        # place_ids: hotel first (if present), then sightseeing places in visit order
        day_place_ids = (["hotel"] if hotel_place and day_places else []) + [p["id"] for p in day_places]
        days.append(DayPlan(day=day_idx + 1, legs=legs, place_ids=day_place_ids))

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

    response_places = []
    if hotel_place:
        response_places.append(Place(
            id="hotel",
            name=hotel_place["name"],
            lat=hotel_place["lat"],
            lng=hotel_place["lng"],
            dwell_minutes=0,
            best_time_start="09:00",
            best_time_end="23:59",
            category="Hotel",
            is_outdoor=False,
            in_curated_dataset=False,
        ))
    response_places += [
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


async def switch_leg_mode(
    new_mode: TransportMode,
    target_leg: LegResponse,
    plan: TripPlan,
) -> LegSwapResult:
    """Switch transport mode for a leg using pre-fetched alternatives.

    Fast path : alternative found in target_leg.alternatives → instant, no API call.
    Cache miss : alternative not cached (e.g. trip loaded from DB after restart)
                 → fetch on-demand via _fetch_all_alternatives, then switch.

    Raises NoRouteError when the requested mode has no available route.
    """
    place_map = {p.id: p for p in plan.places}
    from_place = place_map.get(target_leg.from_place_id)
    to_place   = place_map.get(target_leg.to_place_id)

    if not from_place or not to_place:
        raise NoRouteError(f"Place data missing for leg '{target_leg.id}'")

    # ── 1. Lookup alternative ─────────────────────────────────────────────────
    alt = target_leg.alternatives.get(new_mode)

    if alt is None:
        # Cache miss: fetch fresh alternatives from OneMap and merge into leg
        from_p = {"id": from_place.id, "lat": from_place.lat, "lng": from_place.lng}
        to_p   = {"id": to_place.id,   "lat": to_place.lat,   "lng": to_place.lng}
        fresh_alts = await _fetch_all_alternatives(from_p, to_p)

        new_alternatives = {
            **target_leg.alternatives,
            **{m: _to_alternative(r) for m, r in fresh_alts.items()},
        }
        target_leg = target_leg.model_copy(update={"alternatives": new_alternatives})
        alt = target_leg.alternatives.get(new_mode)

    if alt is None:
        raise NoRouteError(
            f"No {new_mode} route available between "
            f"'{target_leg.from_place_id}' and '{target_leg.to_place_id}'. "
            "Try a different transport mode."
        )

    # ── 1b. Lazy real geometry (dev22 §F) ────────────────────────────────────
    # Persisted alternatives carry no polyline (the compact DB summary drops geometry),
    # and the estimate path stores transit placeholders with geometry=None. For a
    # transit/Grab mode with no polyline, re-fetch the real route so the map can draw a
    # line. WALK/CYCLE are point-to-point estimates → no polyline needed. Best-effort:
    # never raise → never turn a switch into a click-then-fail.
    if new_mode not in ("WALK", "CYCLE") and alt.geometry is None:
        try:
            from_p = {"id": from_place.id, "lat": from_place.lat,
                      "lng": from_place.lng, "name": from_place.name}
            to_p   = {"id": to_place.id, "lat": to_place.lat, "lng": to_place.lng}
            fresh_alts = await _fetch_all_alternatives(from_p, to_p)
            real = fresh_alts.get(new_mode)
            if real and real.get("geometry"):
                real_alt = _to_alternative(real)
                target_leg = target_leg.model_copy(update={
                    "alternatives": {**target_leg.alternatives, new_mode: real_alt},
                })
                alt = real_alt
        except Exception as exc:
            log.debug("lazy geometry re-fetch failed for %s (%s→%s): %s",
                      new_mode, target_leg.from_place_id, target_leg.to_place_id, exc)

    # ── 2. Build updated leg (alternatives preserved for future switches) ─────
    updated_leg = target_leg.model_copy(update={
        "transport_mode":   new_mode,
        "duration_minutes": alt.duration_minutes,
        "cost_sgd":         alt.cost_sgd,
        "is_estimated":     alt.is_estimated,
        "geometry":         alt.geometry,
        "geometries":       alt.geometries,
        "instructions":     alt.instructions,
        "distance_km":      alt.distance_km,
        "sub_legs":         alt.sub_legs,
    })

    # ── 3. Schedule check: does the new duration push day_end past 17:30? ─────
    warnings: list[str] = []
    duration_delta = alt.duration_minutes - target_leg.duration_minutes

    if duration_delta != 0:
        for day in plan.days:
            if not any(leg.id == target_leg.id for leg in day.legs):
                continue

            # Count each place's dwell time exactly once
            seen: set[str] = set()
            total_dwell = 0
            for leg in day.legs:
                if leg.from_place_id not in seen:
                    total_dwell += place_map[leg.from_place_id].dwell_minutes
                    seen.add(leg.from_place_id)
            if day.legs and day.legs[-1].to_place_id not in seen:
                total_dwell += place_map[day.legs[-1].to_place_id].dwell_minutes

            total_transit = sum(
                (updated_leg.duration_minutes if leg.id == target_leg.id else leg.duration_minutes)
                for leg in day.legs
            )
            day_end = 540 + total_dwell + total_transit   # 09:00 + all activity
            if day_end > 1050:   # 17:30
                warnings.append(
                    f"Switching to {new_mode} adds {duration_delta:+d} min — "
                    f"Day {day.day} will end around {_fmt_hhmm(day_end)}."
                )
            break

    # ── 4. Recalculate total trip cost ────────────────────────────────────────
    trip_cost = sum(
        (updated_leg.cost_sgd if leg.id == target_leg.id else leg.cost_sgd)
        for day in plan.days
        for leg in day.legs
    )

    return LegSwapResult(
        updated_leg=updated_leg,
        trip_cost_sgd=round(trip_cost, 2),
        warnings=warnings,
    )


async def switch_leg_mode_live(
    new_mode: TransportMode,
    target_leg: LegResponse,
    plan: TripPlan,
    current_lat: float,
    current_lng: float,
) -> LegSwapResult:
    """Live mode-switch using current GPS position as routing origin.

    Fast path  : GPS ≤ 200m from from_place → delegates to switch_leg_mode()
                 (uses pre-fetched cache or on-demand fetch from A).
                 Returns routed_from_current_position=False.

    Realtime   : GPS > 200m from from_place → calls OneMap from GPS to to_place.
                 Existing alternatives (A-based) are preserved for planning view.
                 Returns routed_from_current_position=True.

    Raises NoRouteError when the requested mode has no available route.
    """
    place_map = {p.id: p for p in plan.places}
    from_place = place_map.get(target_leg.from_place_id)
    to_place   = place_map.get(target_leg.to_place_id)

    if not from_place or not to_place:
        raise NoRouteError(f"Place data missing for leg '{target_leg.id}'")

    dist_to_origin = _haversine_km(current_lat, current_lng, from_place.lat, from_place.lng)

    # ── Fast path: user still at the departure point ──────────────────────────
    if dist_to_origin <= _AT_ORIGIN_THRESHOLD_KM:
        result = await switch_leg_mode(new_mode, target_leg, plan)
        # routed_from_current_position stays False (default)
        return result

    # ── Realtime path: user has left the departure point ─────────────────────
    if new_mode == "GRAB":
        # Use drive route from GPS for realistic polyline/distance; fall back to haversine
        try:
            drive = await onemap.get_route(
                current_lat, current_lng, to_place.lat, to_place.lng, mode="drive"
            )
            route = _grab_fare(
                road_km=drive["distance_km"],
                road_min=float(drive["duration_minutes"]),
                geometry=drive.get("geometry"),
                geometries=drive.get("geometries", []),
            )
        except Exception:
            dist_km = _haversine_km(current_lat, current_lng, to_place.lat, to_place.lng)
            route = _estimate_grab(dist_km, from_place_name="")
    else:
        if new_mode == "WALK":
            onemap_mode   = "walk"
            transit_modes = None
        elif new_mode == "BUS":
            onemap_mode   = "pt"
            transit_modes = "BUS"
        else:  # METRO (or CYCLE)
            onemap_mode   = "pt"
            transit_modes = None

        try:
            route = await onemap.get_route(
                current_lat, current_lng,
                to_place.lat, to_place.lng,
                mode=onemap_mode,
                transit_modes=transit_modes,
            )
            route["is_estimated"] = False
        except NoRouteError:
            raise NoRouteError(
                f"No {new_mode} route from your current position to '{target_leg.to_place_id}'. "
                "Try a different transport mode."
            )
        except Exception as exc:
            raise NoRouteError(
                f"Routing unavailable from current position to '{target_leg.to_place_id}': {exc}"
            ) from exc

        # Sanity check: BUS-only request but OneMap returned a METRO-primary route
        if new_mode == "BUS":
            actual_primary = _primary_mode(route.get("legs", []))
            if actual_primary != "BUS":
                raise NoRouteError(
                    f"No BUS-only route available from your current position "
                    f"to '{target_leg.to_place_id}'."
                )

    # Build updated leg — preserve existing alternatives (A-based, still valid for planning view)
    updated_leg = target_leg.model_copy(update={
        "transport_mode":   new_mode,
        "duration_minutes": route["duration_minutes"],
        "cost_sgd":         route.get("fare_sgd", 0.0),
        "is_estimated":     route.get("is_estimated", False),
        "geometry":         route.get("geometry"),
        "geometries":       route.get("geometries", []),
        "instructions":     _normalize_instructions(route.get("instructions", [])),
        "distance_km":      route.get("distance_km"),
        "sub_legs":         route.get("sub_legs", []),
        # alternatives: not overwritten — A-based cache remains for PATCH /legs switching
    })

    # ── Schedule check (same logic as switch_leg_mode) ────────────────────────
    warnings: list[str] = []
    duration_delta = route["duration_minutes"] - target_leg.duration_minutes

    if duration_delta != 0:
        for day in plan.days:
            if not any(leg.id == target_leg.id for leg in day.legs):
                continue

            seen: set[str] = set()
            total_dwell = 0
            for leg in day.legs:
                if leg.from_place_id not in seen:
                    total_dwell += place_map[leg.from_place_id].dwell_minutes
                    seen.add(leg.from_place_id)
            if day.legs and day.legs[-1].to_place_id not in seen:
                total_dwell += place_map[day.legs[-1].to_place_id].dwell_minutes

            total_transit = sum(
                (updated_leg.duration_minutes if leg.id == target_leg.id else leg.duration_minutes)
                for leg in day.legs
            )
            day_end = 540 + total_dwell + total_transit   # 09:00 + all activity
            if day_end > 1050:   # 17:30
                warnings.append(
                    f"Switching to {new_mode} adds {duration_delta:+d} min — "
                    f"Day {day.day} will end around {_fmt_hhmm(day_end)}."
                )
            break

    # ── Recalculate total trip cost ────────────────────────────────────────────
    trip_cost = sum(
        (updated_leg.cost_sgd if leg.id == target_leg.id else leg.cost_sgd)
        for day in plan.days
        for leg in day.legs
    )

    return LegSwapResult(
        updated_leg=updated_leg,
        trip_cost_sgd=round(trip_cost, 2),
        warnings=warnings,
        routed_from_current_position=True,
    )
