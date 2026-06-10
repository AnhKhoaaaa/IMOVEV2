# dev19 — Weather alert system overhaul (P1 + P2, excludes NEA/P3)

Builds on dev18 (per-day scoping, `lta_alerts.day_number`). Goal: make weather alerts
**cheaper**, **time-aware**, and able to react to **rain happening right now** — without
adding any external data source beyond the OpenWeather free tier already in use.

> Out of scope (deferred): **P3 — NEA `data.gov.sg` 2-hour area nowcast**. Not in this plan.

---

## Problems being addressed
1. Poll every 30 min is wasteful — OpenWeather `/forecast` only refreshes every few hours and
   `pop` (per-3h probability, aggregated to a daily max) does not change sub-hourly.
2. N OpenWeather calls per trip (one `get_forecast` per day) for a single 5-day payload.
3. System only knows *forecast probability*, never *"it is raining now"* — `get_current_weather`
   exists (`services/openweather.py`) but is unused.
4. Hard 70% threshold on the **daily max** — fires even if the rain window doesn't overlap the
   hours the user is actually outdoors, and (when live) for stops already visited.

---

## P1 — Efficiency + live-rain reaction (do first)

### P1.1 Cache + single fetch — `services/openweather.py`
- **New** `get_forecast_window(lat, lng) -> dict[str, dict]`:
  - One HTTP call to `/data/2.5/forecast`; returns a map `{ "YYYY-MM-DD": day_agg }` for every
    date in the 5-day window, where `day_agg` =
    `{ "rain_probability": int, "condition": str, "temp_max": float, "temp_min": float,
       "slots": [ { "hour": int(0-23, UTC→SGT), "pop": float(0-1), "condition": str } ] }`.
    `slots` is required by P2 (window-aware filtering).
  - **In-process TTL cache** keyed by coords rounded to ~2 dp (`round(lat,2), round(lng,2)`),
    TTL `WEATHER_FORECAST_TTL_S` (default 5400s ≈ 90 min). Cache stores the parsed per-day map.
  - Raises `WeatherUnavailableError` on API/key failure (unchanged contract).
- **Refactor** existing `get_forecast(date_str, lat, lng)` to a thin wrapper that calls
  `get_forecast_window` and returns the matching date's `day_agg` (minus `slots`), raising
  `WeatherUnavailableError` when the date is outside the window. Keeps all current callers/tests
  working while collapsing N calls → 1 per coord per TTL.

### P1.2 Poll cadence — `app/main.py`
- Change the APScheduler `poll_weather_alerts` interval from **30 min → `WEATHER_POLL_MINUTES`
  (default 120)**. LTA poll (2 min) is untouched. Event-driven checks (`check_alerts_for_trip`
  on trip-open / day-start) remain the fast path; the background poll is just a safety net.

### P1.3 Use cached window in the per-day check — `agents/adaptation_agent.py`
- `poll_weather_alerts` / `check_alerts_for_trip`: fetch the window **once per trip** at the trip
  centroid (Singapore is small enough that per-day centroid drift is below OpenWeather's
  resolution), then look up each day's `day_agg` from the map instead of one call per day.
- `_check_weather_for_day(...)` gains a `day_agg: dict` param (already-fetched) instead of calling
  `get_forecast` itself — pure function over provided data, easier to test.

### P1.4 Live-rain alert (today only) — `agents/adaptation_agent.py`
- **New** `_check_live_rain(trip_id, plan, today_day: int, places: list[dict]) -> bool`:
  - Only runs for the day whose calendar date == today (`_day_date(...) == date.today()`).
  - Calls `openweather.get_current_weather(clat, clng)` at that day's centroid.
  - If `rain_1h > 0` **or** `condition == "Rain"` → insert a **`weather_live`** alert:
    - `alert_type="weather_live"`, `day_number=today_day`,
    - `severity` = `_rain_level(rain_1h)` (`light`/`heavy`, reuse thresholds from
      `models/preferences.py::ContextSnapshot.rain_level`: light ≥2.5mm, heavy ≥7.5mm),
    - message names the **next outdoor stop** and suggests shelter/optional swap, e.g.
      *"It's raining now near your route (heavy, 8mm/h). Your next outdoor stop is Gardens by the
      Bay — consider sheltering or swapping to ArtScience Museum."*
  - **Dedup** by `(trip, weather_live, day_number)` within `WEATHER_LIVE_DEDUP_MIN` (default 20).
- Wire into both `poll_weather_alerts` and `check_alerts_for_trip` after the forecast loop.

