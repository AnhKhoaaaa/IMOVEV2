"""
Adaptation Agent — 100% rule-based code, no LLM.
- Automatic: poll_lta_alerts() every 2 min, poll_weather_alerts() every 30 min (APScheduler).
- Manual:    adapt_trip() called by POST /trips/{id}/adapt router.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

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

        suggestions = []
        for place in outdoor_places:
            indoor_alt = _nearest_indoor(place["lat"], place["lng"], exclude_id=place["id"])
            if indoor_alt:
                suggestions.append(f"{place['name']} → {indoor_alt['name']}")

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
        updated_plan, changes = await _reroute_mrt_legs(current_plan)
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


def _nearest_indoor(lat: float, lng: float, exclude_id: str) -> dict | None:
    """Find nearest indoor place within 5 km from the curated places dataset."""
    candidates = [
        p for p in get_all_places().values()
        if not p["is_outdoor"] and p["id"] != exclude_id
        and _haversine_km(lat, lng, p["lat"], p["lng"]) < 5.0
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda p: _haversine_km(lat, lng, p["lat"], p["lng"]))


async def _apply_weather_swap(plan: TripPlan) -> tuple[TripPlan, list[str]]:
    """Replace outdoor places with nearest indoor alternatives."""
    swap_map: dict[str, dict] = {}  # old_place_id → new_place_dict
    for place in plan.places:
        if place.is_outdoor:
            alt = _nearest_indoor(place.lat, place.lng, exclude_id=place.id)
            if alt:
                swap_map[place.id] = alt

    if not swap_map:
        return plan, []

    changes = [
        f"{plan.places[i].name} → {swap_map[p.id]['name']} (rain forecast)"
        for i, p in enumerate(plan.places)
        if p.id in swap_map
    ]

    # Rebuild places with swaps
    new_places_raw = [swap_map.get(p.id, None) or {"id": p.id, "name": p.name, "lat": p.lat, "lng": p.lng,
                                                     "dwell_minutes": p.dwell_minutes, "best_time_start": p.best_time_start,
                                                     "best_time_end": p.best_time_end, "category": p.category,
                                                     "is_outdoor": p.is_outdoor} for p in plan.places]

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


async def _reroute_mrt_legs(plan: TripPlan) -> tuple[TripPlan, list[str]]:
    """Recalculate MRT legs via OneMap PT (which may now route via bus)."""
    changes = []
    new_days = []
    place_map = {p.id: p for p in plan.places}

    for day in plan.days:
        new_legs = []
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
                route = await onemap.get_route(from_p.lat, from_p.lng, to_p.lat, to_p.lng, mode="pt")
                new_mode = _primary_mode(route.get("legs", []))
                new_leg = LegResponse(
                    id=leg.id,
                    from_place_id=leg.from_place_id,
                    to_place_id=leg.to_place_id,
                    transport_mode=new_mode,
                    duration_minutes=route["duration_minutes"],
                    cost_sgd=route["fare_sgd"],
                    is_estimated=False,
                )
                if new_mode != "METRO":
                    changes.append(f"Leg {leg.from_place_id} → {leg.to_place_id}: METRO → {new_mode} (disruption)")
                new_legs.append(new_leg)
            except NoRouteError as exc:
                log.warning("No route for leg %s → %s: %s", leg.from_place_id, leg.to_place_id, exc)
                new_legs.append(leg)
            except Exception as exc:
                log.error("Unexpected error rerouting leg %s → %s: %s", leg.from_place_id, leg.to_place_id, exc)
                new_legs.append(leg)

        new_days.append(DayPlan(day=day.day, legs=new_legs))

    return TripPlan(id=plan.id, days=new_days, places=plan.places, warnings=plan.warnings), changes


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
            return LegResponse(
                id=original.id,
                from_place_id=new_from_id,
                to_place_id=new_to_id,
                transport_mode=_primary_mode(route.get("legs", [])),
                duration_minutes=route["duration_minutes"],
                cost_sgd=route["fare_sgd"],
                is_estimated=False,
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
