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
from app.agents.planning_agent import get_all_places, _haversine_km, _primary_mode
from app.models.trip import TripPlan, DayPlan, LegResponse, AdaptResponse
from app.models.place import Place
from app.database import supabase

log = logging.getLogger(__name__)

_WEATHER_RAIN_THRESHOLD = 70  # % — alert if rain_probability exceeds this

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
    """[CODE] Check OpenWeather per-trip; insert weather_warning if rain > 70% and trip has outdoor places."""
    if not supabase:
        return

    today = date.today().isoformat()

    trips_resp = supabase.table("trips").select("id").eq("status", "HAPPENING_TODAY").execute()
    active_ids = [t["id"] for t in (trips_resp.data or [])]
    if not active_ids:
        return

    # Bulk query all trip_places in one round-trip — avoids N+1 per trip
    all_places_resp = (
        supabase.table("trip_places")
        .select("trip_id,place_id")
        .in_("trip_id", active_ids)
        .execute()
    )
    places_by_trip: dict[str, list[str]] = {}
    for row in (all_places_resp.data or []):
        places_by_trip.setdefault(row["trip_id"], []).append(row["place_id"])

    _places = get_all_places()

    for trip_id in active_ids:
        place_ids = places_by_trip.get(trip_id, [])
        outdoor_places = [_places[pid] for pid in place_ids if pid in _places and _places[pid]["is_outdoor"]]
        if not outdoor_places:
            continue

        # Localized forecast at this itinerary's centroid (§3.1 Weather Engine)
        centroid = _compute_centroid(place_ids)
        clat, clng = centroid if centroid else (SINGAPORE_LAT, SINGAPORE_LNG)

        try:
            forecast = await openweather.get_forecast(today, clat, clng)
        except WeatherUnavailableError as exc:
            log.warning("OpenWeather unavailable for trip %s: %s", trip_id, exc)
            continue  # Soft failure per trip — do not crash the loop

        if forecast["rain_probability"] <= _WEATHER_RAIN_THRESHOLD:
            continue

        already_suggested: set[str] = {p["id"] for p in outdoor_places}
        suggestions = []
        for place in outdoor_places:
            indoor_alt = _nearest_indoor(place["lat"], place["lng"], exclude_ids=already_suggested)
            if indoor_alt:
                suggestions.append(f"{place['name']} → {indoor_alt['name']}")
                already_suggested.add(indoor_alt["id"])

        if not suggestions:
            continue

        # Dedup: skip if same alert type was inserted in the last 10 minutes
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        existing = (
            supabase.table("lta_alerts")
            .select("id")
            .eq("trip_id", trip_id)
            .eq("alert_type", "weather_warning")
            .gte("created_at", cutoff)
            .execute()
        )
        if existing.data:
            continue

        supabase.table("lta_alerts").insert({
            "trip_id": trip_id,
            "alert_type": "weather_warning",
            "affected_line": None,
            "message": (
                f"Rain forecast ({forecast['rain_probability']}%). "
                f"Suggested indoor swaps: {'; '.join(suggestions)}"
            ),
        }).execute()


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

    if alert_type == "weather_warning":
        updated_plan, changes = await _apply_weather_swap(current_plan)
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


def _compute_centroid(place_ids: list[str]) -> tuple[float, float] | None:
    """Return mean (lat, lng) for a list of place IDs. Returns None if no known coords."""
    _places = get_all_places()
    coords = [(p["lat"], p["lng"]) for pid in place_ids if (p := _places.get(pid))]
    if not coords:
        return None
    return sum(lat for lat, _ in coords) / len(coords), sum(lng for _, lng in coords) / len(coords)


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


