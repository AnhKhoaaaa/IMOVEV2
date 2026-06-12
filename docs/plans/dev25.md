# dev25 — Chatbot as the hero feature: proactive companion + up-to-date assistant

> Multi-phase. Each phase is independently shippable, gated behind the same workflow
> (Explore → Plan → Code → Test → Commit). Phases land in order; later phases assume
> earlier ones merged. **Do not start coding until this plan is approved.**

## Vision

Turn the existing reactive chatbot into the app's hero surface, with two faces:
1. **Knowledgeable & up-to-date assistant** while planning (fresh events / tips / neighbourhoods).
2. **Proactive companion** while travelling — every notification (rain, transit delay,
   closing-risk) reaches the user as a *friendly chat message*, not a separate banner.

## Baseline (verified, read 2026-06-12)

- Chat = Gemini function-calling loop, in-process, `_MAX_TURNS=4`; 8 read + 8 write tools;
  propose→confirm write flow; VI/EN language detection (`agents/chat_agent.py`,
  `routers/chat.py`, `services/gemini.generate_chat`).
- Chat state in-memory keyed by `session_id` (`chat_agent.py:22-26`) — lost on restart.
- `ChatWidget` is a global FAB, **login-gated** (guests see a Lock, `ChatWidget.jsx:119-145`);
  request/response only (no server-initiated messages).
- Alerts: Adaptation Agent + APScheduler → Supabase `lta_alerts` → frontend `useAlerts`
  (Realtime WebSocket, `hooks/useAlerts.js`) → `AlertBanner` rendered on the Trip page
  (`Trip.jsx:890`, `:1607/1610/1625`).
- `AlertBanner` is rich & interactive (`components/adaptation/AlertBanner.jsx`):
  - weather rain → Preview→Accept-swap with delta pills (±SGD/±min/±m walk);
  - `closing_risk` → leave-earlier / skip / push-to-day with per-day capacity badges;
  - 👍/👎 feedback (feeds Memory Agent).
  - All actions go through `api.adaptTrip` (`/trips/{id}/adapt`) + `api.acceptSwap`
    (`/trips/{id}/accept-swap`).

## Locked decisions (from design discussion 2026-06-12)

| Topic | Decision |
|-------|----------|
| Freshness mechanism | Gemini **`google_search` grounding** in an **isolated, tool-less** sub-call; **max 1 call / user message** |
| Web search scope | events/festivals + travel tips + neighbourhood guides |
| Non-dataset places | may be **mentioned descriptively** (attributed); **never proposed as an itinerary stop** — itinerary stops stay curated-only (already enforced by `add_place` place_id validation) |
| Sources on UI | **Not shown** in chat (no source chips this round) |
| Rich answers | **In scope** — chat replies render as **multiple styled blocks** (markdown text + place cards w/ images + route-compare + bus-arrivals), **tool-driven/hybrid** so card data (esp. images) is always real (Phase 3) |
| Chat history persistence | **Out of scope** for dev25 (stays in-memory) |
| Notification model | **M2** — LLM-phrased proactive message + reuse Adaptation backend unchanged |
| Logged-in users | bot speaks first; **full interactive action card lives in chat**; **banner hidden** |
| Guests | **temporarily receive NO alerts** (no chat, no banner) |
| Banner code | **kept, not deleted** — unmounted behind a guard for easy re-enable later (see §Banner preservation) |

---

## ⚠️ Banner preservation (read first — explicit per request)

`components/adaptation/AlertBanner.jsx` and its tests
(`__tests__/adaptation/AlertBanner.test.jsx`) are **intentionally retained**. dev25 stops
*mounting* the banner for logged-in users and (temporarily) stops alerts for guests — it does
**not** delete the banner.

Why kept: the banner holds the only full UI for the `closing_risk` multi-option resolver
(leave-earlier / skip / push-to-day + capacity badges) and the weather swap flow. We reuse
that logic in chat by **extracting it into a shared component** (Phase 2), so the banner keeps
working if re-mounted.

