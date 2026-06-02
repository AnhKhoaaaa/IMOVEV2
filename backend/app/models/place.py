from pydantic import BaseModel
from typing import Optional


class Place(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    category: str
    is_outdoor: bool
    in_curated_dataset: bool = True

    # Required — present directly in singapore_places.json (pre-enriched)
    dwell_minutes: int        # normalised from suggested_duration_minutes at load time
    best_time_start: str      # HH:MM
    best_time_end: str        # HH:MM

    # New schema fields (optional for backward-compat with test fixtures)
    opening_hours: Optional[list[str]] = None   # was Optional[str]; now list
    close_days: Optional[list[str]] = None
    description: Optional[str] = None
    formatted_address: Optional[str] = None
    search_keywords: Optional[list[str]] = None
    suggested_duration_minutes: Optional[int] = None
    is_audited: Optional[bool] = None
    offset_over_1km: Optional[bool] = None

    # Old schema field — absent in new file; kept optional for legacy trip data
    image_url: Optional[str] = None
