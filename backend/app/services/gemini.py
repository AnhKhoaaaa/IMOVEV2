import asyncio
import json
import os
import re
import time

from google import genai
from google.genai import types
from app.config import settings


def _make_client() -> genai.Client:
    """Build the Gemini client per settings.

    Vertex mode (google_genai_use_vertexai=True): authenticate via service account
    (GOOGLE_APPLICATION_CREDENTIALS) — no api key needed. Otherwise use the api key.
    Raises RuntimeError if neither path is configured.
    """
    if settings.google_genai_use_vertexai:
        # Push credentials path to os.environ so GCP SDK's ADC picks it up.
        # pydantic_settings loads .env into the Settings object but does NOT
        # export variables to os.environ, so we do it explicitly here.
        if settings.google_application_credentials:
            os.environ.setdefault(
                "GOOGLE_APPLICATION_CREDENTIALS",
                settings.google_application_credentials,
            )
        return genai.Client(
            vertexai=True,
            project=settings.google_cloud_project,
            location=settings.google_cloud_location,
        )
    if not settings.gemini_api_key:
        raise RuntimeError(
            "Gemini not configured: set GEMINI_API_KEY, or enable "
            "GOOGLE_GENAI_USE_VERTEXAI=true with a service account."
        )
    return genai.Client(api_key=settings.gemini_api_key)


_client = _make_client()

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


_ALERT_PHRASE_TEMPLATE = (
    "You are IMOVE, a warm Singapore travel companion chatting with a tourist in their app.\n"
    "A live trip alert just fired. Rewrite it as ONE friendly heads-up message (max 2 sentences) "
    "in {lang_name}, the way a helpful friend would flag it. Keep every concrete fact from the "
    "alert (place, day, time, %); do NOT invent anything new and do NOT add greetings or sign-offs.\n\n"
    "Alert type: {alert_type}\n"
    "Day: {day}\n"
    "Original message: {message}"
)


async def phrase_alert(alert: dict, lang: str = "en") -> str:
    """[LLM] Rewrite a trip alert as a warm, friend-like chat message (dev25 P1).

    Rate-limited via the shared 15-RPM guard. Returns the alert's own `message` unchanged on
    any failure or empty output — never fabricates beyond the alert.
    """
    await _rate_limit()

    original = (alert.get("message") or "").strip()
    prompt = _ALERT_PHRASE_TEMPLATE.format(
        lang_name="Vietnamese" if lang == "vi" else "English",
        alert_type=alert.get("alert_type") or "alert",
        day=alert.get("day_number") if alert.get("day_number") is not None else "—",
        message=original,
    )
    try:
        response = await _client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return (response.text or "").strip() or original
    except Exception:
        return original


_EVENTS_GROUNDED_TEMPLATE = (
    "You are IMOVE's Singapore travel assistant. Using up-to-date web information, answer the "
    "tourist's question about CURRENT or seasonal happenings in Singapore — events, festivals, "
    "public holidays, what's on now, travel tips, or neighbourhood guides. "
    "Be concise (3-5 sentences), specific to Singapore, and practical. Reply in the same "
    "language as the question. If you mention an attraction, you may describe it, but do NOT "
    "claim it can be added to the user's itinerary. Today's date in Singapore: {today}.\n\n"
    "Question: {query}"
)


def _extract_citations(response) -> list[str]:
    """Best-effort pull of source URIs from grounding metadata (never raises)."""
    try:
        meta = response.candidates[0].grounding_metadata
        chunks = getattr(meta, "grounding_chunks", None) or []
        uris = []
        for c in chunks:
            web = getattr(c, "web", None)
            uri = getattr(web, "uri", None) if web else None
            if uri:
                uris.append(uri)
        return uris
    except Exception:
        return []


async def search_events_grounded(query: str, today: str | None = None) -> dict:
    """[LLM] Isolated, google_search-grounded answer about current SG events / tips.

    Hard guardrail: this call attaches ONLY the google_search tool and NO function
    declarations, so web text injected into the result can never trigger an app action
    (no tool conflict, no prompt-injection → action path). Rate-limited in api-key mode
    (Vertex has higher quota). Returns {"text": str, "citations": list[str]}; on any
    failure or empty output returns an empty typed result — never fabricates.
    """
    if not settings.google_genai_use_vertexai:
        await _rate_limit()

    prompt = _EVENTS_GROUNDED_TEMPLATE.format(today=today or "unknown", query=query)
    try:
        config = types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
        )
        response = await _client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=config,
        )
        text = (response.text or "").strip()
        if not text:
            return {"text": "", "citations": []}
        return {"text": text, "citations": _extract_citations(response)}
    except Exception:
        return {"text": "", "citations": []}


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


async def generate_chat(
    contents: list,
    tools: list | None = None,
    system_instruction: str | None = None,
    model: str | None = None,
):
    """[LLM] One turn of the chatbot's tool-calling loop.

    Automatic function calling is DISABLED so the caller (chat_agent) drives the
    tool loop in-process. Returns the raw GenerateContentResponse.

    Rate-limit: the shared 15-RPM guard applies ONLY in api_key mode. Vertex has
    much higher quotas, so the guard is skipped when google_genai_use_vertexai=True.
    """
    if not settings.google_genai_use_vertexai:
        await _rate_limit()

    config = types.GenerateContentConfig(
        tools=tools or None,
        system_instruction=system_instruction,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    return await _client.aio.models.generate_content(
        model=model or settings.chat_model,
        contents=contents,
        config=config,
    )