To re-enable guest alerts later (when un-deferred):
1. Remove the `user`-gate around alert rendering in `Trip.jsx` (restore `AlertBanner` mount).
2. Open `ChatWidget` to guests OR keep banner-only for guests.
3. Search anchors: grep `AlertBanner`, `useAlerts`, and the comment tag
   **`DEV25-BANNER-RETAINED`** added at every gated mount/branch.

Every place dev25 disables a banner path MUST carry an inline comment beginning
`// DEV25-BANNER-RETAINED:` describing how to restore it.

---

## Phase 1 — The bot speaks first (B1 core)

**Goal:** when a new alert arrives for a logged-in user, the chatbot proactively posts a
friendly, LLM-phrased message; an unread badge appears on the FAB. Banner still renders on the
Trip page for now (parity not yet reached — removed in Phase 2). No new mutation paths.

> **Code-verified refinements (2026-06-12, read real source):**
> - There is **no GET-alert-by-id** endpoint; the `/alerts` router only has `/feedback` +
>   `/preferences`. But the frontend `useAlerts` already reads `lta_alerts` with `select('*')`
>   via RLS-protected Realtime, so **the client already holds the full alert object** — the
>   phrase endpoint takes the alert fields the client sends, **no DB reload, no ownership check**
>   (it returns only a rephrasing of content the client already legitimately has). Keep
>   `require_current_user` to gate quota abuse (chat is login-only anyway).
> - Guests now get **no alerts at all** → the Trip-page banner is hidden for **everyone** (not
>   "guests only"), behind a `const ENABLE_TRIP_BANNERS = false` flag so the JSX stays intact.
> - `chat.router` is mounted at `/chat` → new route is `POST /chat/phrase-alert`.
> - In `Trip.jsx`, `alerts` (from `useAlerts(id)`, L900) feeds only the banner memos
>   `otherAlerts`/`weatherAlertsToShow`/`weatherAlertsCollapsed` (L957-967) + the section
>   visibility at L1585; the three mounts are L1616/1619/1634.
> - Language: `useT()` exposes `lang` ('en'|'vi') from `LanguageContext`; pass it as the hint.

### Backend
- `services/gemini.py`: add `async def phrase_alert(alert: dict, lang: str = "en") -> str` —
  single rate-limited Gemini call (reuse `_rate_limit` + the `gemini-2.5-flash` simple-call
  pattern of `generate_gap_notifications`) that turns an alert dict into one warm ≤2-sentence
  message in the user's language. **Fallback to `alert["message"]`** on any failure (never fabricate).
- `models/chat.py`: add `AlertPayload` (id, alert_type, message, day_number — all optional),
  `PhraseAlertRequest {alert, lang}`, `ProactiveMessage {alert_id, text, alert_type, day_number}`.
- `routers/chat.py`: add `POST /chat/phrase-alert` (`require_current_user`) → call
  `gemini.phrase_alert(body.alert.model_dump(), body.lang)`, return `ProactiveMessage`. No DB
  load / no ownership check (nothing privileged is returned). Phrasing is client-initiated when
  Realtime delivers an alert — keeps the scheduler path untouched, no server-push infra.

### Frontend
- `hooks/useAlerts.js`: add optional `channelSuffix=''` param so multiple subscribers don't
  collide on the same Realtime topic (`trip-alerts-${tripId}${suffix}`). Backward compatible.
- `components/chat/ChatWidget.jsx`: call `useAlerts(user ? tripId : null, 'chat')` at the top
  (hooks before the guest early-return; null arg = no subscription for guests). On each *new*
  alert id (tracked in a `useRef` Set): call `api.phraseAlert({alert:{id,alert_type,message,
  day_number}, lang})`, append an assistant bubble (`{role:'assistant', text, alertId}`), and
  increment an `unread` badge shown on the FAB (cleared when the widget opens).
