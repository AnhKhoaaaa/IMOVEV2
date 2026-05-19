from pydantic import BaseModel
from typing import Optional

class Place(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    dwell_minutes: int
    best_time_start: str
    best_time_end: str
    category: str
    is_outdoor: bool
