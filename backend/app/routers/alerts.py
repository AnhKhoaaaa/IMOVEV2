from fastapi import APIRouter

router = APIRouter()

@router.post("/feedback")
async def submit_feedback():
    # TODO: memory_agent — save rating/comment to trip_feedback
    raise NotImplementedError

@router.get("/preferences")
async def get_preferences():
    # TODO: memory_agent — return user_preferences from Supabase
    raise NotImplementedError
