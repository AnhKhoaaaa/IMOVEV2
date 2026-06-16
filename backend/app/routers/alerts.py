import logging

from fastapi import APIRouter, Depends, HTTPException

from app.models.trip import FeedbackRequest, PreferencesResponse
from app.agents import memory_agent
from app.dependencies import require_current_user
from app.routers import trips

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/feedback", status_code=201)
async def submit_feedback(
    body: FeedbackRequest,
    user_id: str = Depends(require_current_user),
):
    """Save explicit feedback for a trip owned by the authenticated user."""
    trips._verify_user_ownership(body.trip_id, user_id)

    try:
        await memory_agent.save_feedback(
            trip_id=body.trip_id,
            user_id=user_id,
            leg_id=body.leg_id,
            rating=body.rating,
            comment=body.comment,
            feedback_type="explicit",
        )
        await memory_agent.learn_from_implicit(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        log.error("save_feedback failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save feedback")

    return {"status": "ok"}


@router.get("/preferences", response_model=PreferencesResponse)
async def get_preferences(user_id: str = Depends(require_current_user)):
    """Return user travel preferences. Requires a valid Supabase JWT."""
    try:
        prefs = await memory_agent.get_preferences(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return PreferencesResponse(**prefs)
