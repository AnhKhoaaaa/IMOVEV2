# IMOVE V2 — Frontend Handoff

> Source of truth for tabs, buttons and backend endpoints. Backend = FastAPI on `VITE_API_BASE_URL`. Realtime = Supabase `lta_alerts` channel. Auth = Supabase JWT in `Authorization: Bearer <token>` (only required where noted).

## 0. Conventions

| Item | Value |
|------|-------|
| Base URL | `VITE_API_BASE_URL` (env) |
| Auth | Bearer JWT (Supabase); only `/users/me/*` strictly requires it. Trip endpoints check ownership only if a token is present. |
| Error contract | Typed exceptions → `422` (planning/budget/route), `503` (LTA/weather/DB unavailable), `403` (session mismatch), `404` (missing) |
| Realtime | Supabase `postgres_changes` on `lta_alerts`, filter `trip_id=eq.{tripId}` |
| Polling | Backend already runs LTA poll every 2 min + weather every 30 min; frontend never polls these |

## 1. Screen map

| Route | Screen | Status |
|-------|--------|--------|
| `/` | Home (dashboard) | Wired, extend filters |
| `/plan` | Planner (create trip) | Wired |
| `/trip/:id` | Trip (Overview / Day N / Summary + Map) | Wired, two gaps |
| `/settings` | **NEW** Settings (Preferences + Account) | Not built |
| (overlay) | Auth modal | Wired |
| (overlay) | Trip Setup modal | Wired |
| (debug) | Disruption Simulator dock | Wired (dev only) |

---

## 2. Home `/`

Trip dashboard. Tabs filter the same trip list locally (no backend filter).

### 2.1 Filter tabs
`All` · `Today` · `Upcoming` · `Drafts` · `Past`
Source of trips: `useSavedTrips` (localStorage); each card hydrates via `GET /trips/{id}` lazily.

### 2.2 Trip card buttons
| Button | Action | Endpoint |
|--------|--------|----------|
| Open | Navigate `/trip/:id` | `GET /trips/{id}` (via useTrip on next screen) |
| Start Trip (Today tab only) | Opens StartTodayModal → on confirm sets `tripStarted=true` locally and **fires Check Alerts** | `POST /trips/{id}/check-alerts` body `{session_id}` — ⚠ NEW WIRE |
| Delete | Confirm → remove | `DELETE /trips/{id}` |

### 2.3 Header buttons
| Button | Action | Endpoint |
|--------|--------|----------|
| `+ New Trip` | Route to `/plan` | — |
| Sign in / Profile menu | Open AuthModal | Supabase Auth SDK (no backend call) |

---

## 3. Planner `/plan`

Two creation modes selectable by chip.

### 3.1 Mode: Manual
| Button / control | Action | Endpoint |
|------------------|--------|----------|
| Search input (debounced) | Autocomplete places | `GET /places/search?q=` |
| "Browse all" | Open PlaceBrowser drawer | `GET /places/curated` |
| `+` on a place row | Stage place in builder | local |
| `Generate plan` | Create trip → plan | 1. `POST /trips` body `{session_id, num_days, budget_sgd, start_date?, end_date?}` → `{trip_id}` <br> 2. `POST /trips/{trip_id}/plan` body `{place_ids, optimize_order: true, preferences?}` → `TripPlan` → navigate `/trip/{id}` |

### 3.2 Mode: AI
| Button / control | Action | Endpoint |
|------------------|--------|----------|
| Companion chips (solo / couple / family / friends) | Set `group_type` | local |
| Style chips (nature / food / heritage / shopping / nightlife) | Multi-select `travel_styles` | local |
| Pace slider (1–14 days) | Set `num_days` | local |
| `Suggest places` | Get AI shortlist (already filtered against curated dataset) | `POST /places/ai-suggest` body `{num_days, travel_styles, group_type}` → `{suggested_place_ids}` |
| Edit shortlist (add/remove) | Local | — |
| `Generate plan` | Same 2-step flow as Manual | `POST /trips` + `POST /trips/{trip_id}/plan` |

