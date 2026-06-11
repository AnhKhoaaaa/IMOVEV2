# dev20 — Closing-time / "running-late" alert (live trips)

Builds on dev18/dev19 (per-day alert scoping, live progress via `active_day`/`active_leg_index`,
`weather_live` on-demand check). Goal: while a tourist is **actually travelling** through their
day, detect when they will reach a remaining stop **too late to visit it before it closes**
(because an earlier stop ran long), and let them resolve it — **skip the stop** or **push it to
another day** — with each candidate day's spare capacity shown so they choose wisely.

100% rule-based (no LLM) — consistent with the rest of the Adaptation Agent.

> **Scope (locked with user):**
> - **Live trips only** (`HAPPENING_TODAY`, the day whose calendar date == today). No plan-time warning.
> - **Trigger = hybrid:** auto-project from the real Singapore wall-clock + the leg currently being
>   travelled (`active_leg_index`, already wired); **plus** an optional "I've left this stop" button
>   that re-anchors the projection to the real moment the user departed.
> - **Actions = both, user picks:** *Skip* and *Push to another day*, and the push option **must show
>   per-day capacity** (full vs. has room, with remaining minutes).

---

## Why this fits the current app (feasibility)

~80% of the machinery already exists:

| Need | Already present |
|------|-----------------|
| Closing hours / close days / visit duration | `singapore_places.json`: `opening_hours` (list `"HH:MM-HH:MM"`), `close_days`, `suggested_duration_minutes` |
| "Is it open right now" parsing | `adaptation_agent._is_open_now()` (`:508`) — handles slots, midnight-crossing, `close_days`, SGT |
| Timeline projection formula | `planning_agent` greedy clock (`:168-207`): `clock += travel + dwell`, already enforces `opening_hours` at plan time |
| Schedule-capacity math | `planning_agent._check_schedule_fit()` (`:341`): occupied minutes / overfull at 17:30 |
| Live progress signal | `check_alerts_for_trip(active_day, active_leg_index)` (`:880`) — frontend already sends which leg the user is on |
| Alert → UI → resolve loop | `lta_alerts` → Supabase Realtime (`useAlerts.js`) → `AlertBanner.jsx`; **propose→confirm** via `adapt_trip()` |

The persisted `TripPlan`/`DayPlan`/`LegResponse` do **not** store per-place arrival clock times, so
the timeline is recomputed on demand (cheap; formula already exists).

---

## DB

### M1 — `supabase/migrations/018_lta_alerts_metadata.sql`
```sql
-- dev20: structured payload for closing_risk alerts (at-risk place, projected/close times,
-- per-day capacity for the "push to another day" option). Frontend already reads alert.metadata.
alter table lta_alerts add column if not exists metadata jsonb;
```
(`alert_type`, `message`, `day_number`, `severity`, `affected_line`, `resolved_at` already exist.)

---

## Backend — `agents/adaptation_agent.py`

### B1 — `_close_minute_today(place, now_dt) -> int | None`
Return the minute-of-day the place closes **today**, honouring `close_days` and the slot that
currently applies. Mirrors `_is_open_now` parsing. Returns `None` when the place never constrains
(`24h` / `"00:00-23:59"` / no hours / closed today already handled separately). For multi-slot days
pick the slot whose window contains/follows `now` (the one the user can still use).

### B2 — `_project_today_timeline(plan, active_day, active_leg_index, anchor_min) -> list[dict]`
- Reconstruct ordered place-ids of `active_day` via `_ordered_place_ids_from_legs(day.legs)`.
- Remaining stops = those at/after the `to_place` of the leg indexed by `active_leg_index`
  (stops already visited are skipped; hotel return leg excluded).
- `clock = anchor_min` if provided (user pressed "I left this stop"), else current SGT minutes.
- For each remaining stop, in order: `arrival = clock + leg.duration_minutes` (persisted leg time);
  `finish = arrival + dwell` (`suggested_duration_minutes`); `clock = finish`.
- Returns `[{place_id, arrival_min, finish_min}, ...]`.

### B3 — `_day_capacity_summary(plan, exclude_day) -> list[dict]`
- For every day **other than** `exclude_day`, reuse `_check_schedule_fit` math: `occupied =
  Σ(travel + dwell)` from 09:00. `status = "full"` if `540 + occupied > 1050` (17:30) else `"room"`;
  `remaining_minutes = max(0, 1050 - (540 + occupied))`.
- Returns `[{day, occupied_minutes, remaining_minutes, status}, ...]`. Surfaced in alert metadata so
  the UI can render "Day 3 — còn ~2h" / "Day 2 — đã đầy".

### B4 — `_check_closing_risk(trip_id, plan, active_day, active_leg_index, anchor_min) -> bool`
- Only runs when `_day_date(start_date, active_day) == today`.
- Project timeline (B2). For each remaining stop with a close time (B1): **at risk** when
  `arrival_min + MIN_USEFUL_VISIT > close_min` (config `CLOSING_MIN_USEFUL_MIN`, default `min(dwell, 30)`)
  — i.e. the user can't get a meaningful visit before close (covers "already too late": `arrival ≥ close`).
