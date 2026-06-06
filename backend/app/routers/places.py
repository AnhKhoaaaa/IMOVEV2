import json
import pathlib

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from app.models.place import Place
from app.agents.planning_agent import _normalise_place

router = APIRouter()

_PLACES_PATH = pathlib.Path(__file__).parent.parent / "data" / "singapore_places.json"
_raw_places = json.loads(_PLACES_PATH.read_text(encoding="utf-8"))
_CURATED: list[Place] = [Place(**_normalise_place(p)) for p in _raw_places]


@router.get("/curated", response_model=list[Place])
async def get_curated_places():
    return _CURATED


@router.get("/search", response_model=list[Place])
async def search_places(q: str = Query(..., min_length=1)):
    q_lower = q.lower()
    return [
        p for p in _CURATED
        if q_lower in p.name.lower()
        or q_lower in p.category.lower()
        or any(q_lower in kw.lower() for kw in (p.search_keywords or []))
    ]


class AiSuggestRequest(BaseModel):
    num_days: int = Field(default=1, ge=1, le=14)
    travel_styles: list[str] = Field(default_factory=list)
    group_type: str = "solo"


@router.get("/geocode")
async def geocode_location(q: str = Query(..., min_length=1)):
    """Geocode a free-text address or place name via OneMap.

    Returns {lat, lng, address} of the top match.
    Used by frontend hotel/start-location search.
    """
    from app.services.onemap import geocode, GeocodingError
    try:
        return await geocode(q)
    except GeocodingError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/ai-suggest")
async def ai_suggest_places(body: AiSuggestRequest):
    from app.agents.planning_agent import suggest_places, get_all_places
    place_ids = await suggest_places(body.num_days, body.travel_styles, body.group_type)
    # Filter out hallucinated or stale IDs — only return IDs that exist in the
    # curated dataset so downstream plan_trip never hits PlaceDataMissingError.
    known = get_all_places()
    return {"suggested_place_ids": [pid for pid in place_ids if pid in known]}
