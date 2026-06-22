"""
Memory Agent — active only for logged-in users (user_id required).
Learns from explicit ratings and implicit edit patterns in trip_feedback.
"""

import logging
import uuid as _uuid
from typing import Optional

from app.database import supabase

log = logging.getLogger(__name__)

_PREF_DEFAULTS = {
    "max_walk_minutes": 15,
    "prefer_mrt": False,
    "avoid_transfers": False,
}

# Threshold: how many implicit changes trigger a preference update
_IMPLICIT_CHANGE_THRESHOLD = 2


def _validate_user_id(user_id: str) -> None:
    """Raise ValueError if user_id is not a valid UUID.

    Production note: this is a format check only. In a production deployment,
    user_id should be extracted server-side from a verified Supabase JWT — never
    trusted from the request body.
    """
    try:
        _uuid.UUID(user_id)
    except ValueError:
        raise ValueError(f"Invalid user_id format: '{user_id}' is not a valid UUID")


async def save_feedback(
    trip_id: str,
    user_id: Optional[str],
    leg_id: Optional[str],
    rating: int,
    comment: Optional[str],
    feedback_type: str = "explicit",
) -> None:
    """[CODE] Insert a feedback row into trip_feedback."""
    if not supabase:
        return

    row = {
        "trip_id": trip_id,
        "user_id": user_id,
        "leg_id": leg_id,
        "rating": rating,
        "comment": comment,
        "feedback_type": feedback_type,
    }
    supabase.table("trip_feedback").insert(row).execute()


async def get_preferences(user_id: str) -> dict:
    """[CODE] Return user_preferences. Returns defaults if no record exists."""
    _validate_user_id(user_id)

    if not supabase:
        return dict(_PREF_DEFAULTS)

    resp = supabase.table("user_preferences").select("*").eq("user_id", user_id).execute()
    if not resp.data:
        return dict(_PREF_DEFAULTS)

    row = resp.data[0]
    return {
        "max_walk_minutes": row.get("max_walk_minutes", _PREF_DEFAULTS["max_walk_minutes"]),
        "prefer_mrt": row.get("prefer_mrt", _PREF_DEFAULTS["prefer_mrt"]),
        "avoid_transfers": row.get("avoid_transfers", _PREF_DEFAULTS["avoid_transfers"]),
    }


async def learn_from_implicit(user_id: str) -> None:
    """[CODE] Scan implicit feedback for this user; update user_preferences if patterns emerge.

    Pattern rules (from PLAN_DEV2_agent_logic.md):
    - ≥2 edits where comment contains "BUS → MRT"  → prefer_mrt = True
    - ≥2 edits where comment contains "→ WALK"     → max_walk_minutes += 5 (from current value)
    """
    _validate_user_id(user_id)

    if not supabase:
        return

    resp = (
        supabase.table("trip_feedback")
        .select("comment")
        .eq("user_id", user_id)
        .eq("feedback_type", "implicit")
        .execute()
    )
    if not resp.data:
        return

    comments = [r.get("comment", "") or "" for r in resp.data]

    bus_to_mrt = sum(
        1 for c in comments
        if any(pat in c for pat in ("BUS → MRT", "BUS -> MRT", "BUS → METRO", "BUS -> METRO"))
    )
    to_walk = sum(1 for c in comments if "→ WALK" in c or "-> WALK" in c)

    updates: dict = {}
    if bus_to_mrt >= _IMPLICIT_CHANGE_THRESHOLD:
        updates["prefer_mrt"] = True
        log.info("User %s: %d BUS→MRT edits → setting prefer_mrt=True", user_id, bus_to_mrt)

    if not updates and to_walk < _IMPLICIT_CHANGE_THRESHOLD:
        return

    # Read current preferences to increment max_walk_minutes from the stored value
    existing_resp = (
        supabase.table("user_preferences")
        .select("id,max_walk_minutes")
        .eq("user_id", user_id)
        .execute()
    )
    existing_row = existing_resp.data[0] if existing_resp.data else None

    if to_walk >= _IMPLICIT_CHANGE_THRESHOLD:
        current_max_walk = (
            existing_row["max_walk_minutes"]
            if existing_row
            else _PREF_DEFAULTS["max_walk_minutes"]
        )
        updates["max_walk_minutes"] = current_max_walk + 5
        log.info("User %s: %d walk-preference edits → max_walk_minutes %d → %d",
                 user_id, to_walk, current_max_walk, updates["max_walk_minutes"])

    if not updates:
        return

    # Upsert: create a new preferences record if one doesn't exist
    if existing_row:
        supabase.table("user_preferences").update(updates).eq("user_id", user_id).execute()
    else:
        supabase.table("user_preferences").insert({"user_id": user_id, **_PREF_DEFAULTS, **updates}).execute()
