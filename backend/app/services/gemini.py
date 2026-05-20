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
