import logging

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import get_current_user
from app.models.preferences import UserPreferenceProfile
from app.database import supabase

log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/me/preferences")
async def get_preferences(
    current_user: str | None = Depends(get_current_user),
) -> UserPreferenceProfile:
    """Return the authenticated user's preference profile.

    Returns the default profile when:
    - User is not authenticated (guest mode)
    - User has not yet saved a custom profile
    - Database is unavailable
    """
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")

    if supabase:
        try:
            resp = (
                supabase.table("user_preferences")
                .select("profile, updated_at")
                .eq("user_id", current_user)
                .limit(1)
                .execute()
            )
            if resp.data:
                return UserPreferenceProfile(**resp.data[0]["profile"])
        except Exception as exc:
            log.warning("get_preferences DB error for %s: %s", current_user, exc)

    return UserPreferenceProfile()   # default profile nếu chưa có record


@router.put("/me/preferences")
async def update_preferences(
    body: UserPreferenceProfile,
    current_user: str | None = Depends(get_current_user),
) -> UserPreferenceProfile:
    """Upsert the authenticated user's preference profile.

    Weights are re-normalized before saving to guarantee sum == 1.0
    (handles minor floating-point deviations from the client).
    Returns the normalized profile as saved.
    """
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not supabase:
        raise HTTPException(status_code=503, detail="Database unavailable")

    # Normalize weights before saving — ensures DB CHECK constraint passes
    normalized = body.renormalized()
    profile_dict = {
        "duration_w":  normalized.duration_w,
        "cost_w":      normalized.cost_w,
        "walking_w":   normalized.walking_w,
        "transfers_w": normalized.transfers_w,
        "constraints": normalized.constraints.model_dump(),
    }

    try:
        supabase.table("user_preferences").upsert({
            "user_id": current_user,
            "profile": profile_dict,
        }).execute()
    except Exception as exc:
        log.error("update_preferences DB error for %s: %s", current_user, exc)
        raise HTTPException(status_code=503, detail="Failed to save preferences")

    return normalized
