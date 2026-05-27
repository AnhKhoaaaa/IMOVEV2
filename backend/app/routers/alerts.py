import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.models.trip import FeedbackRequest, PreferencesResponse
from app.agents import memory_agent
from app.dependencies import get_current_user, require_current_user

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/feedback", status_code=201)
async def submit_feedback(
    body: FeedbackRequest,
    user_id: Optional[str] = Depends(get_current_user),
):
    """Save explicit user rating/comment. user_id is extracted from JWT (optional)."""
    try:
        await memory_agent.save_feedback(
            trip_id=body.trip_id,
            user_id=user_id,
            leg_id=body.leg_id,
            rating=body.rating,
            comment=body.comment,
            feedback_type="explicit",
        )
        if user_id:
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
