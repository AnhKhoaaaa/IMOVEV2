"""Chat Agent — LLM tour-guide assistant with two-step write flow.

Drives the Gemini function-calling loop IN-PROCESS (automatic function calling is
disabled in services/gemini.generate_chat). Read tools execute immediately and feed
their result back to the model; write tools NEVER mutate — they build a *pending
action* that the user must confirm via POST /chat/confirm.

State is in-memory, keyed by session_id (like trips._pending_swaps) — lost on restart.
"""
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from google.genai import types

from app.services import gemini
from app.models.chat import (
    ChatResponse, ProposedAction, Gps,
    TextBlock, PlaceCardBlock, RouteOption, RouteCompareBlock, BusService, BusArrivalsBlock,
)

log = logging.getLogger(__name__)

# session_id -> Gemini contents (list[types.Content])
_chat_history: dict[str, list] = {}
# session_id -> {id, tool, args, trip_id, preview}
_pending_actions: dict[str, dict] = {}
# session_id -> {trip_id, ...} — persists resolved context across requests
_chat_ctx: dict[str, dict] = {}

_MAX_TURNS = 4

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
    "ANY change to the itinerary MUST go through the matching write tool as a PROPOSAL — "
    "never claim a change is done, because writes require the user to confirm. "
    "Weather and alerts are read-only. "
    "PRESENTATION — after you recommend one or more curated places, call show_places with their "
    "ids so the app shows photo cards; keep your own text short and conversational (the cards "
    "carry the details). Separate distinct ideas into their own paragraphs (blank line between "
    "them) so they render as separate blocks."
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
            description="Propose changing the transport mode of one leg (planning mode-switch).",
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


async def run_chat(
    session_id: str,
    message: str,
    trip_id: Optional[str] = None,
    gps: Optional[Gps] = None,
    current_user: Optional[str] = None,
) -> ChatResponse:
    history = _chat_history.setdefault(session_id, [])
    history.append(types.Content(role="user", parts=[types.Part(text=message)]))

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
            # so image_url / place_id are always real. Returns a small ack to the model.
            from app.agents.planning_agent import get_curated_place
            ids = [str(x) for x in (args.get("place_ids") or [])]
            shown = []
            for pid in ids:
                p = get_curated_place(pid)
                if p:
                    ctx["card_blocks"].append(PlaceCardBlock(
                        id=p["id"],
                        name=p["name"],
                        category=p.get("category"),
                        image_url=p.get("image_url"),
                        suggested_duration_minutes=p.get("suggested_duration_minutes"),
                    ))
                    shown.append(p["id"])
            return {"status": "displayed", "shown_place_ids": shown, "count": len(shown)}

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
                return {"error": "GPS coordinates are required for weather."}
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

    pending_id = str(uuid.uuid4())
    _pending_actions[ctx["session_id"]] = {
        "id": pending_id,
        "tool": tool,
        "args": final_args,
        "trip_id": trip_id,
        "preview": preview,
    }
    proposal = ProposedAction(tool=tool, preview=preview, args=final_args)
    return ("proposal", (proposal, pending_id, preview))