- `pages/Trip.jsx`: add `const ENABLE_TRIP_BANNERS = false` (tagged `// DEV25-BANNER-RETAINED:`);
  gate the three `AlertBanner` mounts (L1616/1619/1634) and the `alerts.length > 0` part of the
  section condition (L1585) with it. JSX kept intact for easy re-enable. Logged-in users now get
  alerts via chat only; acting on them lands in Phase 2 (notification-only window is intentional).
- `services/api.js`: add `phraseAlert: (body) => request('/chat/phrase-alert', {method:'POST', ...})`.

### Tests
- backend (`tests/test_routers/test_chat.py` or sibling): `phrase_alert` returns LLM text on
  success and falls back to `alert["message"]` on exception (mock `_client`); `/chat/phrase-alert`
  returns `ProactiveMessage`; 401/403 without auth.
- frontend: `ChatWidget` posts an assistant bubble when `useAlerts` yields a new alert; no
  double-post on re-render; badge increments when closed; guest (no `user`) still shows the Lock
  and never subscribes. Update `Trip.test.jsx` (already mocks `useAlerts`) to assert `AlertBanner`
  is not rendered.

### Impact
| Area | Change | Risk |
|------|--------|------|
| Adaptation Agent / scheduler / `lta_alerts` | none | none |
| `useAlerts` | +optional `channelSuffix` (backward compat; only Trip + new ChatWidget use it) | LOW |
| Trip page banner | hidden behind `ENABLE_TRIP_BANNERS=false` flag (reversible, JSX kept) | LOW |
| Gemini quota | +1 rate-limited call per *new* alert | LOW |

---

## Phase 2 — Act inside the chat (C1, full card reuse)

**Goal:** the weather swap + `closing_risk` resolver work entirely inside the chat stream for
logged-in users. Banner stays mounted for guests only.

### Refactor (shared, DRY)
- Extract the resolution-action UI from `AlertBanner.jsx` into a presentational component
  `components/adaptation/AlertActionCard.jsx` (delta pills, weather Preview→Accept,
  closing-risk leave/skip/push + capacity day-picker). It takes `alert`, `tripId`,
  `onAdapted`, `onDismiss` and calls the **same** `api.adaptTrip`/`api.acceptSwap`.
- `AlertBanner.jsx` becomes a thin wrapper that renders the badge/header + `<AlertActionCard>`
  — **behaviour identical**, so guest banner + existing tests stay green.

### Chat integration
- `ChatWidget.jsx`: under a proactive alert bubble, render `<AlertActionCard>` inline in the
  message stream. On `onAdapted(updatedTrip)`, dispatch the existing
  `imove:trip-updated` event (already consumed by Trip page, `ChatWidget.jsx:101`) and mark the
  alert surfaced/resolved.
- Keep the in-chat write-proposal card (`pending`) and the alert action card visually distinct.

### Tests
- `AlertActionCard.test.jsx`: port the interaction assertions currently in
  `AlertBanner.test.jsx` (adapt→accept, closing-risk leave_earlier/skip/push+target_day,
  preview-expired handling).
- `AlertBanner.test.jsx`: keep as-is (wrapper still renders the card) — must stay green.
- `ChatWidget`: action card appears under a proactive bubble; accepting fires
  `imove:trip-updated`.

### Impact
| Area | Change | Risk |
|------|--------|------|
| `AlertBanner` | refactor to wrap `AlertActionCard` | LOW — same DOM/behaviour, tests pin it |
| `adaptTrip`/`acceptSwap` endpoints | none | none |
| Trip page (logged-in) | no banner; acts via chat | MEDIUM — main UX shift; covered by tests |

---

## Phase 3 — Rich, multi-block messages with images (C1 full)

**Goal:** chat answers render as **multiple styled blocks** (not one plain bubble): formatted
text + place cards with images + route-compare + bus-arrivals cards. Card data is always real
(from tools/dataset); the LLM authors only the connective text. Applies to all logged-in chat
answers; proactive alert bubbles (Phase 1–2) are unaffected.

