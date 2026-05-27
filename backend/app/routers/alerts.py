import logging

from fastapi import APIRouter, HTTPException

from app.models.trip import FeedbackRequest, PreferencesResponse

AUTH_REQUIRED_DETAIL = (
    "Authentication required: Memory Agent endpoints need verified Supabase JWT "
    "auth before they can be used safely."
)

log = logging.getLogger(__name__)

router = APIRouter()


@router.post("/feedback", status_code=201)
async def submit_feedback(body: FeedbackRequest):
    """Feedback is disabled until user_id comes from verified JWT auth."""
    log.info("Feedback rejected for trip %s: JWT auth is not wired yet", body.trip_id)
    raise HTTPException(status_code=501, detail=AUTH_REQUIRED_DETAIL)


@router.get("/preferences", response_model=PreferencesResponse)
async def get_preferences():
    """Preferences are disabled until user_id comes from verified JWT auth."""
    raise HTTPException(status_code=501, detail=AUTH_REQUIRED_DETAIL)
