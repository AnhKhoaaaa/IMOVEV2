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


async def _rate_limit() -> None:
    """Enforce ≥4-second gap between Gemini calls.

    The lock is held only briefly to read and update _last_call_at (slot reservation).
    Sleep happens OUTSIDE the lock so concurrent callers can reserve their own slots
    without blocking on each other — prevents N-caller delay stacking.
    """
    global _last_call_at
    async with _RATE_LIMIT_LOCK:
        now = time.monotonic()
        elapsed = now - _last_call_at
        wait = max(0.0, _MIN_INTERVAL - elapsed)
        _last_call_at = now + wait  # reserve this call's slot
    if wait > 0:
        await asyncio.sleep(wait)

_PROMPT_TEMPLATE = (
    "Extract all Singapore tourist place names from the text below.\n"
    "Return ONLY a JSON array of strings. No explanation, no code block.\n"
    "If no places found, return [].\n\n"
    "Text: {text}"
)


_SCHEDULE_WARNING_TEMPLATE = (
    "You are a Singapore travel planner. A tourist's itinerary has a scheduling issue.\n"
    "Issue type: {issue_type}\n"
    "Schedule summary (day number → total occupied minutes): {days_summary}\n\n"
    "Write a single, friendly, specific warning sentence in English. "
    "Mention the affected day numbers. No bullet points. Under 80 words."
)


async def generate_schedule_warning(days_summary: list[dict], issue_type: str) -> str:
    """Generate a concise natural-language schedule warning via Gemini.

    days_summary: list of {"day": int, "occupied_minutes": int}
    issue_type: "overfull" | "underfull"
    Enforces the 4-second rate-limit guard shared with parse_places_input.
    Returns the warning string, or a plain fallback string on any error.
    """
    await _rate_limit()

    summary_str = ", ".join(f"Day {d['day']}: {d['occupied_minutes']} min" for d in days_summary)
    prompt = _SCHEDULE_WARNING_TEMPLATE.format(issue_type=issue_type, days_summary=summary_str)

    try:
        response = await _client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return (response.text or "").strip() or _fallback_warning(issue_type, days_summary)
    except Exception:
        return _fallback_warning(issue_type, days_summary)


def _fallback_warning(issue_type: str, days_summary: list[dict]) -> str:
    if issue_type == "overfull":
        overfull_days = [d["day"] for d in days_summary if d["occupied_minutes"] > 510]
        days_str = ", ".join(f"Day {d}" for d in overfull_days) if overfull_days else "some days"
        return (
            f"Your schedule may be too packed — {days_str} exceeds the 17:00 end time. "
            "Consider removing a place or spreading across more days."
        )
    underfull_days = [d["day"] for d in days_summary if d["occupied_minutes"] < 240]
    days_str = ", ".join(f"Day {d}" for d in underfull_days) if underfull_days else "some days"
    return (
        f"You have free time left — {days_str} has fewer than 4 hours of activities. "
        "Consider adding more places to fill your day."
    )


async def parse_places_input(raw_text: str) -> list[str]:
    """Parse natural language place input into a list of place name strings.

    Enforces a 4-second minimum interval between calls (≤ 15 RPM).
    The lock serialises concurrent callers so the rate limit holds even under load.
    Raises ValueError if Gemini returns non-JSON output.
    """
    await _rate_limit()

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
