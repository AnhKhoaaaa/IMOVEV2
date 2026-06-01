import logging
import uuid

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_user
from app.models.preferences import UserPreferenceProfile, ContextSnapshot

from app.models.trip import (
    TripCreate, TripPlanRequest, TripPlan,
    LegUpdateRequest, LiveSwitchRequest, AdaptRequest, AdaptResponse, TripStatus, LocationUpdate,
    AddPlaceRequest, ReorderRequest, LegSwapResult, CheckAlertsRequest,
)
from app.agents import planning_agent, adaptation_agent
from app.agents.planning_agent import get_curated_place
from app.exceptions import PlaceDataMissingError, BudgetExceededError
from app.services.onemap import NoRouteError
from app.database import supabase

log = logging.getLogger(__name__)

router = APIRouter()

# In-memory fallback when Supabase is unavailable
_trip_store: dict[str, TripPlan] = {}
# Cache trip metadata (num_days, budget_sgd, session_id) for no-DB scenarios
_trip_meta: dict[str, dict] = {}
# Tentative adaptation proposals awaiting user accept (§6 User Consent Flow)
_pending_swaps: dict[str, dict] = {}  # trip_id → {alert_id, updated_trip}


@router.post("")
async def create_trip(body: TripCreate):
    trip_id = str(uuid.uuid4())

    # Cache for no-DB fallback path (budget, num_days, session_id, user_id)
    _trip_meta[trip_id] = {
        "num_days": body.num_days,
        "budget_sgd": float(body.budget_sgd),
        "session_id": body.session_id,
        "user_id": str(body.user_id) if body.user_id else None,
    }

    if supabase:
        supabase.table("trips").insert({
            "id": trip_id,
            "session_id": body.session_id,
            "user_id": str(body.user_id) if body.user_id else None,
            "num_days": body.num_days,
            "budget_sgd": float(body.budget_sgd),
            "status": "DRAFT",
            "start_date": body.start_date.isoformat() if body.start_date else None,
            "end_date": body.end_date.isoformat() if body.end_date else None,
        }).execute()

    return {"trip_id": trip_id}


@router.post("/{trip_id}/plan")
async def plan_trip(
    trip_id: str,
    body: TripPlanRequest,
    current_user: Optional[str] = Depends(get_current_user),
):
    num_days, budget_sgd = _get_trip_params(trip_id, body)

    # [PATCH 3] Fetch user preference profile — fallback to default nếu guest/new user
    effective_profile: UserPreferenceProfile = UserPreferenceProfile()
    if current_user and supabase:
        try:
            pref_resp = (
                supabase.table("user_preferences")
                .select("profile")
                .eq("user_id", current_user)
                .limit(1)
                .execute()
            )
            if pref_resp.data:
                effective_profile = UserPreferenceProfile(**pref_resp.data[0]["profile"])
        except Exception as exc:
            log.warning("Preferences fetch failed for %s (using defaults): %s", current_user, exc)

    # Build real-time context — weather fetch is optional, non-blocking
    rain_mm = 0.0
    try:
        from app.services import openweather
        weather = await openweather.get_current_weather()
        rain_mm = weather.get("rain_1h", 0.0)
    except Exception:
        pass   # non-fatal: use 0.0 when OpenWeather is unavailable
    effective_ctx = ContextSnapshot.now(rain_mm=rain_mm)

    try:
        result = await planning_agent.plan_trip(
            trip_id=trip_id,
            place_ids=body.place_ids,
            num_days=num_days,
            budget_sgd=budget_sgd,
            optimize_order=body.optimize_order,
            preferences=body.preferences,
            profile=effective_profile,
            context=effective_ctx,
        )
    except PlaceDataMissingError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except NoRouteError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except BudgetExceededError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Always cache in memory (authoritative for this session)
    _trip_store[trip_id] = result

    # Best-effort persist — planning already succeeded so don't fail the request
    if supabase:
        try:
            _persist_trip_plan(trip_id, result)
        except Exception as exc:
            log.warning("Supabase persist failed for trip %s: %s", trip_id, exc)

    return result


