from pydantic import BaseModel, Field
from typing import Literal, Optional
from uuid import UUID

from app.models.place import Place


class TripCreate(BaseModel):
    session_id: str
    user_id: Optional[UUID] = None
    num_days: int = Field(ge=1, le=14)
    budget_sgd: float = Field(ge=0)


class TripPlanRequest(BaseModel):
    place_ids: list[str] = Field(min_length=2)
    optimize_order: bool = True
    preferences: Optional[dict] = None


class LegResponse(BaseModel):
    id: str
    from_place_id: str
    to_place_id: str
    transport_mode: str
    duration_minutes: int
    cost_sgd: float
    is_estimated: bool


class DayPlan(BaseModel):
    day: int
    legs: list[LegResponse]


class TripPlan(BaseModel):
    id: str
    days: list[DayPlan]
    places: list[Place]
    warnings: list[str]


class LegUpdateRequest(BaseModel):
    transport_mode: Literal["MRT", "LRT", "BUS", "WALK"]


class AdaptRequest(BaseModel):
    alert_id: str
    # session_id should match the one used in POST /trips — used to verify ownership.
    session_id: Optional[str] = None


class AdaptResponse(BaseModel):
    adapted: bool
    changes: list[str]
    updated_trip: TripPlan


class FeedbackRequest(BaseModel):
    trip_id: str
    user_id: Optional[str] = None
    leg_id: Optional[str] = None
    rating: int = Field(ge=1, le=5)
    comment: Optional[str] = None


class PreferencesResponse(BaseModel):
    max_walk_minutes: int = 15
    prefer_mrt: bool = False
    avoid_transfers: bool = False
