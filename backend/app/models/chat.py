"""API contract for the LLM chatbot assistant.

Two-step write flow: POST /chat returns a ProposedAction (no mutation), then
POST /chat/confirm executes the pending action via existing trip handlers.
"""
from typing import Optional
from pydantic import BaseModel

from app.models.trip import TripPlan


class Gps(BaseModel):
    lat: float
    lng: float


class ChatRequest(BaseModel):
    session_id: str
    message: str
    trip_id: Optional[str] = None
    gps: Optional[Gps] = None


class ProposedAction(BaseModel):
    tool: str
    preview: str          # human-readable summary shown in the confirm card
    args: dict


class ChatResponse(BaseModel):
    reply: str
    proposed_action: Optional[ProposedAction] = None
    pending_action_id: Optional[str] = None


class ChatConfirmRequest(BaseModel):
    session_id: str
    pending_action_id: str
    confirm: bool = True


class ChatConfirmResponse(BaseModel):
    reply: str
    executed: bool
    trip: Optional[TripPlan] = None
