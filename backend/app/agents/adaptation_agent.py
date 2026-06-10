"""
Adaptation Agent — 100% rule-based code, no LLM.
- Automatic: poll_lta_alerts() every 2 min, poll_weather_alerts() every 30 min (APScheduler).
- Manual:    adapt_trip() called by POST /trips/{id}/adapt router.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.services import lta, openweather, onemap
from app.services.openweather import SINGAPORE_LAT, SINGAPORE_LNG
from app.services.lta import LTAUnavailableError
from app.services.openweather import WeatherUnavailableError
from app.services.onemap import NoRouteError
from app.agents.planning_agent import get_all_places, _haversine_km, _primary_mode, _fetch_all_alternatives, _to_alternative
from app.models.trip import TripPlan, DayPlan, LegResponse, AdaptResponse
from app.models.place import Place
from app.database import supabase
from app.config import settings

log = logging.getLogger(__name__)

# Forecast severity band: a forecast >= this pop% is treated as "heavy" rain (dev19 P2.3).
_HEAVY_POP_PCT = 85

# Maps LTA affected_line names → route code prefix used in OneMap sub_legs.
# e.g. "East West Line" → sub_legs with route "EW2", "EW12", ...
_LTA_LINE_PREFIX: dict[str, str] = {
    "East West Line":          "EW",
    "North South Line":        "NS",
    "Circle Line":             "CC",
    "Downtown Line":           "DT",
    "Thomson-East Coast Line": "TE",
    "North East Line":         "NE",
}


# ---------------------------------------------------------------------------
# Scheduled jobs (called by APScheduler in main.py)
# ---------------------------------------------------------------------------

async def poll_lta_alerts() -> None:
    """[CODE] Check LTA train alerts; insert lta_alerts for affected active trips."""
    if not supabase:
        return

    trips_resp = supabase.table("trips").select("id").eq("status", "HAPPENING_TODAY").execute()
    active_ids = [t["id"] for t in (trips_resp.data or [])]
    if not active_ids:
        return

    # Bulk query to find only trips that have MRT legs — avoids N+1 per trip
    all_legs_resp = (
        supabase.table("route_legs")
        .select("trip_id,transport_mode")
        .in_("trip_id", active_ids)
        .execute()
    )
    mrt_trip_ids = {
        leg["trip_id"]
        for leg in (all_legs_resp.data or [])
        if leg.get("transport_mode") in ("MRT", "METRO")  # MRT = legacy DB value
    }
    if not mrt_trip_ids:
        return  # No active trips with MRT legs — nothing to alert on

    try:
        alerts = await lta.get_train_alerts()
    except LTAUnavailableError as exc:
        log.warning("LTA unavailable: %s", exc)
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        for tid in mrt_trip_ids:
            # Dedup: skip if same alert type was inserted in the last 10 minutes
            existing = (
                supabase.table("lta_alerts")
                .select("id")
                .eq("trip_id", tid)
                .eq("alert_type", "service_unavailable")
                .is_("resolved_at", "null")
                .gte("created_at", cutoff)
                .execute()
            )
            if existing.data:
                continue
            supabase.table("lta_alerts").insert({
                "trip_id": tid,
                "alert_type": "service_unavailable",
                "affected_line": None,
                "message": "LTA DataMall temporarily unavailable — check the official LTA app.",
            }).execute()
        return

    if not alerts:
        return  # All lines normal

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    for trip_id in mrt_trip_ids:
        for alert in alerts:
            line = alert.get("affected_line", "")
            message = alert.get("message", "Train disruption detected")
            # Dedup: skip if the same line already has an unresolved alert in the last 10 min
            existing = (
                supabase.table("lta_alerts")
                .select("id")
                .eq("trip_id", trip_id)
                .eq("alert_type", "train_delay")
                .eq("affected_line", line)
                .is_("resolved_at", "null")
                .gte("created_at", cutoff)
                .execute()
            )
            if existing.data:
                continue
            supabase.table("lta_alerts").insert({
                "trip_id": trip_id,
                "alert_type": "train_delay",
                "affected_line": line,
                "message": f"MRT disruption on {line} line: {message}",
            }).execute()


async def poll_weather_alerts() -> None:
    """[CODE] Check OpenWeather per-day; insert a day-scoped weather_warning when that
    day's forecast shows rain > 70% and the day has outdoor places."""
    if not supabase:
        return

    trips_resp = supabase.table("trips").select("id,start_date").eq("status", "HAPPENING_TODAY").execute()
    active = {t["id"]: t.get("start_date") for t in (trips_resp.data or [])}
    if not active:
        return

    # Bulk query all trip_places in one round-trip — avoids N+1 per trip.
    # day_number groups places per day so each day is forecast against its own date.
    all_places_resp = (
        supabase.table("trip_places")
        .select("trip_id,place_id,day_number")
        .in_("trip_id", list(active.keys()))
        .execute()
    )
    days_by_trip: dict[str, dict[int, list[str]]] = {}
    for row in (all_places_resp.data or []):
        d = row.get("day_number")
        if d is None:
            continue  # hotel / unassigned — not tied to a single day
        days_by_trip.setdefault(row["trip_id"], {}).setdefault(d, []).append(row["place_id"])

    _places = get_all_places()
    today_iso = date.today().isoformat()
    for trip_id, start_date in active.items():
        days = days_by_trip.get(trip_id, {})
        if not days:
            continue
        # One forecast fetch per trip at its centroid — SG is small enough that per-day
        # centroid drift is below OpenWeather's resolution (dev19 P1.3).
        all_pids = [pid for pids in days.values() for pid in pids]
        clat, clng = _centroid([_places[pid] for pid in all_pids if pid in _places])
        try:
            window = await openweather.get_forecast_window(clat, clng)
        except WeatherUnavailableError as exc:
            log.warning("OpenWeather unavailable for trip %s: %s", trip_id, exc)
            continue
        for day, place_ids in sorted(days.items()):
            day_places = [_places[pid] for pid in place_ids if pid in _places]
            day_date = _day_date(start_date, day)
            day_agg = window.get(day_date)
            if day_agg:
                _forecast_swap_alert(trip_id, day, day_date, day_places, day_agg)
            if day_date == today_iso:
                await _check_live_rain(trip_id, day, day_places)


