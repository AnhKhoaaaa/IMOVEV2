from fastapi import APIRouter
from app.models.trip import TripCreate, TripPlanRequest

router = APIRouter()

@router.post("")
async def create_trip(body: TripCreate):
    # TODO: insert trip into Supabase (guest or auth)
    raise NotImplementedError

@router.post("/{trip_id}/plan")
async def plan_trip(trip_id: str, body: TripPlanRequest):
    # TODO: call planning_agent, persist route_legs
    raise NotImplementedError

@router.get("/{trip_id}")
async def get_trip(trip_id: str):
    # TODO: fetch trip + route_legs from Supabase
    raise NotImplementedError

@router.patch("/{trip_id}/legs/{leg_id}")
async def update_leg(trip_id: str, leg_id: str):
    # TODO: user edits a single route leg
    raise NotImplementedError

@router.post("/{trip_id}/adapt")
async def adapt_trip(trip_id: str):
    # TODO: call adaptation_agent with user-provided reason or weather context
    raise NotImplementedError