@router.get("/{trip_id}")
async def get_trip(trip_id: str, current_user: Optional[str] = Depends(get_current_user)):
    # Try in-memory cache first (covers session without Supabase)
    if trip_id in _trip_store:
        meta = _trip_meta.get(trip_id, {})
        trip_user_id = meta.get("user_id")
        if current_user and trip_user_id and trip_user_id != current_user:
            raise HTTPException(status_code=403, detail="Access denied")
        return _trip_store[trip_id]

    if supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            trip_resp = supabase.table("trips").select("*").eq("id", trip_id).execute()
            if trip_resp.data:
                t = trip_resp.data[0]
                trip_user_id = t.get("user_id")
                if current_user and trip_user_id and trip_user_id != current_user:
                    raise HTTPException(status_code=403, detail="Access denied")
                # Repopulate in-memory caches so subsequent mutations work after server restart
                _trip_store[trip_id] = plan
                if trip_id not in _trip_meta:
                    _trip_meta[trip_id] = {
                        "num_days": t.get("num_days", len(plan.days)),
                        "budget_sgd": float(t.get("budget_sgd") or 999.0),
                        "session_id": t.get("session_id"),
                        "user_id": trip_user_id,
                    }
            return plan

    raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")


@router.patch("/{trip_id}/legs/{leg_id}")
async def update_leg(trip_id: str, leg_id: str, body: LegUpdateRequest) -> LegSwapResult:
    """Real mode-switch: replaces duration/cost/geometry/sub_legs from pre-fetched alternatives.

    Returns LegSwapResult { updated_leg, trip_cost_sgd, warnings }.
    422 when requested mode has no available route.
    """
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    target_leg = None
    for day in plan.days:
        for leg in day.legs:
            if leg.id == leg_id:
                target_leg = leg
                break
        if target_leg:
            break

    if target_leg is None:
        raise HTTPException(status_code=404, detail=f"Leg '{leg_id}' not found")

    old_mode = target_leg.transport_mode

    try:
        result = await planning_agent.switch_leg_mode(
            new_mode=body.transport_mode,
            target_leg=target_leg,
            plan=plan,
        )
    except NoRouteError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Budget check — router has access to _trip_meta
    meta = _trip_meta.get(trip_id, {})
    budget = meta.get("budget_sgd")
    if budget is not None and result.trip_cost_sgd > budget:
        result.warnings.append(
            f"Estimated transit cost S${result.trip_cost_sgd:.2f} "
            f"exceeds your budget of S${budget:.2f}."
        )

    # Update in-memory plan
    _trip_store[trip_id] = _apply_leg_update(plan, leg_id, result.updated_leg)

    # Persist to Supabase with all updated fields (not just transport_mode)
    if supabase:
        leg = result.updated_leg
        supabase.table("route_legs").update({
            "transport_mode":   leg.transport_mode,
            "duration_minutes": leg.duration_minutes,
            "cost_sgd":         leg.cost_sgd,
            "is_estimated":     leg.is_estimated,
            "geometry":         leg.geometry,
            "instructions":     leg.instructions,
        }).eq("id", leg_id).execute()

        supabase.table("trip_feedback").insert({
            "trip_id":       trip_id,
            "leg_id":        leg_id,
            "feedback_type": "implicit",
            "comment":       f"Mode changed: {old_mode} → {leg.transport_mode}",
        }).execute()

    return result


@router.post("/{trip_id}/legs/{leg_id}/switch-now")
async def switch_leg_now(trip_id: str, leg_id: str, body: LiveSwitchRequest) -> LegSwapResult:
    """User-initiated live mode-switch using current GPS position.

    Differs from PATCH /legs/{id}:
    - Accepts GPS coords → agent decides fast path (cache) vs realtime (OneMap from GPS)
    - No alert_id required, no accept-swap flow — commits immediately
    - Returns routed_from_current_position=True when geometry originates from GPS
    """
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    target_leg = None
    for day in plan.days:
        for leg in day.legs:
            if leg.id == leg_id:
                target_leg = leg
                break
        if target_leg:
            break
    if target_leg is None:
        raise HTTPException(status_code=404, detail=f"Leg '{leg_id}' not found")

    old_mode = target_leg.transport_mode

    try:
        result = await planning_agent.switch_leg_mode_live(
            new_mode=body.new_mode,
            target_leg=target_leg,
            plan=plan,
            current_lat=body.current_lat,
            current_lng=body.current_lng,
        )
    except NoRouteError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # Budget check — same guard as PATCH /legs
    meta = _trip_meta.get(trip_id, {})
    budget = meta.get("budget_sgd")
    if budget is not None and result.trip_cost_sgd > budget:
        result.warnings.append(
            f"Estimated transit cost S${result.trip_cost_sgd:.2f} "
            f"exceeds your budget of S${budget:.2f}."
        )

    # Update in-memory plan
    _trip_store[trip_id] = _apply_leg_update(plan, leg_id, result.updated_leg)

    # Persist all updated fields to Supabase
    if supabase:
        leg = result.updated_leg
        supabase.table("route_legs").update({
            "transport_mode":   leg.transport_mode,
            "duration_minutes": leg.duration_minutes,
            "cost_sgd":         leg.cost_sgd,
            "is_estimated":     leg.is_estimated,
            "geometry":         leg.geometry,
            "instructions":     leg.instructions,
        }).eq("id", leg_id).execute()

        origin_note = "from GPS" if result.routed_from_current_position else "from place"
        supabase.table("trip_feedback").insert({
            "trip_id":       trip_id,
            "leg_id":        leg_id,
            "feedback_type": "implicit",
            "comment":       f"Live switch ({origin_note}): {old_mode} → {leg.transport_mode}",
        }).execute()

    return result