def _centroid(places: list[dict]) -> tuple[float, float]:
    """Mean (lat, lng) of place dicts; falls back to Singapore centre."""
    coords = [(p["lat"], p["lng"]) for p in places if p.get("lat") is not None and p.get("lng") is not None]
    if not coords:
        return SINGAPORE_LAT, SINGAPORE_LNG
    return sum(la for la, _ in coords) / len(coords), sum(ln for _, ln in coords) / len(coords)


def _outdoor_window(outdoor_places: list[dict]) -> tuple[int, int] | None:
    """[start_hour, end_hour] (SGT) the user is at outdoor stops, from best_time_*; None if unknown."""
    starts, ends = [], []
    for p in outdoor_places:
        s, e = p.get("best_time_start"), p.get("best_time_end")
        if isinstance(s, str) and ":" in s:
            starts.append(int(s.split(":")[0]))
        if isinstance(e, str) and ":" in e:
            ends.append(int(e.split(":")[0]))
    if not starts or not ends:
        return None
    return min(starts), max(ends)


def _effective_rain_prob(day_agg: dict, outdoor_places: list[dict]) -> int:
    """Rain % the user actually faces: max pop over 3h slots overlapping the outdoor window.

    Falls back to the day's max pop when slots or best_time_* are unavailable (dev19 P2.1).
    """
    slots = day_agg.get("slots") or []
    window = _outdoor_window(outdoor_places)
    if slots and window:
        start_h, end_h = window
        overlap = [s["pop"] for s in slots if start_h <= s.get("hour", -1) <= end_h]
        if overlap:
            return round(max(overlap) * 100)
    return day_agg.get("rain_probability", 0)


def _forecast_swap_alert(trip_id: str, day: int, day_date: str, places: list[dict], day_agg: dict) -> bool:
    """Insert a day-scoped weather_warning (forecast swap) when rain over the outdoor window
    exceeds the configured threshold. Returns True if inserted."""
    outdoor_places = [p for p in places if p.get("is_outdoor")]
    if not outdoor_places:
        return False

    rain_pct = _effective_rain_prob(day_agg, outdoor_places)
    if rain_pct <= settings.weather_forecast_threshold:
        return False

    suggestions = _build_indoor_swaps(outdoor_places)
    if not suggestions:
        return False

    # Dedup: skip if a warning for THIS day was inserted in the last 10 minutes
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    existing = (
        supabase.table("lta_alerts")
        .select("id")
        .eq("trip_id", trip_id)
        .eq("alert_type", "weather_warning")
        .eq("day_number", day)
        .gte("created_at", cutoff)
        .execute()
    )
    if existing.data:
        return False

    supabase.table("lta_alerts").insert({
        "trip_id": trip_id,
        "alert_type": "weather_warning",
        "affected_line": None,
        "day_number": day,
        "severity": "heavy" if rain_pct >= _HEAVY_POP_PCT else "light",
        "message": _weather_alert_message(day, day_date, rain_pct, suggestions),
    }).execute()
    return True


def _rain_level(rain_mm: float) -> str:
    """Map live rain rate (mm/h) to severity — thresholds match ContextSnapshot.rain_level."""
    if rain_mm >= 7.5:
        return "heavy"
    if rain_mm >= 2.5:
        return "light"
    return "light"  # any measurable rain is at least "light"


