import logging

from fastapi import APIRouter, HTTPException, Query

from app.models.trip import FeedbackRequest, PreferencesResponse
from app.agents import memory_agent

# Production TODO: replace body/query user_id with server-side JWT extraction via Supabase auth.

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/feedback", status_code=201)
async def submit_feedback(body: FeedbackRequest):
    """Save explicit user rating/comment; trigger implicit preference learning if logged in."""
    try:
        await memory_agent.save_feedback(
            trip_id=body.trip_id,
            user_id=None,  # ignore client-supplied user_id until JWT auth is wired
            leg_id=body.leg_id,
            rating=body.rating,
            comment=body.comment,
            feedback_type="explicit",
        )
        if body.user_id:  # still call learn_from_implicit with provided id for now
            await memory_agent.learn_from_implicit(body.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        log.error("save_feedback failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save feedback")

    return {"status": "ok"}


@router.get("/preferences", response_model=PreferencesResponse)
async def get_preferences(user_id: str = Query(..., description="Logged-in user UUID")):
    """Return user travel preferences. Requires authenticated user_id."""
    raise HTTPException(
        status_code=501,
        detail="Authentication required — this endpoint requires JWT auth middleware before production use"
    )
    try:  # noqa: unreachable — kept for when JWT auth is wired
        prefs = await memory_agent.get_preferences(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return PreferencesResponse(**prefs)
