"""Chat Agent — LLM tour-guide assistant with two-step write flow.

Drives the Gemini function-calling loop IN-PROCESS (automatic function calling is
disabled in services/gemini.generate_chat). Read tools execute immediately and feed
their result back to the model; write tools NEVER mutate — they build a *pending
action* that the user must confirm via POST /chat/confirm.

State is in-memory, keyed by session_id (like trips._pending_swaps) — lost on restart.
"""
import logging
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from google.genai import types

from app.services import gemini
from app.models.chat import (
    ChatResponse, ProactiveMessage, ProposedAction, Gps,
    TextBlock, PlaceCardBlock, RouteOption, RouteCompareBlock, BusService, BusArrivalsBlock,
)

log = logging.getLogger(__name__)

# session_id -> Gemini contents (list[types.Content])
_chat_history: dict[str, list] = {}
# session_id -> {id, tool, args, trip_id, preview}
_pending_actions: dict[str, dict] = {}
# session_id -> {trip_id, ...} — persists resolved context across requests
_chat_ctx: dict[str, dict] = {}
# session_id -> monotonic expiry — dev25 P5 live-companion dedupe (shares the weather_live window)
_companion_seen: dict[str, float] = {}
# session_id -> monotonic last-activity timestamp — dev30 idle-session GC
_session_seen: dict[str, float] = {}

_MAX_TURNS = 4

# dev30 — bound the in-memory chat state so a long-lived session can't leak memory or keep
# inflating the token cost (the whole history is re-sent to Gemini every turn). History is
# trimmed to the last _MAX_USER_TURNS genuine user turns (keeping each round's function-call /
# response pairing intact); idle sessions and stale unconfirmed proposals are garbage-collected.
_MAX_HISTORY = 60          # hard cap on stored Content entries before trimming kicks in
_MAX_USER_TURNS = 12       # how many recent user messages of context to retain
_SESSION_TTL_S = 2 * 3600  # drop a session's history/ctx after this much idle time
_PENDING_TTL_S = 30 * 60   # drop an unconfirmed proposal after this long

_SGT = timezone(timedelta(hours=8))

READ_TOOLS = {
    "get_current_trip", "list_my_trips", "search_places", "get_curated_places",
    "compare_routes", "get_bus_arrivals", "get_trip_alerts", "get_weather",
    "show_places", "get_current_events",
}
WRITE_TOOLS = {
    "add_place", "remove_place", "reorder_places", "change_leg_mode",
    "switch_leg_now", "add_day", "remove_day", "optimize_trip",
}

_TRANSPORT_MODES = ["BUS", "METRO", "CYCLE", "WALK", "GRAB"]

SYSTEM_PROMPT = (
    "You are the in-app Singapore tour-guide assistant for IMOVE, a public-transit "
    "trip planner for tourists. Detect the language of the user's LATEST message and "
    "reply in that exact language (Vietnamese or English). "
    "Only recommend places that exist in the curated dataset — never invent a place or "
    "a place_id; use search_places / get_curated_places to look them up. "
    "IMPORTANT — Trip resolution rule: if the user mentions a trip by name (e.g. 'my trip "
    "called X', 'chuyến X'), you MUST call list_my_trips with name_filter=<that name> "
    "BEFORE calling get_current_trip or any write tool. Do NOT call get_current_trip first "
    "without resolving the trip. If list_my_trips returns exactly one result it becomes the "
    "active trip automatically. If multiple match, ask the user to pick one. "
    "To inspect the user's itinerary, call get_current_trip (it returns leg ids and place "
    "ids you must reference in write tools). "
    "ADVICE vs EDIT — requests to suggest, plan or advise (e.g. 'plan a 3-day trip', 'what "
    "should I do for 3 days', 'recommend places', 'tư vấn chuyến 3 ngày') are READ-ONLY: answer "
    "with curated place suggestions (search_places / get_curated_places + show_places). Do NOT "
    "call any write tool for these, and do NOT require an open trip to give advice. Only use a "
    "write tool (add_place, add_day, reorder_places, optimize_trip, …) when the user EXPLICITLY "
    "asks to modify an itinerary that is currently OPEN. Any such change MUST go through the "
    "matching write tool as a PROPOSAL — never claim a change is done, because writes require "
    "the user to confirm. "
    "Weather and alerts are read-only. For 'weather here / near me', call get_weather WITHOUT "
    "lat/lng — the app fills in the user's live GPS when available. "
    "LIVE RE-ROUTE vs MODE-SWITCH — when the user says they are LOST or stranded, missed/"
    "got off at the wrong stop, took a wrong turn, or wants directions FROM WHERE THEY ARE NOW "
    "(e.g. 'I'm lost', 'tôi bị lạc', 'I missed my stop', 'get me back on track', 'reroute me from "
    "here'), you MUST use switch_leg_now — NOT change_leg_mode. switch_leg_now re-routes from the "
    "user's CURRENT GPS position to the destination of the affected leg, so the new route starts "
    "where the user actually is. change_leg_mode only swaps the transport mode while keeping the "
    "leg's original A→B start point, which is WRONG once the user has left A; use it only for "
    "planning-time mode changes, not for a lost/stranded user. Call get_current_trip to find which "
    "leg the user is on (the one whose destination they are still heading to), then propose "
    "switch_leg_now for that leg id. If the current leg is genuinely ambiguous, ask which place "
    "they are heading to next and map it to that leg — never fall back to change_leg_mode. "
    "PRESENTATION — whenever you recommend one or more curated places (especially if the user "
    "asks for photos/images), you MUST call show_places to display photo cards; do not just list "
    "them in text. Pass the dataset IDS — the exact `id` field from search_places / "
    "get_curated_places (e.g. 'merlion-park'), NOT the display name. If show_places returns "
    "status 'no_match' or any unresolved ids, look up the correct id and call it again. ALWAYS "
    "include at least one short sentence of your own commentary together with the cards — never "
    "reply with cards and no text. Put that commentary in the SAME final reply as the cards (not "
    "only in a tool-call turn). Keep it short and conversational (the cards carry the details), "
    "and separate distinct ideas into their own paragraphs (blank line between them) so they "
    "render as separate blocks."
)