### 3.3 Trip Setup modal (overlay, reachable from Trip header too)
Form fields: origin, destination (display only — Singapore), `num_days`, `budget_sgd`, `start_date`, `end_date`, optional preferences.
Submit re-runs `POST /trips/{id}/plan` (or `POST /trips` on first time).

---

## 4. Trip `/trip/:id`

Two-pane layout: left = tabs, right = `TripMap` (renders `LegResponse.geometries` polylines + `Place` markers).

### 4.1 Tab bar
`Overview` · `Day 1` … `Day N` · `Summary` · header buttons `+ Day` / `Setup` / `Optimise`.

| Button | Action | Endpoint |
|--------|--------|----------|
| `+ Day` | Append empty day | `POST /trips/{id}/days` → `TripPlan` |
| `X` on a Day tab | Remove day, replan | `DELETE /trips/{id}/days/{dayNum}` (422 if last day) |
| `Optimise` | Re-run greedy sort | `POST /trips/{id}/optimize` → `TripPlan` |
| `Setup` | Open TripSetupModal | (see §3.3) |

### 4.2 Overview tab
Renders `TripPlan.days` summary cards + `TripPlan.warnings` banner + `TripPlan.gap_notifications` inline alerts + an unassigned bucket.

| Button | Action | Endpoint |
|--------|--------|----------|
| Drag place → Day card | Assign to day | `POST /trips/{id}/places` body `{place_id, day}` |
| `Add place` (search drawer) | Open search, then add | `GET /places/search` + `POST /trips/{id}/places` |
| Reorder within a day (drag) | Persist new order | `PATCH /trips/{id}/reorder` body `{day, place_ids}` |
| `Remove` on place | Drop place | `DELETE /trips/{id}/places/{place_id}` |
| Render warnings | Read-only | from `TripPlan.warnings` |
| Render gap chips | Read-only | from `TripPlan.gap_notifications[*].{day_index, gap_start, gap_end, gap_minutes, message}` |

### 4.3 Day N tab — Plan view (default when `tripStarted === false`)
Renders `DayPlan.legs` as alternating Place card → Leg card → Place card.

Place card fields: `name`, `category` badge (ATTRACTION / FOOD_BEVERAGE / HERITAGE / SHOPPING), `dwell_minutes`, `best_time_start`–`best_time_end`, `opening_hours` (list, can be split), `close_days` (e.g. "Closed Mon"), `description`, `formatted_address`, `image_url`.

Leg card fields: `transport_mode` icon, `duration_minutes`, `cost_sgd`, `distance_km`, `is_estimated` badge, `instructions[]`, expandable `sub_legs[]` with line code + stop names.

| Button | Action | Endpoint |
|--------|--------|----------|
| Change mode dropdown (BUS / METRO / WALK / CYCLE) | Re-fetch leg | `PATCH /trips/{id}/legs/{legId}` body `{transport_mode}` → `LegSwapResult` |
| Expand transit details | Show `sub_legs` | local (data already on leg) |
| Show live bus countdown | If `transport_mode==BUS` and `first_bus_stop_code` set | `GET /transit/bus-arrivals/{stop_code}` |
| `Compare modes` (per leg) | A→B route comparison | `GET /transit/compare?from_lat&from_lng&to_lat&to_lng` → `{pt, walk, cycle}` |
| `Remove place` | Drop and replan | `DELETE /trips/{id}/places/{place_id}` |

### 4.4 Day N tab — Active Leg view (when `tripStarted === true`)
Triptych: origin block + `CitymapperTransitCard` + destination venue. Driven by `useGeolocation`.

| Button / behaviour | Action | Endpoint |
|--------------------|--------|----------|
| GPS heartbeat (every 30 s) | Push position, trigger proximity alerts | `POST /trips/{id}/location` body `{lat, lng, session_id?}` (204) |
| `Switch now → Walk / Bus / MRT / Cycle` ⚠ NEW WIRE | Reroute from current GPS | `POST /trips/{id}/legs/{legId}/switch-now` body `{new_mode, current_lat, current_lng}` → `LegSwapResult` (note `routed_from_current_position: true`) |
| `Skip place` | Same as remove | `DELETE /trips/{id}/places/{place_id}` |
| Live bus countdown | Auto-poll every 20 s while card visible | `GET /transit/bus-arrivals/{first_bus_stop_code}` |

