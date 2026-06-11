from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import date
from uuid import UUID

from app.models.place import Place

TripStatus = Literal["DRAFT", "UPCOMING", "HAPPENING_TODAY", "PAST"]

TransportMode = Literal["BUS", "METRO", "CYCLE", "WALK", "GRAB"]


class TripCreate(BaseModel):
    session_id: str = Field(min_length=8, max_length=128)
    user_id: Optional[UUID] = None
    num_days: int = Field(ge=1, le=14)
    budget_sgd: float = Field(ge=0)
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    name: Optional[str] = None


class TripPlanRequest(BaseModel):
    place_ids: list[str] = Field(min_length=2)
    optimize_order: bool = True
    preferences: Optional[dict] = None
    hotel_name: Optional[str] = None
    hotel_lat: Optional[float] = None
    hotel_lng: Optional[float] = None


class PTSubLeg(BaseModel):
    mode: TransportMode
    route: str = ""
    from_name: str = ""
    to_name: str = ""
    from_stop_code: str = ""
    to_stop_code: str = ""
    duration_minutes: int = 0
    num_stops: int = 0
    geometry: str | None = None
    intermediate_stops: list[dict] = []


class AlternativeRoute(BaseModel):
    """Pre-fetched route data for one transport mode.
    Stored in-memory alongside LegResponse — NOT persisted to DB."""
    duration_minutes: int
    cost_sgd: float
    is_estimated: bool = False
    geometry: str | None = None
    geometries: list[str] = []
    instructions: list[str] = []
    distance_km: float | None = None
    sub_legs: list[PTSubLeg] = []


class LegResponse(BaseModel):
    id: str
    from_place_id: str
    to_place_id: str
    transport_mode: TransportMode
    duration_minutes: int
    cost_sgd: float
    is_estimated: bool
    instructions: list[str] = []
    geometry: str | None = None
    geometries: list[str] = []
    distance_km: float | None = None
    sub_legs: list[PTSubLeg] = []
    alternatives: dict[str, AlternativeRoute] = {}   # key = TransportMode; in-memory only
    # LTA bus stop code for the first boarding point.
    # Only set when transport_mode == "BUS". Frontend uses this to call
    # GET /transit/bus-arrivals/{first_bus_stop_code} for real-time countdown.
    first_bus_stop_code: str | None = None


class DayPlan(BaseModel):
    day: int
    legs: list[LegResponse]
    place_ids: list[str] = []


class GapNotification(BaseModel):
    day_index: int
    gap_start: str    # "HH:MM"
    gap_end: str      # "HH:MM"
    gap_minutes: int
    message: str


class TripPlan(BaseModel):
    id: str
    name: Optional[str] = None
    days: list[DayPlan]
    places: list[Place]
    warnings: list[str]
    gap_notifications: list[GapNotification] = []


class LegSwapResult(BaseModel):
    """Response for PATCH /trips/{id}/legs/{leg_id} and POST .../switch-now."""
    updated_leg: LegResponse
    trip_cost_sgd: float        # recalculated total cost for the whole trip
    warnings: list[str] = []   # schedule overfull, budget exceeded, etc.
    routed_from_current_position: bool = False  # True = geometry starts from GPS, not from_place


class ModeResult(BaseModel):
    available: bool
    duration_minutes: int = 0
    fare_sgd: float = 0.0
    distance_km: float = 0.0
    summary: str = ""


class RouteComparison(BaseModel):
    pt: ModeResult
    walk: ModeResult
    cycle: ModeResult


class LegUpdateRequest(BaseModel):
    transport_mode: TransportMode


class LiveSwitchRequest(BaseModel):
    """Request body for POST /trips/{id}/legs/{leg_id}/switch-now.
    User-initiated live mode-switch using current GPS position.
    """
    new_mode: TransportMode
    current_lat: float = Field(ge=-90, le=90)
    current_lng: float = Field(ge=-180, le=180)


class AdaptRequest(BaseModel):
    alert_id: str
    # session_id should match the one used in POST /trips — used to verify ownership.
    session_id: Optional[str] = Field(default=None, min_length=8, max_length=128)
    # closing_risk resolutions (dev20): how the user chose to resolve a running-late alert.
    # leave_earlier = advisory (no structural change); skip = drop the stop; push = move to target_day.
    resolution: Optional[Literal["leave_earlier", "skip", "push"]] = None
    target_day: Optional[int] = Field(default=None, ge=1)


class CheckAlertsRequest(BaseModel):
    """Request body for POST /trips/{id}/check-alerts (demand-triggered, UPCOMING trips)."""
    session_id: Optional[str] = Field(default=None, min_length=8, max_length=128)
    # Live-trip progress (dev19 P2.2): limits the live-rain check to outdoor stops not yet passed.
    active_day: Optional[int] = Field(default=None, ge=1)
    active_leg_index: Optional[int] = Field(default=None, ge=0)
    # Live closing-risk timeline anchors (dev20), minute-of-day SGT:
    # arrived_at_min — when the user pressed "Arrived" at the stop they are dwelling at.
    # anchor_min     — when the user pressed "I left this stop" (re-anchors the projection).
    arrived_at_min: Optional[int] = Field(default=None, ge=0, le=1439)
    anchor_min: Optional[int] = Field(default=None, ge=0, le=1439)


class AdaptResponse(BaseModel):
    adapted: bool
    changes: list[str]
    updated_trip: TripPlan
    delta_transit_cost: float = 0.0        # positive = more expensive, negative = cheaper (SGD)
    delta_active_time: int = 0             # minutes added (positive) or saved (negative)
    delta_walking_distance: float = 0.0   # meters added or saved


class LocationUpdate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    session_id: Optional[str] = Field(default=None, min_length=8, max_length=128)


class AddPlaceRequest(BaseModel):
    place_id: str
    day: int = Field(ge=1)


class ReorderRequest(BaseModel):
    day: int = Field(ge=1)
    place_ids: list[str] = Field(min_length=1)
    existing_legs: list[dict] = Field(default_factory=list)


class OptimizeRequest(BaseModel):
    existing_legs: list[dict] = Field(default_factory=list)


class FeedbackRequest(BaseModel):
    trip_id: str
    leg_id: Optional[str] = None
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None


class PreferencesResponse(BaseModel):
    max_walk_minutes: int = 15
    prefer_mrt: bool = False
    avoid_transfers: bool = False
