from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()

_NOT_IMPL = JSONResponse(
    status_code=501,
    content={"detail": "Agent chưa được triển khai — Dev 2 đang phát triển tính năng này."},
)


@router.post("/feedback")
async def submit_feedback():
    # TODO: memory_agent — save rating/comment to trip_feedback
    return _NOT_IMPL


@router.get("/preferences")
async def get_preferences():
    # TODO: memory_agent — return user_preferences from Supabase
    return _NOT_IMPL