### Response shape (backend)
- `models/chat.py`: add a discriminated block union and extend `ChatResponse`:
  - `TextBlock {type:"text", markdown:str}`
  - `PlaceCardBlock {type:"place_card", id, name, category, image_url, suggested_duration_minutes}`
  - `RouteCompareBlock {type:"route_compare", from_name?, to_name?, options:[{mode, duration_minutes, fare_sgd, walk_minutes?}]}`
  - `BusArrivalsBlock {type:"bus_arrivals", stop_code, services:[{service_no, eta_min, load?}]}`
  - `ChatResponse.blocks: list[ChatBlock] | None` — **keep `reply: str`** as fallback/back-compat
    (proactive messages, confirm responses, errors keep using `reply`).

### Producing blocks (tool-driven / hybrid)
- **Text blocks**: the model's final text is split on blank lines → one `TextBlock` per
  paragraph (this is the "tách thành nhiều khối" behaviour); rendered as markdown.
- **Place cards**: add a presentation tool `show_places(place_ids: [str])` (`READ_TOOLS` +
  `FunctionDeclaration`). The model calls it to choose *which* places to display; backend builds
  each `PlaceCardBlock` by reading the **curated dataset** (`get_curated_place` / `_CURATED`) so
  `image_url` is always real — the model cannot invent an image, and the existing place_id
  invariant is preserved. Prompt: after recommending places, call `show_places` with their ids.
  (Avoids dumping all 20 search hits as cards.)
- **Route compare / bus arrivals**: emitted automatically when the model calls the existing
  `compare_routes` / `get_bus_arrivals` (single-subject, low noise) — their structured result is
  both fed back to the model AND captured as a `RouteCompareBlock` / `BusArrivalsBlock`.
- Assembly in `run_chat`: accumulate `blocks` across the turn; final response = text blocks
  (from model text) + captured data-card blocks, in call order. No cards + plain answer → a
  single `TextBlock` built from `reply` (fallback).

### Frontend
- `ChatWidget.jsx`: assistant message model becomes `{role:'assistant', blocks:[...]}`, rendered
  via a new `components/chat/ChatBlocks.jsx` that dispatches per `block.type`. User messages stay
  text. Back-compat: a response with only `reply` → render as one text block.
- New block components: `TextBlock` (markdown), `PlaceCard` (image + name + category + duration),
  `RouteCompareCard`, `BusArrivalsCard` — match existing Tailwind/`cn` styling + i18n via `useT`.
- Add a **markdown renderer** (`react-markdown`, safe inline/blocks only, **no raw HTML**) for
  `TextBlock`. Note the new dependency in the commit.
- `services/api.js`: `sendChat` already returns the payload; consume `blocks`.

### Tests
- backend: a `show_places` answer returns `PlaceCardBlock`s with `image_url` from the dataset;
  a `compare_routes` answer yields a `RouteCompareBlock`; a plain answer yields only
  `TextBlock`(s); multi-paragraph text → multiple text blocks; `reply` fallback preserved when
  `blocks` is None.
- frontend: `ChatBlocks` renders each type; `PlaceCard` renders an `<img>`; markdown bold/list
  renders; a response with only `reply` falls back to one bubble; existing proposal + alert
  action cards still render.

### Impact
| Area | Change | Risk |
|------|--------|------|
| `ChatResponse` | +`blocks` (additive, `reply` kept) | LOW — back-compat |
| chat tool set | +`show_places`; capture route/bus results as blocks | LOW |
| `ChatWidget` rendering | message = blocks; new renderer + markdown dep | MEDIUM — main UI change, covered by tests |
| place/image authenticity | images read from dataset only | none (no fabrication) |
| proactive alert bubbles | unchanged (still `reply` + action card) | none |

---

## Phase 4 — Up-to-date knowledge (A1 web grounding)

**Goal:** the assistant can answer about current events / festivals / tips / neighbourhoods,
and proactively nudge seasonally ("this weekend there's festival X near your Day 2").

