"""
Adaptation Agent — 100% rule-based code, no LLM.
- Automatic: poll_lta_alerts() every 2 min, poll_weather_alerts() every settings.weather_poll_minutes (default 120 min) via APScheduler.
- Manual:    adapt_trip() called by POST /trips/{id}/adapt router.
"""

import asyncio
import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.services import lta, openweather, onemap
from app.services.openweather import SINGAPORE_LAT, SINGAPORE_LNG
from app.services.lta import LTAUnavailableError
from app.services.openweather import WeatherUnavailableError
from app.services.onemap import NoRouteError
from app.agents.planning_agent import (
    get_all_places, _haversine_km, _primary_mode, _fetch_all_alternatives,
    _to_alternative, _parse_hhmm, _fmt_hhmm,
)
from app.models.trip import TripPlan, DayPlan, LegResponse, AdaptResponse
from app.models.place import Place
from app.database import supabase
from app.config import settings

log = logging.getLogger(__name__)

SGT = ZoneInfo("Asia/Singapore")

# Closing-risk schedule baseline (dev20) — mirrors planning_agent's day model.
_DAY_START_MIN = 540   # 09:00
_DAY_END_HARD  = 1050  # 17:30 — same hard cap _check_schedule_fit uses for "overfull"

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
    resolution: str | None = None,
    target_day: int | None = None,
) -> AdaptResponse:
    """[CODE] Apply adaptation based on alert type. Returns updated TripPlan.

    closing_risk alerts (dev20) carry a `resolution` chosen by the user:
    leave_earlier (advisory, no change) / skip (drop the stop) / push (move to target_day).
    """
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

    if alert_type == "closing_risk":
        return await _resolve_closing_risk(trip_id, current_plan, alert, resolution, target_day)
    elif alert_type in ("weather_warning", "weather_live"):
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


async def commit_adaptation(
    trip_id: str, updated_trip: TripPlan, alert_id: str, advisory: bool = False
) -> None:
    """Persist accepted adaptation to DB and mark alert resolved (POST /accept-swap).

    advisory=True (e.g. closing_risk leave_earlier) means the trip is unchanged, so the
    leg/place re-write is skipped entirely and only the alert is marked resolved (dev20).
    """
    if not supabase:
        return
    if not advisory:
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
        f"{stops} may be wet — tap Preview to swap them for nearby indoor spots."
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


# ---------------------------------------------------------------------------
# Closing-risk / running-late detection (dev20) — 100% rule-based
# ---------------------------------------------------------------------------

def _curated_or_model(place: Place) -> dict:
    """Merge a plan Place with its curated dataset entry so opening_hours / close_days /
    dwell are reliable even when the persisted trip row omitted them. Curated wins."""
    curated = get_all_places().get(place.id, {})
    return {
        "id": place.id,
        "name": place.name,
        "lat": place.lat,
        "lng": place.lng,
        "opening_hours": curated.get("opening_hours", place.opening_hours),
        "close_days": curated.get("close_days", place.close_days),
        "dwell_minutes": curated.get("dwell_minutes", place.dwell_minutes) or 60,
    }


def _slot_bounds(slot: str) -> tuple[int, int] | None:
    """(open_min, close_min) for one 'HH:MM-HH:MM' slot. close += 1440 when it crosses
    midnight (e.g. '19:00-02:00' closes at 26:00). None for 24h / unparseable → never closes."""
    parts = slot.split("-")
    if len(parts) != 2:
        return None
    start, end = parts[0].strip(), parts[1].strip()
    if start == "00:00" and end in ("23:59", "24:00"):
        return None
    try:
        o, c = _parse_hhmm(start), _parse_hhmm(end)
    except (ValueError, IndexError):
        return None
    if c <= o:
        c += 1440  # crosses midnight → still open well past today's stops
    return o, c


def _close_minute_today(place: dict, now_dt: datetime) -> int | None:
    """Minute-of-day the place closes today, honouring close_days + the slot that still applies.

    Returns None when it never constrains (24h / no hours) or it is closed today
    (close_days) — the latter is handled at plan time by dev21's relocation, not here.
    For multi-slot days, picks the earliest slot the user can still use (close >= now); if
    every slot has already passed, returns the latest close so a late arrival is flagged.
    """
    if now_dt.strftime("%A") in (place.get("close_days") or []):
        return None
    oh = place.get("opening_hours")
    if not oh:
        return None
    slots = oh if isinstance(oh, list) else [oh]
    bounds = [b for b in (_slot_bounds(s) for s in slots) if b is not None]
    if not bounds:
        return None  # all slots 24h / unparseable → never closes
    now_min = now_dt.hour * 60 + now_dt.minute
    usable = [c for _, c in bounds if c >= now_min]
    return min(usable) if usable else max(c for _, c in bounds)


