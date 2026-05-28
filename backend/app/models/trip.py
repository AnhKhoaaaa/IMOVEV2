from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import date
from uuid import UUID

from app.models.place import Place

TripStatus = Literal["DRAFT", "UPCOMING", "HAPPENING_TODAY", "PAST"]


class TripCreate(BaseModel):
    session_id: str = Field(min_length=8, max_length=128)
    user_id: Optional[UUID] = None
    num_days: int = Field(ge=1, le=14)
    budget_sgd: float = Field(ge=0)
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class TripPlanRequest(BaseModel):
    place_ids: list[str] = Field(min_length=2)
    optimize_order: bool = True
    preferences: Optional[dict] = None


class PTSubLeg(BaseModel):
    mode: str
    route: str = ""
    from_name: str = ""
    to_name: str = ""
    from_stop_code: str = ""
    to_stop_code: str = ""
    duration_minutes: int = 0
    num_stops: int = 0


class LegResponse(BaseModel):
    id: str
    from_place_id: str
    to_place_id: str
    transport_mode: str
    duration_minutes: int
    cost_sgd: float
    is_estimated: bool
    instructions: list[str] = []
    geometry: str | None = None
    distance_km: float | None = None
    sub_legs: list[PTSubLeg] = []


class DayPlan(BaseModel):
    day: int
    legs: list[LegResponse]


class TripPlan(BaseModel):
    id: str
    days: list[DayPlan]
    places: list[Place]
    warnings: list[str]


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
    transport_mode: Literal["MRT", "LRT", "BUS", "WALK"]


class AdaptRequest(BaseModel):
    alert_id: str
    # session_id should match the one used in POST /trips — used to verify ownership.
    session_id: Optional[str] = Field(default=None, min_length=8, max_length=128)


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


class FeedbackRequest(BaseModel):
    trip_id: str
    leg_id: Optional[str] = None
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None


class PreferencesResponse(BaseModel):
    max_walk_minutes: int = 15
    prefer_mrt: bool = False
    avoid_transfers: bool = False
