import asyncio
import json
import re
import time

from google import genai
from app.config import settings

_client = genai.Client(api_key=settings.gemini_api_key)

_last_call_at: float = 0
_MIN_INTERVAL = 4  # seconds — enforces max 15 RPM
_RATE_LIMIT_LOCK = asyncio.Lock()

_PROMPT_TEMPLATE = (
    "Extract all Singapore tourist place names from the text below.\n"
    "Return ONLY a JSON array of strings. No explanation, no code block.\n"
    "If no places found, return [].\n\n"
    "Text: {text}"
)

_SUGGEST_TEMPLATE = (
    "You are helping a {group_type} plan a {num_days}-day trip to Singapore.\n"
    "Travel interests: {interests}\n\n"
    "Available places (id | name | category | best_time_start):\n"
    "{places_list}\n\n"
    "Select up to {max_places} places that best match the traveler's interests.\n"
    "Order them for a logical visit flow (morning places first, then afternoon/evening).\n"
    "Return ONLY a JSON array of place IDs. No explanation, no code block.\n"
    'Example: ["merlion-park", "gardens-by-the-bay"]'
)


async def parse_places_input(raw_text: str) -> list[str]:
    """Parse natural language place input into a list of place name strings.

    Enforces a 4-second minimum interval between calls (≤ 15 RPM).
    The lock serialises concurrent callers so the rate limit holds even under load.
    Raises ValueError if Gemini returns non-JSON output.
    """
    global _last_call_at
    async with _RATE_LIMIT_LOCK:
        elapsed = time.monotonic() - _last_call_at
        if elapsed < _MIN_INTERVAL:
            await asyncio.sleep(_MIN_INTERVAL - elapsed)
        _last_call_at = time.monotonic()

    prompt = _PROMPT_TEMPLATE.format(text=raw_text)
    response = await _client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )

    if response.text is None:
        raise ValueError("Gemini returned no text (response may have been filtered by safety policy)")
    text = response.text.strip()
    # Strip markdown code fences Gemini sometimes wraps output in
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Gemini returned non-JSON output: {text!r}") from exc


async def suggest_places(
    num_days: int,
    travel_styles: list[str],
    group_type: str,
    all_places: list[dict],
) -> list[str]:
    """[LLM] Ask Gemini to select and order place IDs for an itinerary.

    Rate-limited to ≤15 RPM via the shared lock.
    Returns only IDs that exist in all_places (validated).
    Raises ValueError / any exception on failure — caller provides fallback.
    """
    global _last_call_at
    async with _RATE_LIMIT_LOCK:
        elapsed = time.monotonic() - _last_call_at
        if elapsed < _MIN_INTERVAL:
            await asyncio.sleep(_MIN_INTERVAL - elapsed)
        _last_call_at = time.monotonic()

    interests = ", ".join(travel_styles) if travel_styles else "general sightseeing"
    places_list = "\n".join(
        f"{p['id']} | {p['name']} | {p['category']} | {p['best_time_start']}"
        for p in all_places
    )
    max_places = min(num_days * 4, len(all_places))
    prompt = _SUGGEST_TEMPLATE.format(
        group_type=group_type or "solo traveler",
        num_days=num_days,
        interests=interests,
        places_list=places_list,
        max_places=max_places,
    )
    response = await _client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
    )
    if response.text is None:
        raise ValueError("Gemini returned no text (may have been filtered)")
    text = response.text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    result = json.loads(text)
    valid_ids = {p["id"] for p in all_places}
    return [pid for pid in result if pid in valid_ids]
