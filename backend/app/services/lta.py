import httpx

class LTAUnavailableError(Exception):
    pass

# [CODE] Get bus arrival times for a bus stop
# Raises LTAUnavailableError if API is down
async def get_bus_arrival(bus_stop_code: str) -> list[dict]:
    raise NotImplementedError

# [CODE] Get active MRT/bus disruption alerts
# Raises LTAUnavailableError if API is down
async def get_train_alerts() -> list[dict]:
    raise NotImplementedError
