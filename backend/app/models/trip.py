from pydantic import BaseModel
from typing import Optional
from uuid import UUID

class TripCreate(BaseModel):
    session_id: str
    user_id: Optional[UUID] = None
    num_days: int
    budget_sgd: float

class TripPlanRequest(BaseModel):
    place_ids: list[str]
    optimize_order: bool = True
    preferences: Optional[dict] = None
