import json
import pathlib

from fastapi import APIRouter, HTTPException, Query
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
