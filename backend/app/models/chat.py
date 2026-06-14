"""API contract for the LLM chatbot assistant.

Two-step write flow: POST /chat returns a ProposedAction (no mutation), then
POST /chat/confirm executes the pending action via existing trip handlers.
"""
from typing import Literal, Optional, Union
from pydantic import BaseModel, Field

from app.models.trip import TripPlan


# ── Rich chat blocks (dev25 P3) ──────────────────────────────────────────────────
# A chat answer can render as MULTIPLE styled blocks instead of one plain bubble:
# markdown text + place cards (image from the curated dataset) + route-compare +
# bus-arrivals. Card data is always real (built backend-side from tools/dataset); the
# LLM only authors the connective text. `ChatResponse.reply` is kept as a fallback.


class TextBlock(BaseModel):
    type: Literal["text"] = "text"
    markdown: str


class PlaceCardBlock(BaseModel):
    type: Literal["place_card"] = "place_card"
    id: str
    name: str
    category: Optional[str] = None
    image_url: Optional[str] = None
    suggested_duration_minutes: Optional[int] = None


class RouteOption(BaseModel):
    mode: str
    duration_minutes: Optional[float] = None
    fare_sgd: Optional[float] = None
    walk_minutes: Optional[float] = None


class RouteCompareBlock(BaseModel):
    type: Literal["route_compare"] = "route_compare"
    from_name: Optional[str] = None
    to_name: Optional[str] = None
    options: list[RouteOption] = Field(default_factory=list)


class BusService(BaseModel):
    service_no: str
    eta_min: Optional[int] = None
    load: Optional[str] = None


class BusArrivalsBlock(BaseModel):
    type: Literal["bus_arrivals"] = "bus_arrivals"
    stop_code: str
    services: list[BusService] = Field(default_factory=list)


ChatBlock = Union[TextBlock, PlaceCardBlock, RouteCompareBlock, BusArrivalsBlock]


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
    # dev25 P3 — additive: when present the client renders these styled blocks instead of the
    # plain `reply` bubble. `reply` is kept for back-compat (proposals/confirms/errors/fallback).
    blocks: Optional[list[ChatBlock]] = None
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


# ── Proactive alert phrasing (dev25 P1) ──────────────────────────────────────────
# The client already holds the full alert row (RLS-protected Realtime, select('*')), so it
# sends the fields to rephrase; the endpoint returns only a friendlier rewrite — no DB read.


class AlertPayload(BaseModel):
    id: Optional[str] = None
    alert_type: Optional[str] = None
    message: Optional[str] = None
    day_number: Optional[int] = None


class PhraseAlertRequest(BaseModel):
    alert: AlertPayload
    lang: str = "en"


class ProactiveMessage(BaseModel):
    alert_id: Optional[str] = None
    text: str
    alert_type: Optional[str] = None
    day_number: Optional[int] = None


# ── Live GPS companion nudge (dev25 P5) ───────────────────────────────────────────
# Anchored to the user's REAL position (vs the scheduler's centroid-based weather_live):
# the client polls while the chat companion is open; the backend returns a warm rain nudge
# only when it is raining at the user's coords near an upcoming outdoor stop — else nudge=None.


class CompanionCheckRequest(BaseModel):
    session_id: str
    trip_id: str
    gps: Gps
    lang: str = "en"


class CompanionCheckResponse(BaseModel):
    nudge: Optional[ProactiveMessage] = None