### P1.5 Alert-type split — keep `weather_warning` = forecast/swap (existing behaviour),
add `weather_live` = imminent rain. **No swap is auto-applied for live** by default; the banner
offers the same Preview→Accept swap path but scoped to the single next outdoor stop.

### P1.6 `adapt_trip` — `weather_live` reuses the weather path: `_apply_weather_swap(plan,
day=alert.day_number)` (unchanged signature). Acceptable because the day scope already limits it;
optional refinement (swap only the next stop) is a P2 item.

---

## P2 — Context-aware alerting

### P2.1 Time-window overlap (forecast) — `agents/adaptation_agent.py`
- Replace "daily max `pop` > 70%" with **"max `pop` over the 3h slots overlapping the day's outdoor
  window"**. Outdoor window = `[min(best_time_start), max(best_time_end)]` across that day's outdoor
  stops (fields already on `Place`). Helper `_window_rain(day_agg["slots"], start_hhmm, end_hhmm)`.
- Effect: a 6am downpour no longer warns a day whose outdoor stops are all afternoon.

### P2.2 Skip already-visited stops (live) — extend `CheckAlertsRequest`
(`models/trip.py`) with optional `active_day: int | None` and `active_leg_index: int | None`.
`Trip.jsx` passes them when live (it already tracks both). `_check_live_rain` then only considers
outdoor stops **at/after** the active leg. When absent (poll path), considers all of today's stops.

### P2.3 Severity surfaced end-to-end
- **Migration `017_lta_alerts_severity.sql`**: `alter table lta_alerts add column if not exists
  severity text;` (nullable: `light` | `heavy` | NULL).
- Forecast alerts: severity from `pop` band (`heavy` if ≥0.85 else `light`). Live alerts: from mm.
- Frontend reads `alert.severity` for icon/colour intensity.

### P2.4 Threshold config — `app/config.py`
- `weather_forecast_threshold` (default 70), `weather_poll_minutes` (120),
  `weather_forecast_ttl_s` (5400), `weather_live_dedup_min` (20). Replace the hard-coded
  `_WEATHER_RAIN_THRESHOLD` constant.

---

## Frontend — `components/adaptation/AlertBanner.jsx` + `hooks/useAlerts.js`
- `TYPE_CONFIG.weather_live`: distinct styling (e.g. heavier rain icon, amber for `light` / red for
  `heavy`), label "Raining now" vs forecast's "Rain expected". `showAdapt: true`.
- Render `alert.severity` chip when present; keep the existing Day-N chip + full message.
- `useAlerts.dedupe` already keys by `(alert_type, affected_line, day_number)` → `weather_warning`
  and `weather_live` for the same day coexist (intended: one proactive, one live). No change needed.
- `Trip.jsx`: pass `active_day` / `active_leg_index` into `api.checkAlerts` when `isLive` (P2.2).

---

## Data model summary
| Column | Status |
|---|---|
| `lta_alerts.day_number` | added in dev18 (016) |
| `lta_alerts.severity` | **new — migration 017 (P2.3)** |
| `alert_type = "weather_live"` | new text value, no DDL |

---

## Tests
**Backend**
- `openweather`: `get_forecast_window` makes **one** HTTP call then serves cached lookups within TTL;
  `get_forecast` wrapper still returns the right date / raises outside window.
- `adaptation`:
  - `_check_live_rain` inserts `weather_live` with correct `severity` when `rain_1h>0`; no insert when dry.
  - P2.1 window overlap: morning-only rain does not warn an afternoon-outdoor day.
  - dedup independent per `(type, day)`; forecast + live can coexist same day.
  - existing dev18 tests stay green (per-day swap scope, message, persist hardening).
- `config`: new settings have defaults; threshold no longer hard-coded.

**Frontend**
- `AlertBanner` renders the `weather_live` variant + severity chip; `weather_warning` unchanged.
- `npm run build` + existing vitest (baseline: 216 pass / 5 pre-existing Trip fails).

---

## Rollout
1. P1 (caching + cadence + live rain) — no schema change; ships behind the existing free tier.
2. P2 (window overlap, severity, live filtering) — apply migration **017** before severity is read.
3. Config defaults make both phases safe to deploy incrementally; `weather_live` simply doesn't
   appear until P1.4 is live.

## Risk (GitNexus)
- `poll_weather_alerts` upstream callers: none (scheduler only) — LOW.
- `_apply_weather_swap` upstream: `adapt_trip` only — LOW; signature unchanged.
- `get_forecast` refactor is the only shared touch-point — covered by wrapper + tests.
- All new work is additive (`weather_live`, new helpers, optional request fields, nullable column).