- Fire **one** alert for the **earliest** at-risk stop (avoids spam; next poll re-evaluates after resolution).
- Insert `alert_type="closing_risk"`, `day_number=active_day`, human message
  (*"Tràng An sắp đóng cửa lúc 18:00 — dự kiến bạn tới 18:25. Bỏ điểm này hay dời sang ngày khác?"*),
  and `metadata = { place_id, place_name, projected_arrival, close_time,
  day_capacity: _day_capacity_summary(plan, active_day) }`.
- **Dedup:** same `(trip_id, alert_type="closing_risk")` with matching `metadata->>place_id`,
  unresolved, within 10 min → skip (same cutoff pattern as the other checks).

### B5 — wire into `check_alerts_for_trip(...)`
- Add optional `anchor_min: int | None`. After the weather block, when `active_day` is set and that
  day is today → call `_check_closing_risk(...)`; bump `alerts_inserted`.

### B6 — resolve via `adapt_trip()` (extend, don't duplicate)
- `models/trip.py::AdaptRequest`: add optional `resolution: Literal["skip","push"] | None` and
  `target_day: int | None`.
- In `adapt_trip`, branch on `alert_type == "closing_risk"`:
  - **skip** → remove the at-risk place from its day and re-route the two neighbouring legs
    (reuse the trips-router remove-place path; factor a shared helper if needed).
  - **push** → move the place to `target_day`, re-route that day's affected legs, mark the source
    day's stitch. Reuse the add-place/reorder routing already in `routers/trips.py`.
  - Build the standard `AdaptResponse` (changes + deltas) and persist via `_persist_updated_legs`.
- Resolve the alert (`resolved_at`) on accept, same as existing flows.

---

## Frontend

### F1 — `components/adaptation/AlertBanner.jsx`
- New `TYPE_CONFIG.closing_risk` (amber/orange, `Clock` icon, `labelKey: 'alertSchedule'`).
- New `ClosingRiskBanner` sub-component (sibling of `WeatherAlertBanner`):
  - Header from `metadata`: at-risk place, `close_time`, `projected_arrival`.
  - Two actions: **"Bỏ điểm này"** (`resolution:"skip"`) and **"Đẩy sang ngày khác"** (`resolution:"push"`).
  - Push expands a day list from `metadata.day_capacity` — each row shows a capacity badge
    (`Còn ~Xh` green / `Đã đầy` red, disabled-but-selectable with warning). Last-stop-with-no-later-day
    → hide push, skip only.
  - Selecting an action → `api.adaptTrip(tripId, {alert_id, session_id, resolution, target_day})` →
    preview deltas (existing `DeltaPill`) → confirm. Mirrors the existing preview/accept states.

### F2 — `pages/Trip.jsx` + `components/adaptation/ActiveLegFocus.jsx`
- Live mode already POSTs `check-alerts` with `active_day`/`active_leg_index` — closing_risk now rides
  that same call; no new trigger needed for the auto path.
- Add a small **"Tôi đã rời điểm này"** button in `ActiveLegFocus`; tapping posts `check-alerts` with
  `anchor_min` = current SGT minutes (re-anchors B2 to the real departure moment).

### F3 — `services/api.js`
- `adaptTrip` passes through optional `resolution` / `target_day`.
- `checkAlerts` passes through optional `anchor_min`.

### F4 — `contexts/LanguageContext.jsx`
- VI/EN strings: `alertSchedule`, banner copy, action labels, capacity badges, day-full warning.

### F5 — `routers/trips.py`
- `/trips/{id}/check-alerts`: accept `anchor_min` in `CheckAlertsRequest`, forward to agent.
- `/trips/{id}/adapt`: forward `resolution` / `target_day` to `adapt_trip`.

---

## Tests

**Backend** (`tests/test_agents/test_adaptation_agent.py`):
- `_close_minute_today`: single slot, multi-slot, `24h`, closed-today (`close_days`), midnight-crossing.
- `_project_today_timeline`: skips passed stops, honours `anchor_min`, excludes hotel leg.
- `_check_closing_risk`: at-risk vs safe, "already too late", picks earliest, dedup, today-only.
- `_day_capacity_summary`: full vs room, remaining-minutes, excludes current day.
- `adapt_trip` closing_risk: **skip** re-stitches legs; **push** moves to `target_day` + re-routes;
  push to a full day still works but warns.

**Frontend** (`__tests__/adaptation/AlertBanner.test.jsx`):
- Renders closing_risk banner from metadata; shows both actions.
- Push expands day picker with correct capacity badges; last-stop hides push.
- Skip/push call `adaptTrip` with the right `resolution`/`target_day`.

---

## Edge cases
- 24h / no `opening_hours` → never at risk.
- Closed today (`close_days`) → that stop can't be reached open at all → flagged (arrival after close).
- Last remaining stop with no later day available → push disabled, skip only.
- All other days full → push allowed with "ngày X sẽ quá tải" warning (capacity badge red).
- One alert at a time; re-poll after resolve picks up the next at-risk stop if any.
- Distinct from `gap_notifications` (pre-trip idle gaps) — different mechanism, no overlap.

---

## Out of scope
- Plan-time / pre-trip tightness warnings (user locked scope to live only).
- Real-time GPS-derived dwell measurement (we use leg durations + wall-clock + optional manual anchor).
- Re-optimising the *whole* trip on resolve (only the affected day(s) are re-routed).
