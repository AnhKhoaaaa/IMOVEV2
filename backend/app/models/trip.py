from pydantic import BaseModel, Field
from typing import Literal, Optional
from uuid import UUID

from app.models.place import Place


class TripCreate(BaseModel):
    session_id: str
    user_id: Optional[UUID] = None
    num_days: int
    budget_sgd: float


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


class AdaptResponse(BaseModel):
    adapted: bool
    changes: list[str]
    updated_trip: TripPlan
