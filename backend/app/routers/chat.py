"""Chatbot router — natural-language assistant with two-step write confirmation.

POST /chat          → run the tool-calling loop; writes return a proposal (no mutation).
POST /chat/confirm  → verify ownership, execute the pending action via existing trip
                      handlers in-process, return the updated TripPlan.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from app.dependencies import require_current_user
from app.agents import chat_agent
from app.services import gemini
from app.models.chat import (
    ChatRequest, ChatResponse, ChatConfirmRequest, ChatConfirmResponse,
    PhraseAlertRequest, ProactiveMessage,
    CompanionCheckRequest, CompanionCheckResponse,
)
from app.routers import trips
from app.models.trip import (
    AddPlaceRequest, ReorderRequest, LegUpdateRequest, LiveSwitchRequest, OptimizeRequest,
)

router = APIRouter()


@router.post("", response_model=ChatResponse)
async def chat(body: ChatRequest, current_user: str = Depends(require_current_user)):
    return await chat_agent.run_chat(
        session_id=body.session_id,
        message=body.message,
        trip_id=body.trip_id,
        gps=body.gps,
        current_user=current_user,
    )


@router.post("/phrase-alert", response_model=ProactiveMessage)
async def phrase_alert(
    body: PhraseAlertRequest,
    current_user: str = Depends(require_current_user),
):
    """Rewrite a live trip alert as a friendly chat message (dev25 P1, proactive companion).

    The client already holds the full alert row via RLS-protected Realtime, so it sends the
    fields to rephrase — this returns only a friendlier rewrite (no DB read, no privileged
    data). `require_current_user` gates Gemini-quota abuse; chat is login-only anyway.
    """
    text = await gemini.phrase_alert(body.alert.model_dump(), body.lang)
    return ProactiveMessage(
        alert_id=body.alert.id,
        text=text,
        alert_type=body.alert.alert_type,
        day_number=body.alert.day_number,
    )


@router.post("/companion-check", response_model=CompanionCheckResponse)
async def companion_check(
    body: CompanionCheckRequest,
    current_user: str = Depends(require_current_user),
):
    """Live, GPS-anchored rain nudge for the chat companion (dev25 P5).

    The client polls this while the chat widget is open and it has the user's real GPS. The
    backend checks the weather at those coords (not the trip centroid) and returns a warm nudge
    only when it's raining near an upcoming outdoor stop — else `nudge=None` (the common case),
    so the client stays quiet. The user acts by replying in chat (→ switch_leg_now / compare).
    """
    nudge = await chat_agent.companion_check(
        session_id=body.session_id,
        trip_id=body.trip_id,
        gps=body.gps,
        current_user=current_user,
        lang=body.lang,
    )
    return CompanionCheckResponse(nudge=nudge)


@router.post("/confirm", response_model=ChatConfirmResponse)
async def chat_confirm(
    body: ChatConfirmRequest,
    current_user: str = Depends(require_current_user),
):
    pending = chat_agent._pending_actions.get(body.session_id)
    if pending is None:
        raise HTTPException(status_code=404, detail="No pending action for this session")
    if pending["id"] != body.pending_action_id:
        raise HTTPException(status_code=409, detail="pending_action_id does not match")

    if not body.confirm:
        chat_agent._pending_actions.pop(body.session_id, None)
        return ChatConfirmResponse(
            reply="Okay, I won't make that change. (Đã huỷ thay đổi.)",
            executed=False,
        )

    trip_id = pending["trip_id"]

    # Centralised ownership check for EVERY write tool — fixes the gap where
    # update_leg / switch_leg_now don't verify ownership themselves. A 403 here
    # must propagate (not be swallowed by the try/except below).
    trips._verify_user_ownership(trip_id, current_user)

    try:
        await _dispatch(pending, current_user)
    except HTTPException as exc:
        # Handler rejected the change (e.g. 422 NoRoute/Budget/PlaceMissing). Keep the
        # pending so the user can retry; report politely instead of a raw HTTP error.
        return ChatConfirmResponse(
            reply=f"I couldn't apply that change: {exc.detail}",
            executed=False,
        )

    chat_agent._pending_actions.pop(body.session_id, None)
    updated = await trips.get_trip(trip_id, current_user)
    return ChatConfirmResponse(
        reply="Done — your itinerary has been updated. (Đã cập nhật lịch trình.)",
        executed=True,
        trip=updated,
    )


async def _dispatch(pending: dict, current_user: Optional[str]) -> None:
    """Execute a confirmed write via the existing trip handlers (in-process).

    No logic is duplicated: each handler owns its own validation, store update and
    Supabase persistence. Handlers may raise HTTPException — the caller handles it.
    """
    tool = pending["tool"]
    a = pending["args"]
    trip_id = pending["trip_id"]

    if tool == "add_place":
        await trips.add_place(trip_id, AddPlaceRequest(**a), current_user)
    elif tool == "remove_place":
        await trips.remove_place(trip_id, a["place_id"], current_user)
    elif tool == "reorder_places":
        await trips.reorder_places(
            trip_id, ReorderRequest(day=a["day"], place_ids=a["place_ids"]), current_user
        )
    elif tool == "change_leg_mode":
        await trips.update_leg(
            trip_id,
            a["leg_id"],
            LegUpdateRequest(transport_mode=a["transport_mode"]),
            current_user,
        )
    elif tool == "switch_leg_now":
        await trips.switch_leg_now(
            trip_id, a["leg_id"],
            LiveSwitchRequest(
                new_mode=a["new_mode"],
                current_lat=a["current_lat"],
                current_lng=a["current_lng"],
            ),
            current_user,
        )
    elif tool == "add_day":
        await trips.add_day(trip_id, current_user)
    elif tool == "remove_day":
        await trips.remove_day(trip_id, a["day"], current_user)
    elif tool == "optimize_trip":
        await trips.optimize_trip(trip_id, OptimizeRequest(), current_user)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown tool: {tool}")