### 4.5 Alert banner (visible across all tabs when an `lta_alerts` row arrives)
Subscribes to Supabase Realtime; render colour by `alert_type` (`train_delay`, `bus_cancellation`, `weather_warning`, `transport_alert`, `service_unavailable`). Show `message`.

| Button | Action | Endpoint |
|--------|--------|----------|
| `Preview swap` | Compute proposed change, no persistence | `POST /trips/{id}/adapt` body `{alert_id, session_id?}` → `AdaptResponse` (show `changes[]`, `delta_transit_cost`, `delta_active_time`, `delta_walking_distance`) |
| `Accept` | Persist the pending swap | `POST /trips/{id}/accept-swap` body `{alert_id, session_id?}` → `TripPlan` |
| `Dismiss` | Local only | — |
| `Helpful 👍 / Not helpful 👎` ⚠ NEW WIRE | Submit feedback | `POST /alerts/feedback` body `{trip_id, leg_id?, rating(1–5), comment?}` |

### 4.6 Summary tab
Renders trip totals (sum of `LegResponse.duration_minutes` / `cost_sgd` / `distance_km`), optimisation log (`TripPlan.warnings`), and a Save CTA.

| Button | Action | Endpoint |
|--------|--------|----------|
| `Save trip` | Persist client-side; trip already in DB if user logged in | local |
| `Export / Share` | local | — |
| `Delete trip` | Confirm → remove | `DELETE /trips/{id}` |

---

## 5. Settings `/settings` ⚠ NEW SCREEN

Requires auth (Supabase JWT). Two tabs.

### 5.1 Preferences tab
Renders `UserPreferenceProfile` from `GET /users/me/preferences` (401 if not signed in → redirect to AuthModal).

| Control | Field | Endpoint |
|---------|-------|----------|
| Slider × 4 | `duration_w`, `cost_w`, `walking_w`, `transfers_w` (0–1, must sum to 1.0; backend normalises) | `GET /users/me/preferences` then `PUT /users/me/preferences` body `UserPreferenceProfile` |
| Checkbox × 4 | `constraints.avoid_bus`, `avoid_metro`, `minimize_walking`, `minimize_fee` | same `PUT` |
| Input | `max_walk_minutes` (default 15) | same `PUT` |
| Toggle | `prefer_mrt`, `avoid_transfers` | same `PUT` |
| `Save` | Submit, then show normalised weights returned by backend | `PUT /users/me/preferences` |
| `Reset to defaults` | Local reset → PUT defaults | `PUT /users/me/preferences` |

### 5.2 Account tab
| Button | Action | Endpoint |
|--------|--------|----------|
| Sign out | Supabase signOut | Supabase SDK |
| Delete account | (Out of scope; backend not implemented) | — |

---

## 6. Realtime & background integration

| Concern | Frontend responsibility |
|---------|------------------------|
| LTA alerts | Subscribe `supabase.channel('lta_alerts').on('postgres_changes', {event:'*', schema:'public', table:'lta_alerts', filter:'trip_id=eq.'+tripId}, …)`. Already implemented in `useAlerts`. |
| Upcoming-trip alert priming | When Home opens a card whose date is today/tomorrow, **call `POST /trips/{id}/check-alerts` once** before navigating. ⚠ NEW WIRE |
| Hibernation keep-alive | None — backend handles. Frontend can optionally ping `GET /health` on app boot. |
| GPS push cadence | 30 s when `tripStarted`, off otherwise (see §4.4). |

---

## 7. Shared response shapes (cheat sheet)

