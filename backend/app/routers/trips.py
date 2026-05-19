from fastapi import APIRouter
from fastapi.responses import JSONResponse
from app.models.trip import TripCreate, TripPlanRequest

router = APIRouter()

_NOT_IMPL = JSONResponse(
    status_code=501,
    content={"detail": "Agent chưa được triển khai — Dev 2 đang phát triển tính năng này."},
)


@router.post("")
async def create_trip(body: TripCreate):
    # TODO: insert trip into Supabase (guest or auth)
    return _NOT_IMPL


@router.post("/{trip_id}/plan")
async def plan_trip(trip_id: str, body: TripPlanRequest):
    # TODO: call planning_agent, persist route_legs
    return _NOT_IMPL


@router.get("/{trip_id}")
async def get_trip(trip_id: str):
    # TODO: fetch trip + route_legs from Supabase
    return _NOT_IMPL


@router.patch("/{trip_id}/legs/{leg_id}")
async def update_leg(trip_id: str, leg_id: str):
    # TODO: user edits a single route leg
    return _NOT_IMPL


@router.post("/{trip_id}/adapt")
async def adapt_trip(trip_id: str):
    # TODO: call adaptation_agent with user-provided reason or weather context
    return _NOT_IMPL
