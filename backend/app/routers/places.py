import json
import pathlib

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from app.models.place import Place

router = APIRouter()

_PLACES_PATH = pathlib.Path(__file__).parent.parent / "data" / "places.json"
_CURATED: list[Place] = [Place(**p) for p in json.loads(_PLACES_PATH.read_text())]


@router.get("/curated", response_model=list[Place])
async def get_curated_places():
    return _CURATED


@router.get("/search", response_model=list[Place])
async def search_places(q: str = Query(..., min_length=1)):
    q_lower = q.lower()
    return [
        p for p in _CURATED
        if q_lower in p.name.lower() or q_lower in p.category.lower()
    ]


class AiSuggestRequest(BaseModel):
    num_days: int = Field(default=1, ge=1, le=14)
    travel_styles: list[str] = Field(default_factory=list)
    group_type: str = "solo"


@router.post("/ai-suggest")
async def ai_suggest_places(body: AiSuggestRequest):
    from app.agents.planning_agent import suggest_places
    place_ids = await suggest_places(body.num_days, body.travel_styles, body.group_type)
    return {"suggested_place_ids": place_ids}
