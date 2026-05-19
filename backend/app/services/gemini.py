import asyncio
import time

_last_call_at: float = 0
_MIN_INTERVAL = 4  # seconds — enforces max 15 RPM

# [LLM] Parse natural language place input into a list of place name strings
async def parse_places_input(raw_text: str) -> list[str]:
    global _last_call_at
    elapsed = time.monotonic() - _last_call_at
    if elapsed < _MIN_INTERVAL:
        await asyncio.sleep(_MIN_INTERVAL - elapsed)
    _last_call_at = time.monotonic()
    raise NotImplementedError
