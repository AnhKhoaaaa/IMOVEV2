import httpx

class NoRouteError(Exception):
    pass

# [CODE] Geocode a place name via OneMap Search API
async def geocode(place_name: str) -> dict:
    raise NotImplementedError

# [CODE] Get route between two coordinates via OneMap Route API
# Raises NoRouteError if no public transport route found — no fallback
async def get_route(from_lat: float, from_lng: float, to_lat: float, to_lng: float, mode: str) -> dict:
    raise NotImplementedError