async def _apply_weather_swap(plan: TripPlan) -> tuple[TripPlan, list[str]]:
    """Replace outdoor places with nearest indoor alternatives."""
    swap_map: dict[str, dict] = {}  # old_place_id → new_place_dict
    # Seed with ALL place IDs already in the plan (indoor + outdoor).
    # This prevents two outdoor places from swapping to the same indoor target
    # (Bug #1) and prevents suggesting a place the user already visits (Bug #2).
    already_used: set[str] = {p.id for p in plan.places}
    for place in plan.places:
        if place.is_outdoor:
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
        new_days.append(DayPlan(day=day.day, legs=new_legs))

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

        new_days.append(DayPlan(day=day.day, legs=new_legs))

    return TripPlan(id=plan.id, days=new_days, places=plan.places, warnings=warnings), changes


async def _recalculate_leg(
    original: LegResponse,
    from_p: dict | None,
    to_p: dict | None,
    new_from_id: str,
    new_to_id: str,
) -> LegResponse:
    """Call OneMap for a swapped leg; fall back to original data with is_estimated=True."""
    if from_p and to_p:
        try:
            route = await onemap.get_route(from_p["lat"], from_p["lng"], to_p["lat"], to_p["lng"], mode="pt")
            new_mode = _primary_mode(route.get("legs", []))
            sub_legs_data: list[dict] = route.get("sub_legs", [])
            return LegResponse(
                id=original.id,
                from_place_id=new_from_id,
                to_place_id=new_to_id,
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
    )


async def check_alerts_for_trip(trip_id: str, plan: TripPlan) -> dict:
    """On-demand alert check for a specific trip (demand-triggered, UPCOMING trips).

    Runs both LTA train check and weather check using the same dedup logic as
    the scheduled poll jobs. Inserts into lta_alerts; frontend receives new rows
    via the existing Supabase Realtime WebSocket in useAlerts.js.

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

    # ── Weather check ─────────────────────────────────────────────────────────
    place_ids = [p.id for p in plan.places]
    outdoor_places = [p for p in plan.places if p.is_outdoor]
    if outdoor_places:
        weather_checked = True
        centroid = _compute_centroid(place_ids)
        clat, clng = centroid if centroid else (SINGAPORE_LAT, SINGAPORE_LNG)
        today = date.today().isoformat()

        try:
            forecast = await openweather.get_forecast(today, clat, clng)
        except WeatherUnavailableError as exc:
            log.warning("OpenWeather unavailable for on-demand check trip %s: %s", trip_id, exc)
            forecast = None

        if forecast and forecast["rain_probability"] > _WEATHER_RAIN_THRESHOLD:
            already_suggested: set[str] = {p.id for p in outdoor_places}
            suggestions = []
            for place in outdoor_places:
                indoor_alt = _nearest_indoor(place.lat, place.lng, exclude_ids=already_suggested)
                if indoor_alt:
                    suggestions.append(f"{place.name} → {indoor_alt['name']}")
                    already_suggested.add(indoor_alt["id"])

            if suggestions:
                existing = (
                    supabase.table("lta_alerts")
                    .select("id")
                    .eq("trip_id", trip_id)
                    .eq("alert_type", "weather_warning")
                    .gte("created_at", cutoff)
                    .execute()
                )
                if not existing.data:
                    supabase.table("lta_alerts").insert({
                        "trip_id": trip_id,
                        "alert_type": "weather_warning",
                        "affected_line": None,
                        "message": (
                            f"Rain forecast ({forecast['rain_probability']}%). "
                            f"Suggested indoor swaps: {'; '.join(suggestions)}"
                        ),
                    }).execute()
                    alerts_inserted += 1

    return {"lta_checked": lta_checked, "weather_checked": weather_checked, "alerts_inserted": alerts_inserted}


def _persist_updated_legs(trip_id: str, plan: TripPlan) -> None:
    """Batch-update route_legs in Supabase after adaptation."""
    if not supabase:
        return
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
        }
        for day in plan.days
        for leg in day.legs
    ]
    if leg_rows:
        supabase.table("route_legs").upsert(leg_rows).execute()