def _departure_clock(
    plan: TripPlan,
    active_day: int,
    active_leg_index: int | None,
    now_min: int,
    arrived_at_min: int | None,
    anchor_min: int | None,
) -> tuple[int, str, bool] | None:
    """Projected minute-of-day the user departs the stop they currently control.

    Returns (depart_min, current_place_id, dwelling) or None when the day has no legs.
    - anchor_min set ("I left this stop") → departed at anchor_min.
    - arrived_at_min set (dwelling)       → departs at max(now, arrived + dwell): arriving
      early keeps downstream on time; overstaying only bites once the banked time is gone.
    - neither (auto / in transit)         → departed at now_min.
    """
    day = next((d for d in plan.days if d.day == active_day), None)
    if day is None or not day.legs:
        return None
    li = active_leg_index if active_leg_index is not None else 0
    li = max(0, min(li, len(day.legs) - 1))
    cur_id = day.legs[li].from_place_id
    cur_dwell = _curated_or_model(next((p for p in plan.places if p.id == cur_id), None)).get("dwell_minutes", 60) \
        if any(p.id == cur_id for p in plan.places) else 60
    if anchor_min is not None:
        return anchor_min, cur_id, False
    if arrived_at_min is not None:
        return max(now_min, arrived_at_min + cur_dwell), cur_id, True
    return now_min, cur_id, False


def _project_today_timeline(
    plan: TripPlan,
    active_day: int,
    active_leg_index: int | None,
    now_min: int,
    arrived_at_min: int | None,
    anchor_min: int | None,
) -> list[dict]:
    """Project [{place_id, arrival_min, finish_min}, ...] for the remaining stops of the
    active day, starting from the user's real departure clock (dev20 B2). Hotel leg excluded."""
    dep = _departure_clock(plan, active_day, active_leg_index, now_min, arrived_at_min, anchor_min)
    if dep is None:
        return []
    depart_clock, _cur_id, _dwelling = dep
    day = next((d for d in plan.days if d.day == active_day), None)
    legs = day.legs
    li = active_leg_index if active_leg_index is not None else 0
    li = max(0, min(li, len(legs) - 1))
    place_map = {p.id: _curated_or_model(p) for p in plan.places}

    timeline: list[dict] = []
    clock = depart_clock
    for leg in legs[li:]:
        to_id = leg.to_place_id
        if to_id == "hotel":
            break  # hotel return leg is not a stop to visit
        arrival = clock + (leg.duration_minutes or 0)
        dwell = place_map.get(to_id, {}).get("dwell_minutes", 60)
        finish = arrival + dwell
        timeline.append({"place_id": to_id, "arrival_min": arrival, "finish_min": finish})
        clock = finish
    return timeline


def _day_capacity_summary(plan: TripPlan, active_day: int, at_risk: dict) -> list[dict]:
    """For every day other than active_day, a {room|full|closed} verdict for at_risk place.

    `closed` — at_risk shut that weekday (close_days). `full` — open but the day already runs
    past 17:30. `room` — open with spare time. Weekday derived as today + (day - active_day)
    (live trip → active day's date == today), so no start_date is needed.
    """
    today = date.today()
    close_days = set(at_risk.get("close_days") or [])
    place_map = {p.id: _curated_or_model(p) for p in plan.places}
    out: list[dict] = []
    for day in plan.days:
        if day.day == active_day:
            continue
        ordered = [pid for pid in _ordered_place_ids_from_legs(day.legs) if pid != "hotel"]
        occupied = sum(leg.duration_minutes or 0 for leg in day.legs)
        occupied += sum(place_map.get(pid, {}).get("dwell_minutes", 60) for pid in ordered)
        remaining = max(0, _DAY_END_HARD - (_DAY_START_MIN + occupied))
        d = today + timedelta(days=day.day - active_day)
        weekday = d.strftime("%A")
        if weekday in close_days:
            status = "closed"
        elif _DAY_START_MIN + occupied > _DAY_END_HARD:
            status = "full"
        else:
            status = "room"
        out.append({
            "day": day.day,
            "date": d.isoformat(),
            "weekday": weekday,
            "occupied_minutes": occupied,
            "remaining_minutes": remaining,
            "status": status,
        })
    return out


