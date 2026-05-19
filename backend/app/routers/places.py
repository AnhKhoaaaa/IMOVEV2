from fastapi import APIRouter, Query

router = APIRouter()

@router.get("/search")
async def search_places(q: str = Query(..., min_length=1)):
    # TODO: geocode via OneMap + filter against curated dataset
    raise NotImplementedError

@router.get("/curated")
async def get_curated_places():
    # TODO: return all POIs from data/places.json
    raise NotImplementedError