async def _check_live_rain(trip_id: str, day: int, places: list[dict]) -> bool:
    """Insert a `weather_live` alert when it is raining RIGHT NOW near today's stops.

    Uses OpenWeather current-weather (free tier). Lighter than a forecast swap: it names the
    next outdoor stop and an optional indoor alternative. Returns True if inserted (dev19 P1.4).
    """
    outdoor_places = [p for p in places if p.get("is_outdoor")]
    if not outdoor_places:
        return False

    clat, clng = _centroid(places)
    try:
        current = await openweather.get_current_weather(clat, clng)
    except WeatherUnavailableError as exc:
        log.warning("Current weather unavailable for trip %s day %s: %s", trip_id, day, exc)
        return False

    rain_mm = float(current.get("rain_1h", 0.0) or 0.0)
    is_raining = rain_mm > 0 or current.get("condition") == "Rain"
    if not is_raining:
        return False

    severity = _rain_level(rain_mm)
    nxt = outdoor_places[0]
    alt = _nearest_indoor(nxt["lat"], nxt["lng"], exclude_ids={p["id"] for p in places})
    swap_hint = f" — consider sheltering or swapping to {alt['name']}" if alt else " — consider sheltering"
    rate = f"{rain_mm:.1f}mm/h" if rain_mm > 0 else current.get("condition", "rain")
    message = (
        f"Day {day}: it's raining now near your route ({severity}, {rate}). "
        f"Your next outdoor stop is {nxt['name']}{swap_hint}."
    )

    # Dedup: live rain changes faster than a forecast, so use a shorter window
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=settings.weather_live_dedup_min)).isoformat()
    existing = (
        supabase.table("lta_alerts")
        .select("id")
        .eq("trip_id", trip_id)
        .eq("alert_type", "weather_live")
        .eq("day_number", day)
        .gte("created_at", cutoff)
        .execute()
    )
    if existing.data:
        return False

    supabase.table("lta_alerts").insert({
        "trip_id": trip_id,
        "alert_type": "weather_live",
        "affected_line": None,
        "day_number": day,
        "severity": severity,
        "message": message,
    }).execute()
    return True


# ---------------------------------------------------------------------------
# Manual trigger — called by POST /trips/{id}/adapt router
# ---------------------------------------------------------------------------

async def adapt_trip(
    trip_id: str,
    alert_id: str,
    current_plan: TripPlan,
) -> AdaptResponse:
    """[CODE] Apply adaptation based on alert type. Returns updated TripPlan."""
    if not supabase:
        return AdaptResponse(adapted=False, changes=["Database unavailable"], updated_trip=current_plan)

    alert_resp = (
        supabase.table("lta_alerts")
        .select("*")
        .eq("id", alert_id)
        .eq("trip_id", trip_id)
        .execute()
    )
    if not alert_resp.data:
        return AdaptResponse(adapted=False, changes=["Alert not found"], updated_trip=current_plan)

    alert = alert_resp.data[0]
    alert_type = alert.get("alert_type", "")

    if alert_type in ("weather_warning", "weather_live"):
        # day_number scopes the swap to the affected day (NULL → legacy whole-trip).
        updated_plan, changes = await _apply_weather_swap(current_plan, day=alert.get("day_number"))
    elif alert_type in ("train_delay", "bus_cancellation"):
        disrupted_lines = [alert["affected_line"]] if alert.get("affected_line") else []
        updated_plan, changes = await _reroute_mrt_legs(current_plan, disrupted_lines=disrupted_lines)
    else:
        return AdaptResponse(adapted=False, changes=["No adaptation needed"], updated_trip=current_plan)

    # Do NOT persist here — caller must explicitly invoke commit_adaptation()
    # after the user accepts the proposal (§6 User Consent Flow).
    delta = _compute_delta(current_plan, updated_plan)
    return AdaptResponse(
        adapted=bool(changes),
        changes=changes,
        updated_trip=updated_plan,
        **delta,
    )


async def check_lta_proximity(
    trip_id: str,
    user_lat: float,
    user_lng: float,
    plan: TripPlan,
) -> None:
    """[CODE] Proximity-triggered LTA check (§3.2): alert if user ≤1km from MRT boarding node and disruption active."""
    if not supabase:
        return

    mrt_from_ids = {
        leg.from_place_id
        for day in plan.days
        for leg in day.legs
        if leg.transport_mode == "METRO"
    }
    if not mrt_from_ids:
        return

    place_map = {p.id: p for p in plan.places}
    nearby = [
        place_map[pid]
        for pid in mrt_from_ids
        if pid in place_map
        and _haversine_km(user_lat, user_lng, place_map[pid].lat, place_map[pid].lng) <= 1.0
    ]
    if not nearby:
        return

    try:
        alerts = await lta.get_train_alerts()
    except LTAUnavailableError as exc:
        log.warning("LTA unavailable during proximity check for trip %s: %s", trip_id, exc)
        return

    if not alerts:
        return

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    for alert in alerts:
        line = alert.get("affected_line", "")
        message = alert.get("message", "Train disruption detected")
        existing = (
            supabase.table("lta_alerts")
            .select("id")
            .eq("trip_id", trip_id)
            .eq("alert_type", "transport_alert")
            .eq("affected_line", line)
            .is_("resolved_at", "null")
            .gte("created_at", cutoff)
            .execute()
        )
        if existing.data:
            continue
        supabase.table("lta_alerts").insert({
            "trip_id": trip_id,
            "alert_type": "transport_alert",
            "affected_line": line,
            "message": f"Disruption near your boarding point: {message}",
        }).execute()