def _check_closing_risk(
    trip_id: str,
    plan: TripPlan,
    active_day: int,
    active_leg_index: int | None,
    now_dt: datetime,
    arrived_at_min: int | None,
    anchor_min: int | None,
    start_date,
) -> bool:
    """Detect the earliest remaining stop the user will reach too late to use before it
    closes, decide which resolutions are feasible, and insert one closing_risk alert.
    Returns True if an alert was inserted. Live (today) trips only.

    now_dt drives both the wall-clock minute and the weekday, so the check is fully
    deterministic given its inputs (no hidden clock reads)."""
    if not supabase:
        return False
    if _day_date(start_date, active_day) != now_dt.date().isoformat():
        return False

    now_min = now_dt.hour * 60 + now_dt.minute
    place_map = {p.id: _curated_or_model(p) for p in plan.places}
    timeline = _project_today_timeline(plan, active_day, active_leg_index, now_min, arrived_at_min, anchor_min)
    if not timeline:
        return False

    min_useful_cfg = settings.closing_min_useful_min

    # Find the earliest at-risk stop (fire one alert; next poll re-evaluates after a resolution).
    at_risk: dict | None = None
    at_risk_idx = -1
    for idx, entry in enumerate(timeline):
        pd = place_map.get(entry["place_id"])
        if not pd:
            continue
        close_min = _close_minute_today(pd, now_dt)
        if close_min is None:
            continue
        dwell = pd["dwell_minutes"]
        min_useful = min(dwell, min_useful_cfg)
        latest_ok = close_min - min_useful
        if entry["arrival_min"] > latest_ok:
            at_risk = {**pd, "close_min": close_min, "arrival_min": entry["arrival_min"],
                       "deficit": entry["arrival_min"] - latest_ok, "min_useful": min_useful}
            at_risk_idx = idx
            break
    if at_risk is None:
        return False

    # Dedup: same place, unresolved, within the configured window.
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=settings.closing_risk_dedup_min)).isoformat()
    existing = (
        supabase.table("lta_alerts")
        .select("id,metadata")
        .eq("trip_id", trip_id)
        .eq("alert_type", "closing_risk")
        .is_("resolved_at", "null")
        .gte("created_at", cutoff)
        .execute()
    )
    for row in (existing.data or []):
        if (row.get("metadata") or {}).get("place_id") == at_risk["id"]:
            return False

    deficit = at_risk["deficit"]

    # ── Recovery: can the user fix this just by leaving controllable stops earlier? ──
    dep = _departure_clock(plan, active_day, active_leg_index, now_min, arrived_at_min, anchor_min)
    depart_clock, cur_id, dwelling = dep
    controllable: list[dict] = []
    if dwelling:  # still at the current stop → its remaining stay can be trimmed
        cur = place_map.get(cur_id, {"name": cur_id, "dwell_minutes": 60})
        controllable.append({
            "name": cur.get("name", cur_id),
            "trim_budget": max(0, cur.get("dwell_minutes", 60) - min(cur.get("dwell_minutes", 60), min_useful_cfg)),
            "planned_leave": depart_clock,
        })
    for entry in timeline[:at_risk_idx]:  # intermediate stops before the at-risk one
        pd = place_map.get(entry["place_id"], {})
        dwell = pd.get("dwell_minutes", 60)
        controllable.append({
            "name": pd.get("name", entry["place_id"]),
            "trim_budget": max(0, dwell - min(dwell, min_useful_cfg)),
            "planned_leave": entry["finish_min"],
        })

    recoverable_slack = sum(c["trim_budget"] for c in controllable)
    leave_earlier: dict
    if controllable and deficit <= recoverable_slack:
        nearest = controllable[0]
        trim = min(deficit, nearest["trim_budget"])
        leave_earlier = {
            "feasible": True,
            "current_place_name": nearest["name"],
            "target_leave_time": _fmt_hhmm((nearest["planned_leave"] - trim) % 1440),
            "save_minutes": trim,
        }
    else:
        leave_earlier = {"feasible": False}

    # ── Push: which other days can actually host this place? ──
    day_capacity = _day_capacity_summary(plan, active_day, at_risk)
    open_days = [d for d in day_capacity if d["status"] != "closed"]
    push: dict = {"feasible": bool(open_days), "day_capacity": day_capacity}
    if not open_days:
        push["reason"] = "closed_all" if day_capacity else "no_other_day"

    projected_arrival = _fmt_hhmm(at_risk["arrival_min"] % 1440)
    close_time = _fmt_hhmm(at_risk["close_min"] % 1440)
    metadata = {
        "place_id": at_risk["id"],
        "place_name": at_risk["name"],
        "projected_arrival": projected_arrival,
        "close_time": close_time,
        "deficit_min": deficit,
        "resolutions": {
            "leave_earlier": leave_earlier,
            "skip": {"feasible": True},
            "push": push,
        },
    }

    if leave_earlier["feasible"]:
        fix = (f"Leave {leave_earlier['current_place_name']} before "
               f"{leave_earlier['target_leave_time']} to still make it.")
    elif push["feasible"]:
        fix = "Consider skipping it or moving it to another day."
    else:
        fix = "Consider skipping it."
    message = (
        f"You're projected to reach {at_risk['name']} at {projected_arrival}, "
        f"but it closes at {close_time}. {fix}"
    )

    supabase.table("lta_alerts").insert({
        "trip_id": trip_id,
        "alert_type": "closing_risk",
        "affected_line": None,
        "day_number": active_day,
        "severity": "heavy" if deficit > 30 else "light",
        "message": message,
        "metadata": metadata,
    }).execute()
    return True