@router.post("/{trip_id}/adapt")
async def adapt_trip_endpoint(trip_id: str, body: AdaptRequest):
    # Verify session ownership before applying adaptation
    if supabase and not body.session_id:
        raise HTTPException(status_code=403, detail="session_id is required")
    if body.session_id:
        _verify_session_ownership(trip_id, body.session_id)

    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    result = await adaptation_agent.adapt_trip(trip_id, body.alert_id, plan)

    # Store proposal in memory — do NOT persist to DB until user calls /accept-swap (§6)
    if result.adapted:
        _pending_swaps[trip_id] = {
            "alert_id": body.alert_id,
            "updated_trip": result.updated_trip,
        }

    return result


@router.post("/{trip_id}/location", status_code=204)
async def update_location(trip_id: str, body: LocationUpdate):
    if body.session_id:
        _verify_session_ownership(trip_id, body.session_id)

    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)

    if plan:
        await adaptation_agent.check_lta_proximity(trip_id, body.lat, body.lng, plan)


@router.post("/{trip_id}/optimize")
async def optimize_trip(trip_id: str, current_user: Optional[str] = Depends(get_current_user)):
    """Re-run greedy sort + smart distribution on the current place list."""
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    _verify_user_ownership(trip_id, current_user)

    meta = _trip_meta.get(trip_id, {})
    num_days = meta.get("num_days", len(plan.days))
    budget_sgd = meta.get("budget_sgd", 999.0)

    profile, context = await _fetch_plan_context(current_user)

    try:
        result = await planning_agent.plan_trip(
            trip_id=trip_id,
            place_ids=[p.id for p in plan.places],
            num_days=num_days,
            budget_sgd=budget_sgd,
            optimize_order=True,
            preferences=None,
            profile=profile,
            context=context,
        )
    except (PlaceDataMissingError, NoRouteError, BudgetExceededError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    _trip_store[trip_id] = result
    if supabase:
        try:
            _persist_trip_plan(trip_id, result)
        except Exception as exc:
            log.warning("Supabase persist failed for trip %s optimize: %s", trip_id, exc)

    return result


@router.post("/{trip_id}/days", status_code=200)
async def add_day(trip_id: str, current_user: Optional[str] = Depends(get_current_user)):
    """Increment num_days by 1. Appends a new empty day to the plan."""
    meta = _trip_meta.get(trip_id)
    # Repopulate meta from DB if missing (e.g. after server restart)
    if meta is None and supabase:
        trip_resp = supabase.table("trips").select("*").eq("id", trip_id).execute()
        if trip_resp.data:
            t = trip_resp.data[0]
            meta = {
                "num_days": t["num_days"],
                "budget_sgd": float(t.get("budget_sgd") or 999.0),
                "session_id": t.get("session_id"),
                "user_id": t.get("user_id"),
            }
            _trip_meta[trip_id] = meta
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")
    _verify_user_ownership(trip_id, current_user)
    meta["num_days"] += 1
    if supabase:
        try:
            supabase.table("trips").update({"num_days": meta["num_days"]}).eq("id", trip_id).execute()
        except Exception as exc:
            log.warning("Supabase update num_days failed for %s: %s", trip_id, exc)

    # Load plan and append the new empty day
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    from app.models.trip import DayPlan as DayPlanModel
    new_day = DayPlanModel(day=meta["num_days"], legs=[])
    updated_plan = plan.model_copy(update={"days": list(plan.days) + [new_day]})
    _trip_store[trip_id] = updated_plan
    return updated_plan


@router.delete("/{trip_id}/days/{day_num}", status_code=200)
async def remove_day(trip_id: str, day_num: int, current_user: Optional[str] = Depends(get_current_user)):
    """Remove a day: re-plan with num_days-1, keeping all places."""
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")
    _verify_user_ownership(trip_id, current_user)

    meta = _trip_meta.get(trip_id, {})
    current_num_days = meta.get("num_days", len(plan.days))
    if current_num_days <= 1:
        raise HTTPException(status_code=422, detail="Trip must have at least 1 day")

    new_num_days = current_num_days - 1
    meta["num_days"] = new_num_days
    _trip_meta[trip_id] = meta

    profile, context = await _fetch_plan_context(current_user)

    try:
        result = await planning_agent.plan_trip(
            trip_id=trip_id,
            place_ids=[p.id for p in plan.places],
            num_days=new_num_days,
            budget_sgd=meta.get("budget_sgd", 999.0),
            optimize_order=False,
            preferences=None,
            profile=profile,
            context=context,
        )
    except (PlaceDataMissingError, NoRouteError, BudgetExceededError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    _trip_store[trip_id] = result
    if supabase:
        try:
            supabase.table("trips").update({"num_days": new_num_days}).eq("id", trip_id).execute()
            _persist_trip_plan(trip_id, result)
        except Exception as exc:
            log.warning("Supabase update failed for %s remove_day: %s", trip_id, exc)
    return result


@router.delete("/{trip_id}/places/{place_id}", status_code=204)
async def remove_place(trip_id: str, place_id: str, current_user: Optional[str] = Depends(get_current_user)):
    """Remove a place from the trip and re-fetch legs for affected days."""
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    _verify_user_ownership(trip_id, current_user)

    if not any(p.id == place_id for p in plan.places):
        raise HTTPException(status_code=404, detail=f"Place '{place_id}' not in trip")

    # Re-plan with place removed
    remaining_ids = [p.id for p in plan.places if p.id != place_id]
    if len(remaining_ids) < 2:
        raise HTTPException(status_code=422, detail="Trip must have at least 2 places")

    meta = _trip_meta.get(trip_id, {})
    profile, context = await _fetch_plan_context(current_user)

    try:
        result = await planning_agent.plan_trip(
            trip_id=trip_id,
            place_ids=remaining_ids,
            num_days=meta.get("num_days", len(plan.days)),
            budget_sgd=meta.get("budget_sgd", 999.0),
            optimize_order=False,
            preferences=None,
            profile=profile,
            context=context,
        )
    except (PlaceDataMissingError, NoRouteError, BudgetExceededError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    _trip_store[trip_id] = result
    if supabase:
        try:
            _persist_trip_plan(trip_id, result)
        except Exception as exc:
            log.warning("Supabase persist failed for trip %s remove_place: %s", trip_id, exc)


@router.post("/{trip_id}/places")
async def add_place(trip_id: str, body: AddPlaceRequest, current_user: Optional[str] = Depends(get_current_user)):
    """Add a place to a specific day and re-fetch affected legs."""
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    _verify_user_ownership(trip_id, current_user)

    meta = _trip_meta.get(trip_id, {})
    num_days = meta.get("num_days", len(plan.days))

    # P5-BUG-3: validate day is within trip range before any further checks
    if body.day > num_days:
        raise HTTPException(
            status_code=422,
            detail=f"day {body.day} out of range — trip has {num_days} day(s)",
        )

    from app.agents.planning_agent import get_curated_place
    if not get_curated_place(body.place_id):
        raise HTTPException(status_code=422, detail=f"Place '{body.place_id}' not in curated dataset")

    # Map day number → ordered place ids (legs-based reconstruction)
    days_map: dict[int, list[str]] = {}
    for d in plan.days:
        days_map[d.day] = _ordered_place_ids(d.legs, plan.places)

    target_day = body.day
    if target_day not in days_map:
        days_map[target_day] = []
    days_map[target_day].append(body.place_id)

    # Flatten to ordered place list; preserve single-place days not captured by legs
    all_ids: list[str] = []
    for day_num in sorted(days_map.keys()):
        for pid in days_map[day_num]:
            if pid not in all_ids:
                all_ids.append(pid)
    # P5-BUG-2b: add any places that were in single-place days (no legs → not in days_map)
    for p in plan.places:
        if p.id not in all_ids:
            all_ids.append(p.id)
    if body.place_id not in all_ids:
        all_ids.append(body.place_id)

    profile, context = await _fetch_plan_context(current_user)

    try:
        result = await planning_agent.plan_trip(
            trip_id=trip_id,
            place_ids=all_ids,
            num_days=num_days,
            budget_sgd=meta.get("budget_sgd", 999.0),
            optimize_order=False,
            preferences=None,
            profile=profile,
            context=context,
        )
    except (PlaceDataMissingError, NoRouteError, BudgetExceededError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    _trip_store[trip_id] = result
    if supabase:
        try:
            _persist_trip_plan(trip_id, result)
        except Exception as exc:
            log.warning("Supabase persist failed for trip %s add_place: %s", trip_id, exc)
    return result


@router.patch("/{trip_id}/reorder")
async def reorder_places(trip_id: str, body: ReorderRequest, current_user: Optional[str] = Depends(get_current_user)):
    """Reorder places within a day and re-fetch legs for that day."""
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    _verify_user_ownership(trip_id, current_user)

    meta = _trip_meta.get(trip_id, {})
    num_days = meta.get("num_days", len(plan.days))

    # Rebuild place list: replace target day's order, keep other days unchanged
    days_map: dict[int, list[str]] = {}
    for d in plan.days:
        days_map[d.day] = _ordered_place_ids(d.legs, plan.places)

    # P5-BUG-4: validate provided place_ids exactly match the current day's places
    current_day_ids = set(days_map.get(body.day, []))
    provided_ids = set(body.place_ids)
    if provided_ids != current_day_ids:
        raise HTTPException(
            status_code=422,
            detail=f"place_ids must exactly match the places in day {body.day} — "
                   f"expected {sorted(current_day_ids)}, got {sorted(provided_ids)}",
        )

    days_map[body.day] = list(body.place_ids)

    all_ids: list[str] = []
    for day_num in sorted(days_map.keys()):
        for pid in days_map[day_num]:
            if pid not in all_ids:
                all_ids.append(pid)
    # P5-BUG-2b: preserve single-place days not captured by legs
    for p in plan.places:
        if p.id not in all_ids:
            all_ids.append(p.id)

    profile, context = await _fetch_plan_context(current_user)

    try:
        result = await planning_agent.plan_trip(
            trip_id=trip_id,
            place_ids=all_ids,
            num_days=num_days,
            budget_sgd=meta.get("budget_sgd", 999.0),
            optimize_order=False,
            preferences=None,
            profile=profile,
            context=context,
        )
    except (PlaceDataMissingError, NoRouteError, BudgetExceededError) as e:
        raise HTTPException(status_code=422, detail=str(e))

    _trip_store[trip_id] = result
    if supabase:
        try:
            _persist_trip_plan(trip_id, result)
        except Exception as exc:
            log.warning("Supabase persist failed for trip %s reorder: %s", trip_id, exc)
    return result


@router.delete("/{trip_id}", status_code=204)
async def delete_trip(trip_id: str):
    _trip_store.pop(trip_id, None)
    _trip_meta.pop(trip_id, None)
    _pending_swaps.pop(trip_id, None)

    if supabase:
        try:
            supabase.table("route_legs").delete().eq("trip_id", trip_id).execute()
            supabase.table("trip_places").delete().eq("trip_id", trip_id).execute()
            supabase.table("trips").delete().eq("id", trip_id).execute()
        except Exception as exc:
            log.warning("Supabase delete failed for trip %s: %s", trip_id, exc)


@router.post("/{trip_id}/accept-swap")
async def accept_swap(trip_id: str, body: AdaptRequest):
    if body.session_id:
        _verify_session_ownership(trip_id, body.session_id)

    pending = _pending_swaps.get(trip_id)
    if not pending:
        raise HTTPException(status_code=404, detail="No pending adaptation found for this trip")
    if pending["alert_id"] != body.alert_id:
        raise HTTPException(status_code=409, detail="alert_id does not match pending adaptation")

    updated_trip: TripPlan = pending["updated_trip"]
    await adaptation_agent.commit_adaptation(trip_id, updated_trip, body.alert_id)
    _trip_store[trip_id] = updated_trip
    del _pending_swaps[trip_id]

    return updated_trip


@router.post("/{trip_id}/check-alerts")
async def check_trip_alerts(trip_id: str, body: CheckAlertsRequest):
    """Demand-triggered alert check for UPCOMING trips.

    Called by the frontend when a user opens a trip scheduled for tomorrow.
    Runs LTA train + weather checks and inserts into lta_alerts.
    The frontend receives new alerts via the existing Supabase Realtime WebSocket
    (useAlerts.js) — no polling required.

    Returns {"lta_checked": bool, "weather_checked": bool, "alerts_inserted": int}.
    """
    if body.session_id:
        _verify_session_ownership(trip_id, body.session_id)

    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    result = await adaptation_agent.check_alerts_for_trip(trip_id, plan)
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _fetch_plan_context(
    current_user: Optional[str],
) -> tuple[UserPreferenceProfile, ContextSnapshot]:
    """Shared helper for all re-plan operations: fetch user preferences + real-time weather.

    Always returns a valid (profile, context) pair — Supabase failures and
    OpenWeather failures are both non-fatal and fall back to safe defaults.
    """
    profile = UserPreferenceProfile()
    if current_user and supabase:
        try:
            pref_resp = (
                supabase.table("user_preferences")
                .select("profile")
                .eq("user_id", current_user)
                .limit(1)
                .execute()
            )
            if pref_resp.data:
                profile = UserPreferenceProfile(**pref_resp.data[0]["profile"])
        except Exception as exc:
            log.warning("Preferences fetch failed for %s (using defaults): %s", current_user, exc)

    rain_mm = 0.0
    try:
        from app.services import openweather
        weather = await openweather.get_current_weather()
        rain_mm = weather.get("rain_1h", 0.0)
    except Exception:
        pass

    return profile, ContextSnapshot.now(rain_mm=rain_mm)


def _get_trip_params(trip_id: str, body: TripPlanRequest) -> tuple[int, float]:
    """Return (num_days, budget_sgd) — prefers DB, falls back to meta cache."""
    budget_override = (
        float(body.preferences["budget_sgd"])
        if body.preferences and "budget_sgd" in body.preferences
        else None
    )
    if supabase:
        resp = supabase.table("trips").select("num_days,budget_sgd").eq("id", trip_id).execute()
        if resp.data:
            row = resp.data[0]
            return row["num_days"], budget_override if budget_override is not None else float(row["budget_sgd"])

    # Fallback: use in-process cache populated by POST /trips
    meta = _trip_meta.get(trip_id)
    if meta:
        return meta["num_days"], budget_override if budget_override is not None else meta["budget_sgd"]

    if budget_override is None:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Trip '{trip_id}' not found in database or local cache. "
                "Provide budget_sgd in preferences or recreate the trip."
            ),
        )
    return 1, budget_override


def _verify_user_ownership(trip_id: str, current_user: Optional[str]) -> None:
    """Raise 403 if an authenticated user doesn't own this trip."""
    if current_user is None:
        return  # unauthenticated / guest — allow
    meta = _trip_meta.get(trip_id)
    if meta:
        trip_user_id = meta.get("user_id")
        if trip_user_id and trip_user_id != current_user:
            raise HTTPException(status_code=403, detail="Access denied")
        return
    if supabase:
        resp = supabase.table("trips").select("user_id").eq("id", trip_id).execute()
        if resp.data:
            trip_user_id = resp.data[0].get("user_id")
            if trip_user_id and trip_user_id != current_user:
                raise HTTPException(status_code=403, detail="Access denied")


def _verify_session_ownership(trip_id: str, session_id: str) -> None:
    """Raise 403 if session_id doesn't match the stored trip owner."""
    # Check in-process cache first (fast path)
    meta = _trip_meta.get(trip_id)
    if meta and meta["session_id"] != session_id:
        raise HTTPException(status_code=403, detail="session_id does not match trip owner")
    if meta:
        return

    # Verify against DB when not cached locally
    if supabase is None:
        raise HTTPException(status_code=503, detail="Cannot verify ownership: database unavailable")

    resp = supabase.table("trips").select("session_id").eq("id", trip_id).execute()
    if not resp.data:
        raise HTTPException(status_code=404, detail="Trip not found")
    if resp.data[0]["session_id"] != session_id:
        raise HTTPException(status_code=403, detail="session_id does not match trip owner")


def _persist_trip_plan(trip_id: str, plan: TripPlan) -> None:
    """Batch-write trip_places and route_legs to Supabase (2 round-trips total)."""
    place_rows = [
        {
            "trip_id": trip_id,
            "place_id": p.id,
            "place_name": p.name,
            "lat": p.lat,
            "lng": p.lng,
            "dwell_minutes": p.dwell_minutes,
        }
        for p in plan.places
    ]
    if place_rows:
        supabase.table("trip_places").upsert(place_rows).execute()

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
            "instructions": leg.instructions,
            "geometry": leg.geometry,
        }
        for day in plan.days
        for leg in day.legs
    ]
    if leg_rows:
        supabase.table("route_legs").upsert(leg_rows).execute()