async def commit_adaptation(trip_id: str, updated_trip: TripPlan, alert_id: str) -> None:
    """Persist accepted adaptation to DB and mark alert resolved (POST /accept-swap)."""
    if not supabase:
        return
    await asyncio.to_thread(_persist_updated_legs, trip_id, updated_trip)
    supabase.table("lta_alerts").update(
        {"resolved_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", alert_id).execute()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _compute_delta(original: TripPlan, updated: TripPlan) -> dict:
    """Compute cost/time/walking deltas between original and updated plan."""
    def _totals(plan: TripPlan) -> tuple[float, int, float]:
        cost = sum(leg.cost_sgd for day in plan.days for leg in day.legs)
        time = sum(leg.duration_minutes for day in plan.days for leg in day.legs)
        # Walking distance estimate: WALK legs at 80 m/min
        walk_m = sum(
            leg.duration_minutes * 80
            for day in plan.days for leg in day.legs
            if leg.transport_mode.upper() == "WALK"
        )
        return cost, time, walk_m

    orig_cost, orig_time, orig_walk = _totals(original)
    new_cost, new_time, new_walk = _totals(updated)
    return {
        "delta_transit_cost": round(new_cost - orig_cost, 2),
        "delta_active_time": new_time - orig_time,
        "delta_walking_distance": round(new_walk - orig_walk, 1),
    }


def _day_date(start_date, day: int) -> str:
    """Calendar date (YYYY-MM-DD) for day N of a trip (1-based).

    Each day is forecast against its OWN date so a rain warning is specific to that
    day, not the whole trip. Falls back to today when start_date is missing/unparseable.
    """
    base: date | None = None
    if isinstance(start_date, date):
        base = start_date
    elif isinstance(start_date, str) and start_date:
        try:
            base = date.fromisoformat(start_date[:10])
        except ValueError:
            base = None
    if base is None:
        base = date.today()
    return (base + timedelta(days=max(0, day - 1))).isoformat()


def _weather_alert_message(day: int, day_date: str, rain_prob: int, suggestions: list[str]) -> str:
    """Human-readable weather warning that names the affected day, date, odds, and reason."""
    try:
        label = datetime.fromisoformat(day_date).strftime("%a %d %b")
    except ValueError:
        label = day_date
    n = len(suggestions)
    stops = f"{n} outdoor stop{'s' if n != 1 else ''}"
    return (
        f"Day {day} ({label}): {rain_prob}% chance of rain. "
        f"{stops} may be wet — tap Preview to swap them for nearby indoor spots: "
        f"{'; '.join(suggestions)}"
    )


def _build_indoor_swaps(outdoor_places: list[dict]) -> list[str]:
    """Build 'Outdoor → Indoor' suggestion strings, never reusing a target twice."""
    already: set[str] = {p["id"] for p in outdoor_places}
    suggestions: list[str] = []
    for place in outdoor_places:
        alt = _nearest_indoor(place["lat"], place["lng"], exclude_ids=already)
        if alt:
            suggestions.append(f"{place['name']} → {alt['name']}")
            already.add(alt["id"])
    return suggestions


def _is_open_now(place: dict) -> bool:
    """Return False if the place is provably closed right now. Fails open on parse errors."""
    now_dt = datetime.now(tz=ZoneInfo("Asia/Singapore"))
    now_str = now_dt.strftime("%H:%M")
    day_name = now_dt.strftime("%A")  # e.g. "Monday"

    close_days = place.get("close_days") or []
    if day_name in close_days:
        return False

    opening_hours = place.get("opening_hours")
    if not opening_hours:
        return True
    slots: list[str] = opening_hours if isinstance(opening_hours, list) else [opening_hours]

    for slot in slots:
        parts = slot.split("-")
        if len(parts) != 2:
            return True  # unparseable — fail open
        start, end = parts[0].strip(), parts[1].strip()
        if start == "00:00" and end in ("23:59", "24:00"):
            return True
        # Midnight-crossing slot (e.g. "19:00-02:00")
        if end < start:
            if now_str >= start or now_str <= end:
                return True
        else:
            if start <= now_str <= end:
                return True
    return False


def _nearest_indoor(lat: float, lng: float, exclude_ids: set[str]) -> dict | None:
    """Find nearest open indoor place within 5 km.

    Primary path: Supabase PostGIS RPC `find_nearest_indoor` — single DB call,
    KNN index scan, opening-hours check inside the DB. Returns 0 or 1 row.

    Fallback path: in-memory haversine scan over the local JSON dataset, used
    when Supabase is unavailable (supabase is None) or the RPC raises.
    """
    if supabase:
        try:
            result = supabase.rpc("find_nearest_indoor", {
                "input_lat": lat,
                "input_lng": lng,
                "exclude_ids": list(exclude_ids),
            }).execute()
            return result.data[0] if result.data else None
        except Exception as exc:
            log.warning("find_nearest_indoor RPC failed, falling back to haversine: %s", exc)

    # Fallback: haversine loop over local JSON (covers supabase=None and RPC errors)
    with_dist = [
        (p, _haversine_km(lat, lng, p["lat"], p["lng"]))
        for p in get_all_places().values()
        if not p["is_outdoor"]
        and p["id"] not in exclude_ids
        and _is_open_now(p)
    ]
    in_range = [(p, d) for p, d in with_dist if d < 5.0]
    if not in_range:
        return None
    return min(in_range, key=lambda item: item[1])[0]


def _ordered_place_ids_from_legs(legs: list) -> list[str]:
    """Reconstruct an ordered place-id list for a day from its leg chain ([] if no legs)."""
    ids: list[str] = []
    for leg in legs:
        if leg.from_place_id not in ids:
            ids.append(leg.from_place_id)
    if legs and legs[-1].to_place_id not in ids:
        ids.append(legs[-1].to_place_id)
    return ids


def _day_place_ids(plan: TripPlan, day: int) -> set[str]:
    """All non-hotel place IDs belonging to a given day (from place_ids + legs)."""
    target = next((d for d in plan.days if d.day == day), None)
    if target is None:
        return set()
    ids: set[str] = set(target.place_ids or [])
    for leg in target.legs:
        ids.add(leg.from_place_id)
        ids.add(leg.to_place_id)
    ids.discard("hotel")
    return ids


async def _apply_weather_swap(plan: TripPlan, day: int | None = None) -> tuple[TripPlan, list[str]]:
    """Replace outdoor places with nearest indoor alternatives.

    When `day` is given, only the outdoor places belonging to that day are swapped —
    legs and places of other days pass through untouched. `day=None` keeps the legacy
    whole-trip behaviour (used by transit paths and pre-migration weather alerts).
    """
    scope: set[str] | None = _day_place_ids(plan, day) if day is not None else None

    swap_map: dict[str, dict] = {}  # old_place_id → new_place_dict
    # Seed with ALL place IDs already in the plan (indoor + outdoor).
    # This prevents two outdoor places from swapping to the same indoor target
    # (Bug #1) and prevents suggesting a place the user already visits (Bug #2).
    already_used: set[str] = {p.id for p in plan.places}
    for place in plan.places:
        if place.is_outdoor and (scope is None or place.id in scope):
            alt = _nearest_indoor(place.lat, place.lng, exclude_ids=already_used)
            if alt:
                swap_map[place.id] = alt
                already_used.add(alt["id"])  # claim slot before next iteration

    if not swap_map:
        return plan, []

    changes = [
        f"{plan.places[i].name} → {swap_map[p.id]['name']} (rain forecast)"
        for i, p in enumerate(plan.places)
        if p.id in swap_map
    ]

    # Rebuild places with swaps — kept places pulled from _PLACES to preserve all
    # fields (opening_hours, close_days, description, etc.). Inline dict is a
    # last-resort fallback for places not in the curated dataset (e.g. test fixtures).
    _all_places = get_all_places()
    new_places_raw = [
        swap_map.get(p.id) or _all_places.get(p.id) or {
            "id": p.id, "name": p.name, "lat": p.lat, "lng": p.lng,
            "dwell_minutes": p.dwell_minutes, "best_time_start": p.best_time_start,
            "best_time_end": p.best_time_end, "category": p.category,
            "is_outdoor": p.is_outdoor,
        }
        for p in plan.places
    ]

    # Build lookup from the new (post-swap) places list for leg recalculation
    effective_place_lookup: dict[str, dict] = {p["id"]: p for p in new_places_raw}

    new_days = []
    for day in plan.days:
        new_legs = []
        for leg in day.legs:
            new_from = swap_map.get(leg.from_place_id, {}).get("id", leg.from_place_id) if leg.from_place_id in swap_map else leg.from_place_id
            new_to = swap_map.get(leg.to_place_id, {}).get("id", leg.to_place_id) if leg.to_place_id in swap_map else leg.to_place_id

            if new_from != leg.from_place_id or new_to != leg.to_place_id:
                from_p = effective_place_lookup.get(new_from)
                to_p = effective_place_lookup.get(new_to)
                new_leg = await _recalculate_leg(leg, from_p, to_p, new_from, new_to)
            else:
                new_leg = leg
            new_legs.append(new_leg)
        old_to_new = {old_id: new_p["id"] for old_id, new_p in swap_map.items()}
        new_place_ids = [old_to_new.get(pid, pid) for pid in (day.place_ids or [])]
        new_days.append(DayPlan(day=day.day, legs=new_legs, place_ids=new_place_ids))

    new_places = [
        Place(
            id=p["id"], name=p["name"], lat=p["lat"], lng=p["lng"],
            dwell_minutes=p.get("dwell_minutes", 60),
            best_time_start=p.get("best_time_start", "00:00"),
            best_time_end=p.get("best_time_end", "23:59"),
            opening_hours=p.get("opening_hours"),
            category=p.get("category", ""),
            is_outdoor=p.get("is_outdoor", False),
            in_curated_dataset=p["id"] in get_all_places(),
            image_url=p.get("image_url"),
        )
        for p in new_places_raw
    ]
    return TripPlan(id=plan.id, days=new_days, places=new_places, warnings=plan.warnings), changes


def _leg_uses_disrupted_line(sub_legs: list[dict], disrupted_prefixes: set[str]) -> bool:
    """Return True iff any sub-leg is a METRO leg on a disrupted line.

    ⚠️  mode == "METRO" is checked FIRST (Python short-circuit evaluation).
    Singapore bus stop names often embed MRT line codes as wayfinding hints
    (e.g. "Bugis Stn Exit B EW12") — evaluating the route prefix before mode
    would cause BUS sub-legs to be falsely flagged as disrupted METRO legs.
    """
    return any(
        sl.get("mode") == "METRO"                      # ① METRO check — short-circuits if False
        and any(                                       # ② only then inspect route prefix
            sl.get("route", "").upper().startswith(pfx)
            for pfx in disrupted_prefixes
        )
        for sl in sub_legs
    )


def _first_bus_stop_code(sub_legs: list[dict]) -> str | None:
    """Return LTA stop code for the first BUS boarding point, or None."""
    bus_leg = next((sl for sl in sub_legs if sl.get("mode") == "BUS"), None)
    return (bus_leg.get("from_stop_code") or None) if bus_leg else None


async def _reroute_mrt_legs(
    plan: TripPlan,
    disrupted_lines: list[str] = [],
) -> tuple[TripPlan, list[str]]:
    """Recalculate METRO legs around a known disruption (Option C: post-filter + retry).

    Strategy per METRO leg:
      1. Call OneMap PT normally — OTP may already avoid the disrupted line.
      2. Inspect sub_legs: if any METRO sub-leg still uses the disrupted line prefix,
         retry the call with transit_modes="BUS" to force a bus-only route.
      3. If the BUS retry also raises NoRouteError, keep the original leg and set
         is_estimated=True so the UI can surface a warning badge.

    disrupted_lines: list of LTA affected_line names (e.g. ["East West Line"]).
                     Empty list → legacy behaviour, no retry logic.
    """
    disrupted_prefixes: set[str] = {
        _LTA_LINE_PREFIX[name]
        for name in disrupted_lines
        if name in _LTA_LINE_PREFIX
    }

    changes: list[str] = []
    new_days: list[DayPlan] = []
    warnings: list[str] = list(plan.warnings)
    place_map = {p.id: p for p in plan.places}

    for day in plan.days:
        new_legs: list[LegResponse] = []
        for leg in day.legs:
            if leg.transport_mode != "METRO":
                new_legs.append(leg)
                continue

            from_p = place_map.get(leg.from_place_id)
            to_p = place_map.get(leg.to_place_id)
            if not from_p or not to_p:
                new_legs.append(leg)
                continue

            try:
                # Step 1: Try PT normally (OTP may already route around disruption)
                route = await onemap.get_route(
                    from_p.lat, from_p.lng, to_p.lat, to_p.lng, mode="pt"
                )
                sub_legs_data: list[dict] = route.get("sub_legs", [])
                new_mode = _primary_mode(route.get("legs", []))

                # Step 2: Post-filter — did OTP still route via the disrupted line?
                if disrupted_prefixes and _leg_uses_disrupted_line(sub_legs_data, disrupted_prefixes):
                    try:
                        route = await onemap.get_route(
                            from_p.lat, from_p.lng, to_p.lat, to_p.lng,
                            mode="pt", transit_modes="BUS",
                        )
                        sub_legs_data = route.get("sub_legs", [])
                        new_mode = "BUS"
                    except NoRouteError:
                        # No bus alternative — keep original leg, mark as estimated
                        warn_msg = (
                            f"No bus route for {leg.from_place_id} → {leg.to_place_id} "
                            f"during disruption; original METRO route retained."
                        )
                        warnings.append(warn_msg)
                        log.warning(warn_msg)
                        new_legs.append(
                            LegResponse(
                                id=leg.id,
                                from_place_id=leg.from_place_id,
                                to_place_id=leg.to_place_id,
                                transport_mode=leg.transport_mode,
                                duration_minutes=leg.duration_minutes,
                                cost_sgd=leg.cost_sgd,
                                is_estimated=True,
                            )
                        )
                        continue

                new_leg = LegResponse(
                    id=leg.id,
                    from_place_id=leg.from_place_id,
                    to_place_id=leg.to_place_id,
                    transport_mode=new_mode,
                    duration_minutes=route["duration_minutes"],
                    cost_sgd=route["fare_sgd"],
                    is_estimated=False,
                    geometry=route.get("geometry"),
                    geometries=route.get("geometries", []),
                    instructions=route.get("instructions", []),
                    distance_km=route.get("distance_km"),
                    sub_legs=sub_legs_data,
                    first_bus_stop_code=_first_bus_stop_code(sub_legs_data) if new_mode == "BUS" else None,
                )
                if new_mode != "METRO":
                    changes.append(
                        f"Leg {leg.from_place_id} → {leg.to_place_id}: METRO → {new_mode} (disruption)"
                    )
                new_legs.append(new_leg)

            except NoRouteError as exc:
                log.warning("No route for leg %s → %s: %s", leg.from_place_id, leg.to_place_id, exc)
                new_legs.append(leg)
            except Exception as exc:
                log.error("Unexpected error rerouting leg %s → %s: %s", leg.from_place_id, leg.to_place_id, exc)
                new_legs.append(leg)

        new_days.append(DayPlan(day=day.day, legs=new_legs, place_ids=day.place_ids or []))

    return TripPlan(id=plan.id, days=new_days, places=plan.places, warnings=warnings), changes


async def _recalculate_leg(
    original: LegResponse,
    from_p: dict | None,
    to_p: dict | None,
    new_from_id: str,
    new_to_id: str,
) -> LegResponse:
    """Call OneMap for a swapped leg; fall back to original data with is_estimated=True.

    Fetches all mode alternatives in parallel so the mode picker can accurately
    grey-out unavailable modes after the swap (instead of showing every mode as available).
    """
    if from_p and to_p:
        try:
            from_dict = {"id": new_from_id, "lat": from_p["lat"], "lng": from_p["lng"]}
            to_dict   = {"id": new_to_id,   "lat": to_p["lat"],   "lng": to_p["lng"]}
            all_alts = await _fetch_all_alternatives(from_dict, to_dict)
            if not all_alts:
                raise NoRouteError(f"No alternatives for {new_from_id} → {new_to_id}")
            # Prefer METRO (PT mixed) → BUS → WALK → CYCLE as primary route
            pt_key = next((m for m in ("METRO", "BUS", "WALK", "CYCLE") if m in all_alts), None)
            route = all_alts[pt_key]
            new_mode = _primary_mode(route.get("legs", []))
            sub_legs_data: list[dict] = route.get("sub_legs", [])
            alt_models = {m: _to_alternative(r) for m, r in all_alts.items()}
            return LegResponse(
                id=original.id,
                from_place_id=new_from_id,
                to_place_id=new_to_id,
                transport_mode=new_mode,
                duration_minutes=route["duration_minutes"],
                cost_sgd=route.get("fare_sgd", 0.0),
                is_estimated=False,
                geometry=route.get("geometry"),
                geometries=route.get("geometries", []),
                instructions=route.get("instructions", []),
                distance_km=route.get("distance_km"),
                sub_legs=sub_legs_data,
                first_bus_stop_code=_first_bus_stop_code(sub_legs_data) if new_mode == "BUS" else None,
                alternatives=alt_models,
            )
        except Exception as exc:
            # OneMap failed — fall through to estimated fallback.
            # is_estimated=True is intentional: the user must see the badge.
            log.warning("OneMap recalculation failed for swapped leg %s → %s: %s", new_from_id, new_to_id, exc)

    return LegResponse(
        id=original.id,
        from_place_id=new_from_id,
        to_place_id=new_to_id,
        transport_mode=original.transport_mode,
        duration_minutes=original.duration_minutes,
        cost_sgd=original.cost_sgd,
        is_estimated=True,
        # Preserve display fields from the original leg — routing geometry is still
        # approximately valid (same general area, even if from/to slightly changed).
        first_bus_stop_code=original.first_bus_stop_code,
        geometry=original.geometry,
        geometries=original.geometries or [],
        instructions=original.instructions or [],
        distance_km=original.distance_km,
        sub_legs=original.sub_legs or [],
    )


async def check_alerts_for_trip(
    trip_id: str,
    plan: TripPlan,
    active_day: int | None = None,
    active_leg_index: int | None = None,
) -> dict:
    """On-demand alert check for a specific trip (demand-triggered, UPCOMING trips).

    Runs both LTA train check and weather check using the same dedup logic as
    the scheduled poll jobs. Inserts into lta_alerts; frontend receives new rows
    via the existing Supabase Realtime WebSocket in useAlerts.js.

    active_day / active_leg_index (live trips) limit the live-rain check to outdoor stops
    the user has not yet passed (dev19 P2.2).

    Returns {"lta_checked": bool, "weather_checked": bool, "alerts_inserted": int}.
    """
    if not supabase:
        return {"lta_checked": False, "weather_checked": False, "alerts_inserted": 0}

    alerts_inserted = 0
    lta_checked = False
    weather_checked = False
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()

    # ── LTA train check ───────────────────────────────────────────────────────
    has_metro = any(
        leg.transport_mode in ("METRO", "MRT")
        for day in plan.days
        for leg in day.legs
    )
    if has_metro:
        lta_checked = True
        try:
            train_alerts = await lta.get_train_alerts()
        except LTAUnavailableError as exc:
            log.warning("LTA unavailable during on-demand check for trip %s: %s", trip_id, exc)
            train_alerts = []  # soft failure — proceed to weather check

        for alert in train_alerts:
            line = alert.get("affected_line", "")
            message = alert.get("message", "Train disruption detected")
            existing = (
                supabase.table("lta_alerts")
                .select("id")
                .eq("trip_id", trip_id)
                .eq("alert_type", "train_delay")
                .eq("affected_line", line)
                .is_("resolved_at", "null")
                .gte("created_at", cutoff)
                .execute()
            )
            if existing.data:
                continue
            supabase.table("lta_alerts").insert({
                "trip_id": trip_id,
                "alert_type": "train_delay",
                "affected_line": line,
                "message": f"MRT disruption on {line} line: {message}",
            }).execute()
            alerts_inserted += 1

    # ── Weather check (per day) ───────────────────────────────────────────────
    if any(p.is_outdoor for p in plan.places):
        weather_checked = True
        start_date = None
        try:
            trip_row = supabase.table("trips").select("start_date").eq("id", trip_id).execute()
            if trip_row.data:
                start_date = trip_row.data[0].get("start_date")
        except Exception as exc:
            log.warning("Could not read start_date for trip %s: %s", trip_id, exc)

        places_by_id = {p.id: p for p in plan.places}

        def _pdict(p):
            return {"id": p.id, "name": p.name, "lat": p.lat, "lng": p.lng,
                    "is_outdoor": p.is_outdoor, "best_time_start": p.best_time_start,
                    "best_time_end": p.best_time_end}

        clat, clng = _centroid([_pdict(p) for p in plan.places if p.id != "hotel"])
        today_iso = date.today().isoformat()
        try:
            window = await openweather.get_forecast_window(clat, clng)
        except WeatherUnavailableError as exc:
            log.warning("OpenWeather unavailable for on-demand check trip %s: %s", trip_id, exc)
            window = {}

        for day in plan.days:
            ordered_ids = _ordered_place_ids_from_legs(day.legs) or list(_day_place_ids(plan, day.day))
            day_places = [_pdict(places_by_id[pid]) for pid in ordered_ids
                          if pid != "hotel" and pid in places_by_id]
            day_date = _day_date(start_date, day.day)
            day_agg = window.get(day_date)
            if day_agg and _forecast_swap_alert(trip_id, day.day, day_date, day_places, day_agg):
                alerts_inserted += 1
            if day_date == today_iso:
                # Skip stops already passed when we know live progress (P2.2)
                start_idx = (active_leg_index if active_day == day.day and active_leg_index is not None else 0)
                live_places = day_places[start_idx:] if 0 < start_idx < len(day_places) else day_places
                if await _check_live_rain(trip_id, day.day, live_places):
                    alerts_inserted += 1

    return {"lta_checked": lta_checked, "weather_checked": weather_checked, "alerts_inserted": alerts_inserted}


def _persist_updated_legs(trip_id: str, plan: TripPlan) -> None:
    """Persist accepted adaptation: update trip_places and route_legs (full column set)."""
    if not supabase:
        return

    # trip_places: delete and re-insert so swapped place IDs are reflected.
    supabase.table("trip_places").delete().eq("trip_id", trip_id).execute()
    place_day_order: dict[str, tuple[int | None, int | None]] = {}
    for day in plan.days:
        # Fall back to the leg chain when place_ids is empty (legacy plans), otherwise
        # every place would persist with day_number=NULL and float to the end on reload.
        ordered_ids = day.place_ids or _ordered_place_ids_from_legs(day.legs)
        for order_idx, pid in enumerate(ordered_ids):
            if pid == "hotel":
                place_day_order.setdefault("hotel", (None, None))
            else:
                place_day_order[pid] = (day.day, order_idx)
    place_rows = []
    for p in plan.places:
        day_num, order_in_day = place_day_order.get(p.id, (None, None))
        place_rows.append({
            "trip_id": trip_id,
            "place_id": p.id,
            "place_name": p.name,
            "lat": p.lat,
            "lng": p.lng,
            "dwell_minutes": p.dwell_minutes,
            "day_number": day_num,
            "order_in_day": order_in_day,
        })
    if place_rows:
        supabase.table("trip_places").insert(place_rows).execute()

    # route_legs: upsert with all geometry/routing columns so a server restart
    # doesn't lose map polylines, bus stop codes, or sub-leg detail.
    leg_rows = [
        {
            "id": leg.id,
            "trip_id": trip_id,
            "day_number": day.day,
            "from_place_id": leg.from_place_id,
            "to_place_id": leg.to_place_id,
            "transport_mode": leg.transport_mode,
            "duration_minutes": leg.duration_minutes,
            "cost_sgd": leg.cost_sgd,
            "is_estimated": leg.is_estimated,
            "geometry": leg.geometry,
            "geometries": leg.geometries if leg.geometries else [],
            "instructions": leg.instructions,
            "distance_km": float(leg.distance_km) if leg.distance_km is not None else None,
            "sub_legs": [sl.model_dump() for sl in leg.sub_legs] if leg.sub_legs else [],
            "first_bus_stop_code": leg.first_bus_stop_code,
        }
        for day in plan.days
        for leg in day.legs
    ]
    if leg_rows:
        supabase.table("route_legs").upsert(leg_rows).execute()