### Backend
- `services/gemini.py`: `async def search_events_grounded(query: str) -> dict` — an
  **isolated** `generate_content` call with `tools=[types.Tool(google_search=...)]` and **no
  function declarations** (prevents tool conflict + blocks web prompt-injection from triggering
  actions). Returns `{ text, citations }`. Verify config differs Vertex vs api-key
  (`_make_client` already branches) and rate-limit in api-key mode. Graceful typed fallback
  (no fabrication) on failure/empty.
- `agents/chat_agent.py`:
  - add `"get_current_events"` to `READ_TOOLS` (`:30`);
  - add a `FunctionDeclaration` (param: optional `month`, `query`) near `get_weather` (`:119`);
  - add the execution branch in `_execute_read_tool` (`:350`) — **enforce max 1 grounded call
    per `run_chat`** via a per-call flag in `ctx`;
  - update `SYSTEM_PROMPT` (`:41`): (a) inject **current date + trip start_date** at
    `run_chat` (turn `SYSTEM_PROMPT` into a builder); (b) scope rules — web results are
    *informational only*, non-dataset places may be named for description but **never** added
    to the itinerary; only call the tool for time/season/event/neighbourhood questions.

### Frontend
- None required (sources not shown, per decision). Event answers flow as **text blocks**
  (Phase 3) — no new component; the grounded summary becomes one or more `TextBlock`s.

### Tests
- `search_events_grounded` returns text on success, typed fallback on failure (mock client).
- `_execute_read_tool` routes `get_current_events`; the 1-call cap blocks a second grounded
  call in the same turn.
- prompt builder injects today's date; tool not called for non-event messages (behavioural
  assertion via mocked function-call sequence).

### Impact
| Area | Change | Risk |
|------|--------|------|
| chat tool set | +1 read tool, prompt builder | LOW |
| Gemini quota | +≤1 grounded call / message | LOW (capped) |
| place invariant | unchanged (add_place still validates) | none |

---

## Phase 5 — Companion on the move (B2 live mode)

**Goal:** strengthen the "I'm lost / running" experience using GPS + real-time signals,
building on the existing `switch_leg_now` tool and `get_weather`.

### Scope (kept tight — design detail finalized when Phase 1–4 land)
- Proactive, GPS-aware nudges surfaced through the same chat channel (e.g. "raining now near
  you — your next outdoor stop is X; want an indoor swap or a covered route?").
- Reuse `switch_leg_now` (already a write tool, `chat_agent.py:151`) + `get_weather` +
  `compare_routes`; no new mutation primitives expected.
- Trigger source TBD at Phase-4 planning: client-side geofence/weather poll vs. extending the
  scheduler. Decide then; do not pre-build infra now.

> Phase 5 gets its own short design note appended here before coding (kept minimal so Phases
> 1–4 aren't blocked).

---

## Cross-cutting guardrails

- **Hard (code):** `add_place` place_id validation (existing) blocks hallucinated stops;
  grounding call is **tool-less + isolated** so injected web text can't trigger actions;
  **1 grounded call / message** cap.
- **Soft (prompt):** role kept to SG transit guide; web info is informational + must not be
  presented as authoritative pricing/dates; only call web tool when relevant.
- **No fabrication on failure:** every external call (phrasing, grounding, adapt) falls back to
  an explicit message or the raw alert — never invented data (project rule).

## Test command

`cd backend && pytest tests/ -v` and `cd frontend && npm test` must stay green after each phase.

## Commit (per phase)

One commit per phase; body lists per-file line ranges (e.g.
`backend/app/agents/chat_agent.py L30, L119-124, L350-360, L41-57`,
`frontend/src/components/chat/ChatWidget.jsx L…`). Every banner-gating edit carries a
`// DEV25-BANNER-RETAINED:` comment. Do not stage AGENTS.md / CLAUDE.md / NOTES.md.
Trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Out of scope (future)

Chat history persistence (D1), source chips on UI, streaming (C2), voice/multimodal (C3),
conversational trip-builder (A2), broader languages (E1), guest alerts (re-enable per
§Banner preservation).
