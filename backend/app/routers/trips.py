import logging
import uuid

from fastapi import APIRouter, HTTPException

from app.models.trip import (
    TripCreate, TripPlanRequest, TripPlan,
    LegUpdateRequest, AdaptRequest, AdaptResponse,
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


@router.post("")
async def create_trip(body: TripCreate):
    trip_id = str(uuid.uuid4())

    # Cache for no-DB fallback path (budget, num_days, session_id)
    _trip_meta[trip_id] = {
        "num_days": body.num_days,
        "budget_sgd": float(body.budget_sgd),
        "session_id": body.session_id,
    }

    if supabase:
        supabase.table("trips").insert({
            "id": trip_id,
            "session_id": body.session_id,
            "user_id": str(body.user_id) if body.user_id else None,
            "num_days": body.num_days,
            "budget_sgd": float(body.budget_sgd),
            "status": "planning",
        }).execute()

    return {"trip_id": trip_id}


@router.post("/{trip_id}/plan")
async def plan_trip(trip_id: str, body: TripPlanRequest):
    num_days, budget_sgd = _get_trip_params(trip_id, body)
    try:
        result = await planning_agent.plan_trip(
            trip_id=trip_id,
            place_ids=body.place_ids,
            num_days=num_days,
            budget_sgd=budget_sgd,
            optimize_order=body.optimize_order,
            preferences=body.preferences,
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
async def get_trip(trip_id: str):
    # Try in-memory cache first (covers session without Supabase)
    if trip_id in _trip_store:
        return _trip_store[trip_id]

    if supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            return plan

    raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")


@router.patch("/{trip_id}/legs/{leg_id}")
async def update_leg(trip_id: str, leg_id: str, body: LegUpdateRequest):
    # Find leg in memory store
    plan = _trip_store.get(trip_id)
    if plan is None and supabase:
        plan = _fetch_trip_from_db(trip_id)
        if plan:
            _trip_store[trip_id] = plan  # cache so future mutations stay consistent
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Trip '{trip_id}' not found")

    target_leg = None
    found = False
    for day in plan.days:
        for leg in day.legs:
            if leg.id == leg_id:
                target_leg = leg
                found = True
                break
        if found:
            break

    if target_leg is None:
        raise HTTPException(status_code=404, detail=f"Leg '{leg_id}' not found")

    old_mode = target_leg.transport_mode
    updated_leg = target_leg.model_copy(update={
        "transport_mode": body.transport_mode,
    })
    for day in plan.days:
        for i, leg in enumerate(day.legs):
            if leg.id == leg_id:
                day.legs[i] = updated_leg
                break

    if supabase:
        supabase.table("route_legs").update(
            {"transport_mode": body.transport_mode}
        ).eq("id", leg_id).execute()

        # Log implicit feedback for Memory Agent
        supabase.table("trip_feedback").insert({
            "trip_id": trip_id,
            "leg_id": leg_id,
            "feedback_type": "implicit",
            "comment": f"Mode changed: {old_mode} → {updated_leg.transport_mode}",
        }).execute()

    return updated_leg


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

    if result.adapted:
        _trip_store[trip_id] = result.updated_trip

    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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
        }
        for day in plan.days
        for leg in day.legs
    ]
    if leg_rows:
        supabase.table("route_legs").upsert(leg_rows).execute()


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
            category=curated.get("category", ""),
            is_outdoor=curated.get("is_outdoor", False),
            in_curated_dataset=bool(curated),
        ))

    days_map: dict[int, list] = {}
    for leg in legs_resp.data:
        d = leg["day_number"]
        days_map.setdefault(d, []).append(LegResponse(
            id=leg["id"],
            from_place_id=leg["from_place_id"],
            to_place_id=leg["to_place_id"],
            transport_mode=leg["transport_mode"],
            duration_minutes=leg["duration_minutes"],
            cost_sgd=float(leg["cost_sgd"]),
            is_estimated=leg["is_estimated"],
        ))

    days = [DayPlan(day=d, legs=legs) for d, legs in sorted(days_map.items())]
    return TripPlan(id=trip_id, days=days, places=places, warnings=[])