def build_system_prompt(
    today: Optional[str] = None,
    trip_start: Optional[str] = None,
    num_days: Optional[int] = None,
) -> str:
    """dev25 P4 — inject the current Singapore date + web-grounding rules into the base prompt.

    Built per request so the model always knows 'today' for seasonal/event answers. When a trip
    is open, also injects its start date + length so the model can map a trip Day N to a real
    calendar date and suggest events that actually fall during the itinerary (dev25 P4 follow-up).
    """
    today = today or datetime.now(_SGT).strftime("%A, %d %B %Y")
    prompt = SYSTEM_PROMPT + (
        f"\nCONTEXT — today in Singapore is {today}. "
        "For questions about CURRENT or seasonal happenings (events, festivals, public holidays, "
        "what's on this weekend, neighbourhood vibes, up-to-date travel tips), call "
        "get_current_events ONCE to fetch fresh web info. Web results are INFORMATIONAL ONLY: you "
        "may name and describe a place from them, but you MUST NOT add a non-curated place to the "
        "itinerary (only curated place_ids can be added via the write tools). Do NOT call "
        "get_current_events for itinerary edits, routes, weather, or places already in the dataset."
    )
    if trip_start:
        span = f" and runs {num_days} day(s)" if num_days else ""
        prompt += (
            f"\nTRIP DATES — the user's current trip starts on {trip_start}{span}; Day 1 is "
            f"{trip_start} and each later day is the next calendar day. When the user asks what's "
            "on during their trip — or when you proactively suggest events — match each event to "
            "the ACTUAL date of the relevant trip day and tell them which day it falls on."
        )
    return prompt