def _day_ordered(day: DayPlan) -> list[str]:
    """Ordered place ids for a day — from the leg chain, falling back to place_ids for
    single-place days that have no legs."""
    return _ordered_place_ids_from_legs(day.legs) or list(day.place_ids or [])


def _fetch_hotel(trip_id: str) -> dict | None:
    """Hotel {lat, lng} from the trips table, or None when unset/unavailable."""
    if not supabase:
        return None
    try:
        r = supabase.table("trips").select("hotel_lat,hotel_lng").eq("id", trip_id).execute()
        if r.data and r.data[0].get("hotel_lat") is not None and r.data[0].get("hotel_lng") is not None:
            return {"lat": float(r.data[0]["hotel_lat"]), "lng": float(r.data[0]["hotel_lng"])}
    except Exception as exc:
        log.warning("Could not read hotel for trip %s: %s", trip_id, exc)
    return None


async def _reroute_day_to_order(day: DayPlan, new_ordered: list[str], coord: dict[str, dict]) -> DayPlan:
    """Rebuild a day's legs to follow new_ordered. Legs that already connect a consecutive
    pair are reused as-is; only newly adjacent pairs are re-routed via OneMap (estimated
    fallback on failure). Fresh leg ids avoid colliding with the legs being replaced."""
    existing = {(leg.from_place_id, leg.to_place_id): leg for leg in day.legs}
    new_legs: list[LegResponse] = []
    for a, b in zip(new_ordered, new_ordered[1:]):
        reuse = existing.get((a, b))
        if reuse is not None:
            new_legs.append(reuse)
            continue
        template = (
            next((leg for leg in day.legs if leg.from_place_id == a), None)
            or next((leg for leg in day.legs if leg.to_place_id == b), None)
        )
        synthetic = LegResponse(
            id=str(uuid.uuid4()),
            from_place_id=a,
            to_place_id=b,
            transport_mode=template.transport_mode if template else "WALK",
            duration_minutes=template.duration_minutes if template else 15,
            cost_sgd=template.cost_sgd if template else 0.0,
            is_estimated=True,
        )
        new_legs.append(await _recalculate_leg(synthetic, coord.get(a), coord.get(b), a, b))
    return DayPlan(day=day.day, legs=new_legs, place_ids=[pid for pid in new_ordered if pid != "hotel"])


