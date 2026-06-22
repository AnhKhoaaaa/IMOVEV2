from fastapi import APIRouter, HTTPException

from app.services import lta, onemap
from app.services.lta import LTAUnavailableError
from app.services.onemap import NoRouteError
from app.models.trip import RouteComparison

router = APIRouter(tags=["transit"])


@router.get("/bus-arrivals/{stop_code}")
async def bus_arrivals(stop_code: str):
    try:
        return await lta.get_bus_arrival(stop_code)
    except LTAUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/mrt-crowd/{station_code}")
async def mrt_crowd(station_code: str):
    try:
        result = await lta.get_mrt_crowd(station_code)
        return result or {}
    except LTAUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.get("/compare", response_model=RouteComparison)
async def compare_routes(
    from_lat: float,
    from_lng: float,
    to_lat: float,
    to_lng: float,
):
    try:
        result = await onemap.get_all_routes(from_lat, from_lng, to_lat, to_lng)
        return RouteComparison(**result)
    except NoRouteError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
