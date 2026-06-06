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


_SCHEDULE_WARNING_TEMPLATE = (
    "You are a Singapore travel planner. A tourist's itinerary has a scheduling issue.\n"
    "Issue type: {issue_type}\n"
    "Schedule summary: {days_summary}\n\n"
    "Write a single, friendly suggestion in English. "
    "If overfull: suggest adding more days or removing some places. "
    "If underfull: suggest adding more places to fill the trip. "
    "Do NOT mention specific day numbers or minute counts. No bullet points. Under 60 words."
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
        return (
            "Your schedule looks too packed. Consider spreading activities across more days "
            "or removing a place to make your trip more comfortable."
        )
    return (
        "You have free time in your schedule. Consider adding more places to fill your days."
    )


_GAP_NOTIFICATION_TEMPLATE = (
    "You are a Singapore travel guide. A tourist has a long commute between two attractions.\n"
    "For each transit segment below, write 1-2 sentences in English informing the tourist they will be "
    "traveling by the given transport mode for that duration. Give one brief practical tip for the journey "
    "(e.g., grab a snack at the station, enjoy the skyline view from the MRT). Be concise and practical.\n"
    "Return ONLY a JSON array of strings (one per segment, same order). No explanation, no code block.\n\n"
    "Segments:\n{gaps_text}"
)


async def generate_gap_notifications(gap_events: list[dict]) -> list[str]:
    """Batch-generate transit-informed messages via Gemini.

    gap_events: list of {gap_minutes, place_before, place_after, gap_start, gap_end, transport_mode}
    Returns list of message strings same length as gap_events.
    Falls back to template strings on any failure.
    """
    if not gap_events:
        return []

    await _rate_limit()

    gaps_text = "\n".join(
        f"{i + 1}. {e['gap_minutes']} min by {e.get('transport_mode', 'transit')} "
        f"from {e['place_before']} ({e['gap_start']}) to {e['place_after']} ({e['gap_end']})"
        for i, e in enumerate(gap_events)
    )
    prompt = _GAP_NOTIFICATION_TEMPLATE.format(gaps_text=gaps_text)

    try:
        response = await _client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        text = (response.text or "").strip()
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
        messages = json.loads(text)
        if isinstance(messages, list) and len(messages) == len(gap_events):
            return [str(m) for m in messages]
    except Exception:
        pass

    return [
        f"You'll travel about {e['gap_minutes']} min by {e.get('transport_mode', 'transit').lower()} "
        f"from {e['place_before']} to {e['place_after']}."
        for e in gap_events
    ]


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