async def _resolve_closing_risk(
    trip_id: str,
    plan: TripPlan,
    alert: dict,
    resolution: str | None,
    target_day: int | None,
) -> AdaptResponse:
    """Apply a user-chosen closing_risk resolution (dev20 B6). Propose only — caller persists
    on accept via commit_adaptation. leave_earlier is advisory (no structural change)."""
    metadata = alert.get("metadata") or {}
    place_id = metadata.get("place_id")
    place_name = metadata.get("place_name", place_id)
    if not place_id:
        return AdaptResponse(adapted=False, changes=["Closing-risk alert has no place"], updated_trip=plan)

    # ── leave_earlier: advisory, change nothing; accept resolves the alert. ──
    if resolution == "leave_earlier":
        le = (metadata.get("resolutions") or {}).get("leave_earlier") or {}
        if le.get("feasible"):
            note = (
                f"Leave {le.get('current_place_name')} before {le.get('target_leave_time')} "
                f"to reach {place_name} in time (~{le.get('save_minutes')} min earlier)."
            )
        else:
            note = f"Try to reach {place_name} before it closes."
        # advisory: nothing structural changed — accepting must only resolve the alert, never
        # re-persist the (unchanged) trip, so this can't 500 on a leg/place re-write (dev20).
        return AdaptResponse(adapted=True, changes=[note], updated_trip=plan, advisory=True)

    if resolution not in ("skip", "push"):
        return AdaptResponse(adapted=False, changes=["Unknown closing-risk resolution"], updated_trip=plan)

    src_day = next((d for d in plan.days if place_id in _day_ordered(d)), None)
    if src_day is None:
        return AdaptResponse(adapted=False, changes=[f"{place_name} not found in trip"], updated_trip=plan)

    coord: dict[str, dict] = {p.id: {"lat": p.lat, "lng": p.lng} for p in plan.places}
    if "hotel" not in coord:
        hotel = _fetch_hotel(trip_id)
        if hotel:
            coord["hotel"] = hotel

    new_src_ordered = [pid for pid in _day_ordered(src_day) if pid != place_id]

    # ── skip: drop the at-risk place and re-stitch its day. ──
    if resolution == "skip":
        if sum(1 for p in plan.places if p.id != "hotel") - 1 < 2:
            return AdaptResponse(
                adapted=False,
                changes=[f"Cannot skip {place_name} — a trip needs at least 2 stops."],
                updated_trip=plan,
            )
        new_src = await _reroute_day_to_order(src_day, new_src_ordered, coord)
        new_days = [new_src if d.day == src_day.day else d for d in plan.days]
        new_places = [p for p in plan.places if p.id != place_id]
        updated = TripPlan(id=plan.id, days=new_days, places=new_places, warnings=plan.warnings)
        return AdaptResponse(
            adapted=True,
            changes=[f"Skipped {place_name} (would arrive after it closes)."],
            updated_trip=updated,
            **_compute_delta(plan, updated),
        )

    # ── push: move the place to target_day after a server-side close_days guard. ──
    if not target_day or target_day == src_day.day:
        return AdaptResponse(adapted=False, changes=["No valid target day for push"], updated_trip=plan)
    tgt_day = next((d for d in plan.days if d.day == target_day), None)
    if tgt_day is None:
        return AdaptResponse(adapted=False, changes=[f"Day {target_day} not found"], updated_trip=plan)

    place_dict = _curated_or_model(next(p for p in plan.places if p.id == place_id))
    weekday = (date.today() + timedelta(days=target_day - src_day.day)).strftime("%A")
    if weekday in (place_dict.get("close_days") or []):
        return AdaptResponse(
            adapted=False,
            changes=[f"Cannot move {place_name} to day {target_day} — it is closed on {weekday}."],
            updated_trip=plan,
        )

    tgt_ordered = _day_ordered(tgt_day)
    if tgt_ordered and tgt_ordered[-1] == "hotel":
        new_tgt_ordered = tgt_ordered[:-1] + [place_id, "hotel"]
    else:
        new_tgt_ordered = tgt_ordered + [place_id]

    new_src = await _reroute_day_to_order(src_day, new_src_ordered, coord)
    new_tgt = await _reroute_day_to_order(tgt_day, new_tgt_ordered, coord)
    new_days = [
        new_src if d.day == src_day.day else (new_tgt if d.day == target_day else d)
        for d in plan.days
    ]
    updated = TripPlan(id=plan.id, days=new_days, places=plan.places, warnings=plan.warnings)
    return AdaptResponse(
        adapted=True,
        changes=[f"Moved {place_name} to day {target_day}."],
        updated_trip=updated,
        **_compute_delta(plan, updated),
    )


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
    arrived_at_min: int | None = None,
    anchor_min: int | None = None,
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

    # start_date is shared by the weather (per-day forecast) and closing-risk (today-only) checks.
    start_date = None
    try:
        trip_row = supabase.table("trips").select("start_date").eq("id", trip_id).execute()
        if trip_row.data:
            start_date = trip_row.data[0].get("start_date")
    except Exception as exc:
        log.warning("Could not read start_date for trip %s: %s", trip_id, exc)

    # ── Weather check (per day) ───────────────────────────────────────────────
    if any(p.is_outdoor for p in plan.places):
        weather_checked = True
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

    # ── Closing-risk check (live trips only) ──────────────────────────────────
    # Runs only when the user is actively progressing through today's day.
    if active_day is not None:
        if _check_closing_risk(
            trip_id, plan, active_day, active_leg_index, datetime.now(tz=SGT),
            arrived_at_min, anchor_min, start_date,
        ):
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

    # route_legs: delete-then-insert so a resolution that REDUCES the leg count (e.g. a
    # closing_risk skip) doesn't leave orphaned legs behind. The plan always carries the
    # full leg set, so wiping first is equivalent to upsert for the swap/reroute paths.
    supabase.table("route_legs").delete().eq("trip_id", trip_id).execute()
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