```
TripPlan { id, days:[DayPlan], places:[Place], warnings:[str], gap_notifications:[GapNotification] }
DayPlan  { day, legs:[LegResponse] }
LegResponse { id, from_place_id, to_place_id, transport_mode, duration_minutes, cost_sgd,
              distance_km?, is_estimated, geometry?, geometries:[str], instructions:[str],
              sub_legs:[PTSubLeg], alternatives:{mode:AlternativeRoute}, first_bus_stop_code? }
PTSubLeg { mode, route, from_name, to_name, from_stop_code, to_stop_code,
           duration_minutes, num_stops, geometry?, intermediate_stops:[{name,stop_code}] }
Place    { id, name, lat, lng, category, is_outdoor, dwell_minutes,
           best_time_start, best_time_end, opening_hours?, close_days?,
           description?, formatted_address?, search_keywords?, image_url? }
GapNotification { day_index, gap_start, gap_end, gap_minutes, message }
AdaptResponse   { adapted, changes:[str], updated_trip:TripPlan,
                  delta_transit_cost, delta_active_time, delta_walking_distance }
LegSwapResult   { updated_leg:LegResponse, trip_cost_sgd, warnings:[str],
                  routed_from_current_position }
UserPreferenceProfile { duration_w, cost_w, walking_w, transfers_w,
                        constraints:{avoid_bus,avoid_metro,minimize_walking,minimize_fee} }
LtaAlert (Supabase row) { id, trip_id, alert_type, affected_line?, message,
                          created_at, resolved_at? }
```

---

## 8. Image URL — dev9 notes (2026-06-03)

`Place.image_url` is now seeded from Wikipedia / Unsplash into `singapore_places.json`
and the Supabase `places` table (migration 009). The field was already Optional in the
Pydantic model and already used by `PlaceCard` — no breaking change.

### Current behaviour (PlaceCard `ImageStrip`)
- Renders a 3-column photo strip; only slot 0 shows a real image (`image_url`).
- Slots 1 and 2 always render hatched placeholders.
- `onError` on the `<img>` hides it silently if the URL is unreachable.

### Known gaps for frontend team to address later
| Item | File | Note |
|---|---|---|
| Slots 1–2 always placeholder | `PlaceCard.jsx:17` | Future: store multiple photos per POI or redesign strip to single full-width hero |
| PlaceBrowser grid cards have no thumbnail | `PlaceBrowser.jsx:96` | POIs in the picker show only icon + name; adding a `src={place.image_url}` thumbnail would improve discoverability |
| ~35 ATTRACTION/HERITAGE have `image_url=null` | — | URLs will be added manually by product team; `ImageStrip` already degrades gracefully to placeholder |
| Unsplash attribution | — | Demo-key images require "Photo by X on Unsplash" credit. If shipped to production, add credit line or switch to production key |

---

## 9. Chatbot — dev10 (Frontend builds the UI)

> Backend ships a single endpoint `POST /chat`. **The chat UI (chatbox component) is the
> frontend team's responsibility.** This section is the complete contract to wire it.
>
> Design contract: the bot **never mutates the trip itself**. It either *answers* (advice)
> or *proposes* one write action. When it proposes, FE shows a preview + "Apply" button,
> and on Apply the FE calls the **existing** trip endpoints it already has in `services/api.js`.
> This mirrors the existing `adapt → accept-swap` consent flow.

### 9.1 Endpoint

```
POST /chat
Headers: Content-Type: application/json
         Authorization: Bearer <jwt>   (optional — same rules as trip endpoints)
```

**Request body** (`ChatRequest`):
```jsonc
{
  "trip_id": "abc123",
  "session_id": "guest-session-uuid",     // optional; required for guest ownership check
  "messages": [                            // FULL history — backend is stateless, FE keeps it
    { "role": "user",      "content": "đổi đoạn đi bộ sang Merlion thành tàu điện" },
    { "role": "assistant", "content": "Bạn muốn đi tuyến nào ..." }
    // roles: "user" | "assistant" | "tool"
  ],
  "current_lat": 1.2830,                    // optional; REQUIRED only for "reroute_gps"
  "current_lng": 103.8590
}
```