def _ordered_place_ids(legs: list, places) -> list[str]:
    """Reconstruct ordered place ids for a day from its legs.

    Returns [] when legs is empty — callers must preserve single-place days
    separately using plan.places.
    """
    if not legs:
        return []
    ids: list[str] = []
    for leg in legs:
        if leg.from_place_id not in ids:
            ids.append(leg.from_place_id)
    if legs[-1].to_place_id not in ids:
        ids.append(legs[-1].to_place_id)
    return ids


def _apply_leg_update(plan: TripPlan, leg_id: str, updated_leg) -> TripPlan:
    """Return a new TripPlan with the named leg replaced in all days."""
    new_days = []
    for day in plan.days:
        new_legs = [updated_leg if leg.id == leg_id else leg for leg in day.legs]
        new_days.append(day.model_copy(update={"legs": new_legs}))
    return plan.model_copy(update={"days": new_days})


def _fetch_trip_from_db(trip_id: str):
    """Reconstruct TripPlan from Supabase tables. Returns None if not found."""
    trip_resp = supabase.table("trips").select("*").eq("id", trip_id).execute()
    if not trip_resp.data:
        return None

    places_resp = supabase.table("trip_places").select("*").eq("trip_id", trip_id).execute()
    legs_resp = supabase.table("route_legs").select("*").eq("trip_id", trip_id).order("day_number").execute()

    from app.models.place import Place
    from app.models.trip import LegResponse, DayPlan, TripPlan

    places = []
    for p in places_resp.data:
        # Look up full metadata from curated dataset; fall back to DB values if place
        # was removed from the dataset after the trip was created.
        curated = get_curated_place(p["place_id"]) or {}
        places.append(Place(
            id=p["place_id"],
            name=p["place_name"],
            lat=p["lat"],
            lng=p["lng"],
            dwell_minutes=curated.get("dwell_minutes", p.get("dwell_minutes", 60)),
            best_time_start=curated.get("best_time_start", "00:00"),
            best_time_end=curated.get("best_time_end", "23:59"),
            opening_hours=curated.get("opening_hours"),
            category=curated.get("category", ""),
            is_outdoor=curated.get("is_outdoor", False),
            in_curated_dataset=bool(curated),
            image_url=curated.get("image_url"),
        ))

    # Coerce legacy DB values ("MRT", "LRT") to current TransportMode labels
    _LEGACY_MODE: dict[str, str] = {"MRT": "METRO", "LRT": "METRO"}

    days_map: dict[int, list] = {}
    for leg in legs_resp.data:
        d = leg["day_number"]
        raw_mode = leg["transport_mode"]
        transport_mode = _LEGACY_MODE.get(raw_mode, raw_mode)
        days_map.setdefault(d, []).append(LegResponse(
            id=leg["id"],
            from_place_id=leg["from_place_id"],
            to_place_id=leg["to_place_id"],
            transport_mode=transport_mode,
            duration_minutes=leg["duration_minutes"],
            cost_sgd=float(leg["cost_sgd"]),
            is_estimated=leg["is_estimated"],
            instructions=leg.get("instructions") or [],
            geometry=leg.get("geometry"),
        ))

    days = [DayPlan(day=d, legs=legs) for d, legs in sorted(days_map.items())]
    return TripPlan(id=trip_id, days=days, places=places, warnings=[])