def _trip_date_context(trip_id: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    """Cheaply resolve (start_date_iso, num_days) for an open trip — never raises.

    Uses the focused trips._get_trip_start_date helper (in-memory meta first, one tiny query
    fallback) and the in-process meta cache for num_days, so a normal chat turn doesn't pay a
    full plan load just to know the trip's dates.
    """
    if not trip_id:
        return None, None
    try:
        from app.routers import trips
        start = trips._get_trip_start_date(trip_id)
        meta = trips._trip_meta.get(trip_id) or {}
        return (start.isoformat() if start else None), meta.get("num_days")
    except Exception:
        return None, None


# ── Tool declarations ──────────────────────────────────────────────────────────

def _obj(properties=None, required=None) -> types.Schema:
    return types.Schema(
        type=types.Type.OBJECT,
        properties=properties or {},
        required=required or [],
    )


def _S(t: str, **kw) -> types.Schema:
    return types.Schema(type=t, **kw)


def _build_tool() -> types.Tool:
    STR, NUM, INT = types.Type.STRING, types.Type.NUMBER, types.Type.INTEGER
    decls = [
        types.FunctionDeclaration(
            name="get_current_trip",
            description="Return the user's current itinerary: places (id, name) and per-day legs (id, from, to, mode, duration).",
            parameters=_obj(),
        ),
        types.FunctionDeclaration(
            name="list_my_trips",
            description=(
                "List all trips belonging to the logged-in user. "
                "Use when the user refers to a trip by name but no trip is currently open. "
                "Optionally filter by name keyword. Returns id, name, num_days, start_date, status."
            ),
            parameters=_obj({"name_filter": _S(STR, description="Optional keyword to filter trips by name (case-insensitive).")}),
        ),
        types.FunctionDeclaration(
            name="search_places",
            description="Search the curated Singapore dataset by name/category/keyword. Returns id, name, category.",
            parameters=_obj({"query": _S(STR)}, ["query"]),
        ),
        types.FunctionDeclaration(
            name="get_curated_places",
            description="List all curated Singapore places (id, name, category). Use for broad suggestions.",
            parameters=_obj(),
        ),
        types.FunctionDeclaration(
            name="compare_routes",
            description="Compare public-transit, walking and cycling routes between two coordinates.",
            parameters=_obj(
                {"from_lat": _S(NUM), "from_lng": _S(NUM), "to_lat": _S(NUM), "to_lng": _S(NUM)},
                ["from_lat", "from_lng", "to_lat", "to_lng"],
            ),
        ),
        types.FunctionDeclaration(
            name="get_bus_arrivals",
            description="Real-time next-bus arrivals for an LTA bus stop code.",
            parameters=_obj({"stop_code": _S(STR)}, ["stop_code"]),
        ),
        types.FunctionDeclaration(
            name="get_trip_alerts",
            description="Read active transit/weather alerts already recorded for the current trip (read-only).",
            parameters=_obj(),
        ),
        types.FunctionDeclaration(
            name="get_weather",
            description="Current weather at a coordinate (condition, temp_c, rain_1h).",
            parameters=_obj({"lat": _S(NUM), "lng": _S(NUM)}, ["lat", "lng"]),
        ),
        types.FunctionDeclaration(
            name="show_places",
            description=(
                "Display rich place cards (photo + name + category + suggested duration) for the "
                "curated places you are recommending. Call this AFTER mentioning places, passing "
                "their curated ids (from search_places / get_curated_places). The app renders the "
                "cards from the dataset — do not describe images yourself."
            ),
            parameters=_obj(
                {"place_ids": _S(types.Type.ARRAY, items=_S(STR))},
                ["place_ids"],
            ),
        ),
        types.FunctionDeclaration(
            name="get_current_events",
            description=(
                "Fetch UP-TO-DATE info from the web about current/seasonal happenings in "
                "Singapore: events, festivals, public holidays, what's on now, travel tips, "
                "neighbourhood guides. Call at most ONCE per message, and only for time/season/"
                "event/neighbourhood questions. Returns an informational summary — never use it "
                "to add itinerary stops (only curated places can be added)."
            ),
            parameters=_obj({
                "query": _S(STR, description="What to look up, e.g. 'festivals this weekend', 'things to do in Kampong Glam'."),
                "month": _S(STR, description="Optional month/season hint, e.g. 'June 2026'."),
            }),
        ),
        # ── write (proposal only) ──
        types.FunctionDeclaration(
            name="add_place",
            description="Propose adding a curated place to a specific day of the trip.",
            parameters=_obj({"place_id": _S(STR), "day": _S(INT)}, ["place_id", "day"]),
        ),
        types.FunctionDeclaration(
            name="remove_place",
            description="Propose removing a place from the trip.",
            parameters=_obj({"place_id": _S(STR)}, ["place_id"]),
        ),
        types.FunctionDeclaration(
            name="reorder_places",
            description="Propose a new visiting order for the places of one day.",
            parameters=_obj(
                {"day": _S(INT), "place_ids": _S(types.Type.ARRAY, items=_S(STR))},
                ["day", "place_ids"],
            ),
        ),
        types.FunctionDeclaration(
            name="change_leg_mode",
            description=(
                "Propose changing the transport mode of one leg while keeping its original "
                "A→B start point (planning-time mode-switch). Do NOT use this when the user is "
                "lost or stranded and needs routing from their CURRENT location — use "
                "switch_leg_now for that."
            ),
            parameters=_obj(
                {"leg_id": _S(STR), "transport_mode": _S(STR, enum=_TRANSPORT_MODES)},
                ["leg_id", "transport_mode"],
            ),
        ),
        types.FunctionDeclaration(
            name="switch_leg_now",
            description="Propose a live re-route of one leg from the user's CURRENT GPS position (for 'I'm lost'). Requires GPS.",
            parameters=_obj(
                {"leg_id": _S(STR), "new_mode": _S(STR, enum=_TRANSPORT_MODES)},
                ["leg_id", "new_mode"],
            ),
        ),
        types.FunctionDeclaration(
            name="add_day",
            description="Propose adding one more day to the trip.",
            parameters=_obj(),
        ),
        types.FunctionDeclaration(
            name="remove_day",
            description="Propose removing a day from the trip.",
            parameters=_obj({"day": _S(INT)}, ["day"]),
        ),
        types.FunctionDeclaration(
            name="optimize_trip",
            description="Propose re-optimizing the whole itinerary order.",
            parameters=_obj(),
        ),
    ]
    return types.Tool(function_declarations=decls)


_TOOLS = _build_tool()


# ── public API ──────────────────────────────────────────────────────────────────

def reset() -> None:
    """Clear all in-memory chat state (used by tests)."""
    _chat_history.clear()
    _pending_actions.clear()
    _chat_ctx.clear()
    _companion_seen.clear()
    _session_seen.clear()


def _trim_history(history: list) -> None:
    """Cap stored history in place so a long session can't grow unbounded (dev30 #12).

    Trims to start at the oldest of the last _MAX_USER_TURNS *genuine* user messages (a Content
    with a text part — not a function_response wrapper), so the kept slice always begins a clean
    round and every function-call keeps its paired response. No-op until the hard cap is hit.
    """
    if len(history) <= _MAX_HISTORY:
        return
    starts = [
        i for i, c in enumerate(history)
        if getattr(c, "role", None) == "user"
        and any(getattr(p, "text", None) for p in (getattr(c, "parts", None) or []))
    ]
    if len(starts) > _MAX_USER_TURNS:
        del history[: starts[-_MAX_USER_TURNS]]


def _gc_sessions(now: float) -> None:
    """Drop idle sessions and expired proposals (dev30 #11/#12) — cheap, runs each turn."""
    for s, ts in list(_session_seen.items()):
        if now - ts > _SESSION_TTL_S:
            _chat_history.pop(s, None)
            _chat_ctx.pop(s, None)
            _companion_seen.pop(s, None)
            _session_seen.pop(s, None)
    for s, p in list(_pending_actions.items()):
        if now - p.get("created_at", now) > _PENDING_TTL_S:
            _pending_actions.pop(s, None)


async def run_chat(
    session_id: str,
    message: str,
    trip_id: Optional[str] = None,
    gps: Optional[Gps] = None,
    current_user: Optional[str] = None,
) -> ChatResponse:
    now = time.monotonic()
    _session_seen[session_id] = now
    _gc_sessions(now)

    history = _chat_history.setdefault(session_id, [])
    history.append(types.Content(role="user", parts=[types.Part(text=message)]))
    _trim_history(history)

    # Use trip_id from this request; fall back to one resolved in a previous turn
    session_ctx = _chat_ctx.setdefault(session_id, {})
    resolved_trip_id = trip_id or session_ctx.get("trip_id")

    ctx = {
        "session_id": session_id,
        "trip_id": resolved_trip_id,
        "gps": gps,
        "current_user": current_user,
        # dev25 P3 — data-card blocks captured across the turn (place cards / route / bus),
        # built backend-side from tools so images & ids are always real.
        "card_blocks": [],
        # dev25 P4 — at most ONE web-grounded events lookup per message (hard cap).
        "events_call_used": False,
    }

    trip_start, trip_days = _trip_date_context(resolved_trip_id)
    system_prompt = build_system_prompt(trip_start=trip_start, num_days=trip_days)

    for _ in range(_MAX_TURNS):
        try:
            response = await gemini.generate_chat(
                contents=history,
                tools=[_TOOLS],
                system_instruction=system_prompt,
            )
        except Exception as exc:  # network/LLM failure — never crash the request
            log.warning("generate_chat failed: %s", exc)
            return ChatResponse(reply=_FALLBACK)

        model_content, text, fcs = _extract(response)
        if model_content is not None:
            history.append(model_content)

        if not fcs:
            if ctx.get("trip_id"):
                session_ctx["trip_id"] = ctx["trip_id"]
            return ChatResponse(
                reply=text or _FALLBACK,
                blocks=_assemble_blocks(text, ctx["card_blocks"]),
            )

        response_parts = []
        proposal_stop = None
        for fc in fcs:
            name = fc.name
            args = dict(fc.args or {})
            if name in WRITE_TOOLS:
                kind, payload = await _build_pending_action(name, args, ctx)
                if kind == "proposal":
                    response_parts.append(types.Part.from_function_response(
                        name=name, response={"status": "proposed_awaiting_confirmation"}))
                    proposal_stop = payload  # (ProposedAction, pending_id, preview)
                else:  # tool-error — feed back so the model can apologise/clarify
                    response_parts.append(types.Part.from_function_response(
                        name=name, response={"error": payload}))
            else:
                data = await _execute_read_tool(name, args, ctx)
                response_parts.append(types.Part.from_function_response(
                    name=name, response={"result": data}))

        history.append(types.Content(role="user", parts=response_parts))

        if proposal_stop is not None:
            proposal, pending_id, preview = proposal_stop
            # Persist any trip_id resolved in this turn (e.g. by list_my_trips)
            if ctx.get("trip_id"):
                session_ctx["trip_id"] = ctx["trip_id"]
            return ChatResponse(reply=preview, proposed_action=proposal, pending_action_id=pending_id)

        # Persist resolved trip_id after each turn so the next message can use it
        if ctx.get("trip_id"):
            session_ctx["trip_id"] = ctx["trip_id"]

    # Hit the turn cap without a final text or proposal — polite fallback, no mutation.
    return ChatResponse(reply=_FALLBACK)


_FALLBACK = (
    "Sorry, I couldn't complete that just now. Could you rephrase or try again? "
    "(Xin lỗi, tôi chưa xử lý được — bạn thử diễn đạt lại giúp nhé.)"
)


# ── live GPS companion (dev25 P5) ─────────────────────────────────────────────────

# ── DEMO-ONLY hook (DEMO_FORCE_RAIN) ⚠️ ─────────────────────────────────────────────
# FOR OTHER AGENTS / FUTURE EDITORS: the next two definitions exist ONLY to record the
# Phase-5 companion demo video. They are NOT product logic.
#   • Do NOT call _companion_weather / _DEMO_RAIN from anywhere except companion_check.
#   • Do NOT build features on settings.demo_force_rain, and never enable it in production.
#   • To fully revert the demo capability: delete these two defs, the `demo_force_rain` setting
#     in config.py, and the `.env.example` entry — companion_check then uses OpenWeather only.
# When the flag is OFF (the default) this is a transparent pass-through to OpenWeather, so the
# real companion path is byte-for-byte unchanged.
_DEMO_RAIN = {"condition": "Rain", "temp_c": 27.0, "rain_1h": 2.4}


async def _companion_weather(gps: Gps) -> dict:
    """Weather source for companion_check: real OpenWeather, except the isolated demo override."""
    from app.config import settings
    if settings.demo_force_rain:                       # DEMO-ONLY — see warning block above
        log.warning("DEMO_FORCE_RAIN is ON — companion is using FAKE rain, not real weather.")
        return dict(_DEMO_RAIN)
    from app.services import openweather
    return await openweather.get_current_weather(gps.lat, gps.lng)


async def companion_check(
    session_id: str,
    trip_id: str,
    gps: Optional[Gps],
    current_user: Optional[str] = None,
    lang: str = "en",
) -> Optional[ProactiveMessage]:
    """Live, GPS-anchored rain nudge for the chat companion (dev25 P5).

    Unlike the scheduler's centroid-based `weather_live` alert, this checks the weather at the
    user's REAL coordinates and names the nearest upcoming outdoor stop. Fully rule-based — it
    only calls the LLM (`phrase_alert`) when a nudge actually fires. Returns None far more often
    than not (dry / no outdoor stop / weather unavailable / deduped) so the client stays quiet.
    Never fabricates. The user acts by replying in chat (→ switch_leg_now / compare_routes).
    """
    if gps is None:
        return None

    # Dedupe repeated polls: after a nudge fires, stay quiet for the shared weather_live window
    # so the companion doesn't ping every few minutes about the same shower.
    now = time.monotonic()
    _session_seen[session_id] = now  # dev30 — keep an active companion session out of idle GC
    exp = _companion_seen.get(session_id)
    if exp and exp > now:
        return None

    # Deduplicate: skip GPS nudge if there is already an active weather alert for this trip
    from app.database import supabase
    if supabase and trip_id:
        try:
            active_alerts = (
                supabase.table("lta_alerts")
                .select("id")
                .eq("trip_id", trip_id)
                .in_("alert_type", ["weather_warning", "weather_live"])
                .is_("resolved_at", "null")
                .execute()
            )
            if active_alerts.data:
                return None
        except Exception as exc:
            log.warning("Failed to check active weather alerts for deduplication: %s", exc)

    plan = await _load_plan({"trip_id": trip_id, "current_user": current_user})
    if plan is None:
        return None

    outdoor = [p for p in plan.places if getattr(p, "is_outdoor", False) and p.id != "hotel"]
    if not outdoor:
        return None

    try:
        current = await _companion_weather(gps)  # real OpenWeather (or demo override; see helper)
    except Exception:
        return None  # weather down → say nothing (never fabricate)

    rain_mm = float(current.get("rain_1h", 0.0) or 0.0)
    if not (rain_mm > 0 or current.get("condition") == "Rain"):
        return None

    # Nearest outdoor stop to the USER (GPS-anchored — the whole point of P5).
    from app.agents.planning_agent import _haversine_km
    nxt = min(outdoor, key=lambda p: _haversine_km(gps.lat, gps.lng, p.lat, p.lng))

    # Optional nearby indoor alternative (reuse the adaptation helper; tolerate failure).
    from app.agents.adaptation_agent import _nearest_indoor
    try:
        alt = _nearest_indoor(nxt.lat, nxt.lng, exclude_ids={p.id for p in plan.places})
    except Exception:
        alt = None
    swap = f", swap to {alt['name']}," if alt and alt.get("name") else ""

    rate = f"{rain_mm:.1f}mm/h" if rain_mm > 0 else "rain"
    base = (
        f"It's raining near you right now ({rate}). Your nearest outdoor stop is {nxt.name} — "
        f"want to shelter{swap} or find a covered route?"
    )

    # Warm-phrase via the existing alert phraser (template fallback baked in — never fabricates).
    text = await gemini.phrase_alert(
        {"alert_type": "weather_live", "message": base, "day_number": None}, lang
    )

    from app.config import settings
    _companion_seen[session_id] = now + getattr(settings, "weather_live_dedup_min", 10) * 60
    return ProactiveMessage(text=text or base, alert_type="weather_live")


# ── rich blocks (dev25 P3) ────────────────────────────────────────────────────────

def _text_blocks(text: str) -> list:
    """Split the model's final prose into one TextBlock per paragraph (blank-line separated)."""
    if not text:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    return [TextBlock(markdown=p) for p in paras]


def _assemble_blocks(text: str, card_blocks: list):
    """Final answer = text paragraphs followed by captured data cards (in call order).

    Returns None when there's nothing structured (plain answer / fallback) so the client
    falls back to `reply`.
    """
    blocks = _text_blocks(text) + list(card_blocks)
    return blocks or None


def _route_compare_block(result: dict) -> Optional[RouteCompareBlock]:
    if not isinstance(result, dict):
        return None
    label = {"pt": "TRANSIT", "walk": "WALK", "cycle": "CYCLE"}
    options = []
    for key, mode in label.items():
        m = result.get(key)
        if isinstance(m, dict) and m.get("available"):
            options.append(RouteOption(
                mode=mode,
                duration_minutes=m.get("duration_minutes"),
                fare_sgd=m.get("fare_sgd"),
            ))
    return RouteCompareBlock(options=options) if options else None


def _bus_arrivals_block(stop_code: str, result) -> Optional[BusArrivalsBlock]:
    if not isinstance(result, list):
        return None
    services = [
        BusService(
            service_no=str(s.get("service_no")),
            eta_min=s.get("next_arrival_minutes"),
            load=s.get("load") or None,
        )
        for s in result if isinstance(s, dict) and s.get("service_no")
    ]
    return BusArrivalsBlock(stop_code=stop_code, services=services)


# ── helpers ──────────────────────────────────────────────────────────────────────

def _extract(response):
    """Return (model_content, joined_text, [function_calls])."""
    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return None, "", []
    content = candidates[0].content
    if content is None or not getattr(content, "parts", None):
        return content, "", []
    texts, fcs = [], []
    for part in content.parts:
        if getattr(part, "function_call", None):
            fcs.append(part.function_call)
        elif getattr(part, "text", None):
            texts.append(part.text)
    return content, "".join(texts), fcs


async def _load_plan(ctx):
    """Load the current TripPlan in-process via the trips handler (None on failure)."""
    if not ctx.get("trip_id"):
        return None
    from app.routers import trips
    try:
        return await trips.get_trip(ctx["trip_id"], ctx["current_user"])
    except Exception:
        return None


def _leg_exists(plan, leg_id) -> bool:
    return any(leg.id == leg_id for day in plan.days for leg in day.legs)


def _trip_summary(plan) -> dict:
    return {
        "id": plan.id,
        "places": [{"id": p.id, "name": p.name} for p in plan.places],
        "days": [
            {
                "day": d.day,
                "legs": [
                    {
                        "id": leg.id,
                        "from": leg.from_place_id,
                        "to": leg.to_place_id,
                        "mode": leg.transport_mode,
                        "duration_minutes": leg.duration_minutes,
                        "bus_stop_code": leg.first_bus_stop_code,
                    }
                    for leg in d.legs
                ],
            }
            for d in plan.days
        ],
    }


def _read_alerts(trip_id) -> object:
    from app.database import supabase
    if supabase is None or not trip_id:
        return []
    try:
        resp = (
            supabase.table("lta_alerts")
            .select("alert_type,message,affected_line,created_at")
            .eq("trip_id", trip_id)
            .is_("resolved_at", "null")
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )
        return resp.data or []
    except Exception as exc:
        return {"error": str(exc)}


def _resolve_curated(token: str) -> Optional[dict]:
    """Resolve a show_places token to a curated place — tolerant of LLM input (dev25 P3 fix).

    The model is told to pass dataset ids (e.g. 'merlion-park') but often passes the display
    name ('Merlion Park') or a near-id. Try, in order: exact id → exact name (case-insensitive)
    → unique case-insensitive substring of the name. Returns None when nothing resolves
    unambiguously (so the ack can honestly report it instead of silently showing nothing).
    """
    from app.agents.planning_agent import get_curated_place, get_all_places
    if not token:
        return None
    p = get_curated_place(token)
    if p:
        return p
    t = token.strip().lower()
    if not t:
        return None
    places = list(get_all_places().values())
    for pl in places:
        if (pl.get("name") or "").lower() == t:
            return pl
    matches = [pl for pl in places if t in (pl.get("name") or "").lower()]
    return matches[0] if len(matches) == 1 else None


async def _execute_read_tool(tool, args, ctx) -> object:
    try:
        if tool == "get_current_trip":
            plan = await _load_plan(ctx)
            return _trip_summary(plan) if plan else {"error": "No trip is currently open."}

        if tool == "list_my_trips":
            return await _list_user_trips(args.get("name_filter"), ctx)

        if tool == "search_places":
            from app.routers.places import _CURATED
            q = (args.get("query") or "").lower()
            hits = [
                p for p in _CURATED
                if q in p.name.lower()
                or q in p.category.lower()
                or any(q in kw.lower() for kw in (p.search_keywords or []))
            ]
            return [{"id": p.id, "name": p.name, "category": p.category} for p in hits[:20]]

        if tool == "get_curated_places":
            from app.agents.planning_agent import get_all_places
            return [
                {"id": p["id"], "name": p["name"], "category": p["category"]}
                for p in get_all_places().values()
            ]

        if tool == "show_places":
            # Presentation tool — build photo cards from the curated dataset (never the model),
            # so image_url / place_id are always real. Tolerant of names/near-ids via
            # _resolve_curated; the ack is HONEST (reports unresolved tokens + a 0-card status)
            # so the model retries with correct ids instead of falsely believing it sent images.
            tokens = [str(x) for x in (args.get("place_ids") or [])]
            shown, unresolved = [], []
            for token in tokens:
                p = _resolve_curated(token)
                if not p:
                    unresolved.append(token)
                    continue
                if p["id"] in shown:
                    continue
                ctx["card_blocks"].append(PlaceCardBlock(
                    id=p["id"],
                    name=p["name"],
                    category=p.get("category"),
                    image_url=p.get("image_url"),
                    suggested_duration_minutes=p.get("suggested_duration_minutes"),
                ))
                shown.append(p["id"])
            return {
                "status": "displayed" if shown else "no_match",
                "shown_place_ids": shown,
                "count": len(shown),
                "unresolved": unresolved,
            }

        if tool == "compare_routes":
            from app.services import onemap
            result = await onemap.get_all_routes(
                args["from_lat"], args["from_lng"], args["to_lat"], args["to_lng"]
            )
            block = _route_compare_block(result)
            if block:
                ctx["card_blocks"].append(block)
            return result

        if tool == "get_bus_arrivals":
            from app.services import lta
            stop_code = args["stop_code"]
            result = await lta.get_bus_arrival(stop_code)
            block = _bus_arrivals_block(stop_code, result)
            if block:
                ctx["card_blocks"].append(block)
            return result

        if tool == "get_trip_alerts":
            return _read_alerts(ctx.get("trip_id"))

        if tool == "get_weather":
            from app.services import openweather
            lat, lng = args.get("lat"), args.get("lng")
            if lat is None or lng is None:
                # dev30 #13 — "weather here" works: fall back to the user's live GPS (ctx) when
                # the model didn't supply coordinates (it isn't told the user's position).
                gps = ctx.get("gps")
                if gps is not None:
                    lat, lng = gps.lat, gps.lng
            if lat is None or lng is None:
                return {"error": "No location available — ask the user to share a place or enable GPS."}
            return await openweather.get_current_weather(lat, lng)

        if tool == "get_current_events":
            # Hard cap: one grounded web call per message (prevents quota burn / loops).
            if ctx.get("events_call_used"):
                return {"error": "A web lookup was already used for this message."}
            ctx["events_call_used"] = True
            q = (args.get("query") or "").strip() or "current events and festivals in Singapore"
            month = (args.get("month") or "").strip()
            full_q = f"{q} ({month})" if month else q
            today = datetime.now(_SGT).strftime("%Y-%m-%d")
            result = await gemini.search_events_grounded(full_q, today=today)
            text = (result or {}).get("text", "").strip()
            if not text:
                return {"error": "No up-to-date information is available right now."}
            return {"summary": text, "citations": result.get("citations", [])}
    except Exception as exc:
        return {"error": str(exc)}

    return {"error": f"Unknown read tool: {tool}"}


async def _list_user_trips(name_filter: Optional[str], ctx: dict) -> object:
    """Query trips for the current user, optionally filtered by name.

    If exactly one trip matches the filter, sets ctx["trip_id"] so subsequent
    write tools in the same turn can target it without the user navigating first.
    """
    current_user = ctx.get("current_user")
    if not current_user:
        return {"error": "You must be logged in to list your trips."}

    from app.database import supabase
    from app.routers.trips import _trip_meta

    rows = []

    if supabase:
        try:
            resp = (
                supabase.table("trips")
                .select("id, name, num_days, start_date, status, created_at")
                .eq("user_id", current_user)
                .order("created_at", desc=True)
                .limit(20)
                .execute()
            )
            rows = resp.data or []
        except Exception as exc:
            return {"error": str(exc)}
    else:
        # Offline fallback: scan in-memory meta cache
        rows = [
            {
                "id": tid,
                "name": meta.get("name"),
                "num_days": meta.get("num_days"),
                "start_date": None,
                "status": None,
                "created_at": None,
            }
            for tid, meta in _trip_meta.items()
            if meta.get("user_id") == current_user
        ]

    if name_filter:
        kw = name_filter.lower()
        rows = [r for r in rows if r.get("name") and kw in r["name"].lower()]

    # Auto-activate trip when the filter narrows it to exactly one
    if len(rows) == 1 and not ctx.get("trip_id"):
        ctx["trip_id"] = rows[0]["id"]

    return rows


async def _build_pending_action(tool, args, ctx):
    """Validate cheaply and build a pending write action.

    Returns ("proposal", (ProposedAction, pending_id, preview)) on success, or
    ("error", message) — the message is fed back to the model so it can respond nicely.
    Never mutates anything.
    """
    trip_id = ctx.get("trip_id")
    if not trip_id:
        return ("error", "No trip is open. Ask the user to open an itinerary before editing.")

    from app.agents.planning_agent import get_curated_place

    final_args: dict
    preview: str

    if tool == "add_place":
        pid = args.get("place_id")
        place = get_curated_place(pid) if pid else None
        if not place:
            return ("error", f"place_id '{pid}' is not in the curated dataset.")
        day = int(args.get("day", 1))
        final_args = {"place_id": pid, "day": day}
        preview = f"Add “{place['name']}” to day {day}"

    elif tool == "remove_place":
        pid = args.get("place_id")
        plan = await _load_plan(ctx)
        if plan is None:
            return ("error", "Could not load the current trip.")
        match = next((p for p in plan.places if p.id == pid), None)
        if match is None:
            return ("error", f"place_id '{pid}' is not in the current trip.")
        final_args = {"place_id": pid}
        preview = f"Remove “{match.name}” from the trip"

    elif tool == "reorder_places":
        day = int(args.get("day", 1))
        place_ids = [str(x) for x in (args.get("place_ids") or [])]
        if not place_ids:
            return ("error", "place_ids is empty.")
        # dev30 #14 — validate at proposal time (like add/remove/change_leg): the day must exist
        # and every place_id must actually belong to that day, so a bad reorder is caught here
        # with a clear message instead of failing generically at confirm.
        plan = await _load_plan(ctx)
        if plan is None:
            return ("error", "Could not load the current trip.")
        day_obj = next((d for d in plan.days if d.day == day), None)
        if day_obj is None:
            return ("error", f"day {day} is not in the current trip.")
        day_place_ids = {leg.from_place_id for leg in day_obj.legs} | {leg.to_place_id for leg in day_obj.legs}
        if day_place_ids:  # only enforce when the day has legs to derive membership from
            unknown = [pid for pid in place_ids if pid not in day_place_ids]
            if unknown:
                return ("error", f"these place_ids are not on day {day}: {', '.join(unknown)}")
        final_args = {"day": day, "place_ids": place_ids}
        preview = f"Reorder the places of day {day}"

    elif tool == "change_leg_mode":
        leg_id = args.get("leg_id")
        mode = args.get("transport_mode")
        plan = await _load_plan(ctx)
        if plan is None or not _leg_exists(plan, leg_id):
            return ("error", f"leg_id '{leg_id}' not found in the current trip.")
        if mode not in _TRANSPORT_MODES:
            return ("error", f"transport_mode '{mode}' is not valid.")
        final_args = {"leg_id": leg_id, "transport_mode": mode}
        preview = f"Change this leg to {mode}"

    elif tool == "switch_leg_now":
        gps: Optional[Gps] = ctx.get("gps")
        if gps is None:
            return ("error", "GPS location is required to re-route. Ask the user to enable location.")
        leg_id = args.get("leg_id")
        mode = args.get("new_mode")
        plan = await _load_plan(ctx)
        if plan is None or not _leg_exists(plan, leg_id):
            return ("error", f"leg_id '{leg_id}' not found in the current trip.")
        if mode not in _TRANSPORT_MODES:
            return ("error", f"new_mode '{mode}' is not valid.")
        final_args = {
            "leg_id": leg_id, "new_mode": mode,
            "current_lat": gps.lat, "current_lng": gps.lng,
        }
        preview = f"Re-route this leg to {mode} from your current location"

    elif tool == "add_day":
        final_args = {}
        preview = "Add one more day to the trip"

    elif tool == "remove_day":
        day = int(args.get("day", 0))
        plan = await _load_plan(ctx)
        if plan is None:
            return ("error", "Could not load the current trip.")
        if not any(d.day == day for d in plan.days):
            return ("error", f"day {day} is not in the current trip.")
        final_args = {"day": day}
        preview = f"Remove day {day} from the trip"

    elif tool == "optimize_trip":
        final_args = {}
        preview = "Re-optimize the whole itinerary order"

    else:
        return ("error", f"Unknown write tool: {tool}")

    # dev30 #15 — one pending per session: a new proposal replaces an unconfirmed older one,
    # which then becomes unconfirmable (409). The client only tracks one proposal too, so this
    # is consistent — log it so the silent drop is observable.
    superseded = _pending_actions.get(ctx["session_id"])
    if superseded:
        log.info("Replacing unconfirmed proposal for session %s: %s -> %s",
                 ctx["session_id"], superseded.get("tool"), tool)

    pending_id = str(uuid.uuid4())
    _pending_actions[ctx["session_id"]] = {
        "id": pending_id,
        "tool": tool,
        "args": final_args,
        "trip_id": trip_id,
        "preview": preview,
        "created_at": time.monotonic(),  # dev30 — for idle-proposal GC (_gc_sessions)
    }
    proposal = ProposedAction(tool=tool, preview=preview, args=final_args)
    return ("proposal", (proposal, pending_id, preview))