**Response body** (`ChatResponse`):
```jsonc
{
  "reply": "Mình đề xuất đổi đoạn này sang Tàu điện (METRO). Nhanh hơn ~8 phút.",
  "proposed_action": {                      // null if the bot only answered (advice)
    "kind": "change_transport",             // see §9.3
    "summary": "Đổi đoạn → Merlion sang Tàu điện (METRO)",  // human-readable, in user's language
    "endpoint": {
      "steps": [                            // 1+ existing API calls, run in order on Apply
        { "method": "PATCH",
          "path": "/trips/abc123/legs/leg-7",
          "body": { "transport_mode": "METRO" } }
      ]
    },
    "delta": { "duration_minutes": -8, "cost_sgd": 0.9 }  // optional, may be null
  },
  "read_results": {                         // optional — data the bot fetched, for FE to render
    "search_places": [ /* Place[] */ ]
  }
}
```

### 9.2 Frontend flow (chatbox)

1. Keep `messages[]` in component state (backend stores nothing). Append each user/assistant turn.
2. On send → `POST /chat` with the full `messages[]` (+ `trip_id`, `session_id`, GPS if available).
3. Render `reply` as the assistant bubble.
4. If `proposed_action != null` → render a **confirmation card** showing `summary` (+ `delta` if present)
   with **Apply** / **Dismiss** buttons.
5. On **Apply** → execute `proposed_action.endpoint.steps[]` **in order** using the existing
   `services/api.js` functions (these endpoints are already wired — see table below). Then refresh
   `TripPlan` (re-fetch `GET /trips/{id}` or use the returned `TripPlan`/`LegSwapResult`).
6. On **Dismiss** → local only; optionally append a system note to `messages[]`.
7. If `read_results` present → optionally render (e.g. place suggestion chips).

### 9.3 `proposed_action.kind` → existing endpoints (already in `services/api.js`)

| kind | steps[] (existing endpoints) | Notes |
|---|---|---|
| `replace_place` | `DELETE /trips/{id}/places/{old}` then `POST /trips/{id}/places {place_id:new, day}` | 2 steps, run in order |
| `add_place` | `POST /trips/{id}/places { place_id, day }` | |
| `remove_place` | `DELETE /trips/{id}/places/{place_id}` | |
| `change_transport` | `PATCH /trips/{id}/legs/{legId} { transport_mode }` | returns `LegSwapResult` |
| `reroute_gps` | `POST /trips/{id}/legs/{legId}/switch-now { new_mode, current_lat, current_lng }` | needs GPS in the `/chat` request |

> FE does **not** need to interpret `kind` to build URLs — just execute `endpoint.steps[]` as given.
> The `kind`/`summary` are for labelling the confirmation card.

### 9.4 GPS / "I'm lost" case

For `reroute_gps`, the `/chat` request **must** include `current_lat`/`current_lng` (from
`useGeolocation`). If the user asks for directions while lost but FE didn't send GPS, the bot
replies asking to enable location (no `proposed_action`). Send GPS and retry.

### 9.5 v1 constraints (so FE sets expectations)

- **No streaming** — single JSON response per turn (request/response, like other endpoints).
- **No server-side history** — FE owns `messages[]`; lost on reload unless FE persists locally.
- **Errors**: `422` (bad request/trip), `403` (session mismatch), `503` (LLM/upstream unavailable).
  On `503`, show a "trợ lý tạm thời không khả dụng" message and keep the chat usable for retry.
- **Language**: bot replies in the user's language (detected from `messages`). No FE flag needed.

---

## 10. Gap summary (work this hand-off unlocks)

| New wire | Where | Endpoint |
|----------|-------|----------|
| Check alerts before opening a today/tomorrow trip | Home card "Open" / "Start Trip" | `POST /trips/{id}/check-alerts` |
| Switch transport from GPS | Active Leg view button | `POST /trips/{id}/legs/{legId}/switch-now` |
| Feedback on alerts | Alert banner thumbs up/down | `POST /alerts/feedback` |
| Settings screen | `/settings` route | `GET/PUT /users/me/preferences` |
| **Chatbot UI + apply flow** | **New chatbox component** | **`POST /chat` → apply via existing endpoints (§9)** |

Everything else listed above is already implemented in `frontend/src/services/api.js` and only needs UI placement per this map.
