from pydantic import BaseModel

class RouteLeg(BaseModel):
    from_place_id: str
    to_place_id: str
    transport_mode: str
    duration_minutes: int
    cost_sgd: float
    is_estimated: bool  # must be False when data comes from OneMap
