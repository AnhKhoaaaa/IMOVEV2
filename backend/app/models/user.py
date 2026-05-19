from pydantic import BaseModel
from typing import Optional

class UserPreferences(BaseModel):
    prefer_mrt: bool = True
    max_walk_minutes: int = 15
    avoid_transfers: bool = False
