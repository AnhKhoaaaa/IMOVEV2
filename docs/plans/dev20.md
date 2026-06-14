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
> - **Actions = adaptive, user picks** from whatever is actually feasible: *Leave earlier* (trim the
>   current stay when that alone fixes it — preferred), *Skip*, and *Push to another day* (must show
>   per-day capacity: room / full / closed, with remaining minutes).
> - **Messaging:** every unavailable option states its reason in plain language — no silent hides.

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

**Why a runtime check is needed even though planning checks opening hours:** both planner paths
(`_day_bucketed_greedy` for AI-optimize, `_distribute_days` for keep-order) enforce
`open ≤ arrival ≤ close−dwell` for the *normal* placement, but each has a **best-effort fallback** that
places a stop outside its window when nothing fits (optimize emits a "could not fit in scheduled time
window" warning; keep-order places it in the lightest day silently). Plus the planner assumes a fixed
09:00 start and estimate-based travel, so real-world drift is expected. dev20 is the live safety net
for exactly those cases.

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

### B2 — `_project_today_timeline(plan, active_day, active_leg_index, now_min, arrived_at_min, anchor_min) -> list[dict]`
- Reconstruct ordered place-ids of `active_day` via `_ordered_place_ids_from_legs(day.legs)`.
- Remaining stops = those at/after the `to_place` of the leg indexed by `active_leg_index`
  (stops already visited are skipped; hotel return leg excluded).
- **Set the start clock from the user's real state — this is what makes "left early + stayed late"
  net out correctly without false alarms:**
  - **Departed** (user pressed "I left this stop" → `anchor_min` set, or `active_leg_index` points at
    an in-transit leg): `clock = anchor_min or now_min`; the just-left place's dwell is already spent,
    so don't re-add it.
  - **Currently dwelling** at the stop they last arrived at (`arrived_at_min` set): the projected
    **departure** of that stop = `max(now_min, arrived_at_min + dwell)`. Arriving *early* keeps this
    early (downstream stays on time); *overstaying* only pushes it once `now` passes the planned
    departure — i.e. exactly when the banked time is used up. No double-counting of the in-progress dwell.
- For each subsequent remaining stop, in order: `arrival = clock + leg.duration_minutes` (persisted
  leg time); `finish = arrival + dwell` (`suggested_duration_minutes`); `clock = finish`.
- Returns `[{place_id, arrival_min, finish_min}, ...]`.

> **Worked example (the user's case):** plan = leave P1 13:00 → P2 13:30 (dwell 60) → P3 15:00
> (closes 15:30, `min_useful` 30 → latest-ok 15:00). Actual: leave P1 12:30 (−30), arrive P2 13:00,
> stay 90 (+30), leave 14:30 → P3 15:00. At every poll, projected departure of P2 =
> `max(now, 13:00+60=14:00)`, so P3 ≈ 14:30→15:00 ≤ 15:00 throughout → **no false alarm, correctly
> judged on-time.** The 30 saved at P1 and 30 lost at P2 cancel because P1's early departure made
> `arrived_at_P2` early in the first place.

### B3 — `_day_capacity_summary(plan, active_day, place) -> list[dict]`
For every day **other than** `active_day`, return both a **time-capacity** verdict and a
**place-open** verdict for the specific at-risk `place`:
- **Capacity** — reuse `_check_schedule_fit` math: `occupied = Σ(travel + dwell)` from 09:00;
  `remaining_minutes = max(0, 1050 - (540 + occupied))`.
- **Open that weekday** — live trips are `HAPPENING_TODAY`, so the active day's date == today.
  Derive each candidate day's date as `today + (day - active_day)` (no `start_date` needed → works
  offline/guest), take its weekday name, and check `place["close_days"]`. (Per-weekday `opening_hours`
  don't exist in the dataset — slots are identical on every open day — so `close_days` is the only
  per-day gate.)
- **Combined `status`** per candidate day:
  - `"closed"` — `weekday ∈ place.close_days` → the place is shut that day → **not selectable**.
  - `"full"`  — open, but `540 + occupied > 1050` (17:30) → selectable **with an overload warning**.
  - `"room"`  — open and has spare time.
- Returns `[{day, date, weekday, occupied_minutes, remaining_minutes, status}, ...]`. Surfaced in
  alert metadata so the UI can render "Day 3 — còn ~2h" / "Day 2 — đã đầy" / "Day 4 — đóng cửa T2".
- If **every** other day is `"closed"` for this place → no valid push target (B4 omits the push
  option; UI shows skip only).

### B4 — `_check_closing_risk(trip_id, plan, active_day, active_leg_index, anchor_min) -> bool`
- Only runs when `_day_date(start_date, active_day) == today`.
- Project timeline (B2). For each remaining stop with a close time (B1): define
  `min_useful = min(dwell, CLOSING_MIN_USEFUL_MIN)` (config default 30) and
  `latest_ok_arrival = close_min - min_useful`. The stop is **at risk** when
  `arrival_min > latest_ok_arrival` (covers "already too late": `arrival ≥ close`).
  `deficit = arrival_min - latest_ok_arrival` = how many minutes early the user must be.
- Fire **one** alert for the **earliest** at-risk stop (avoids spam; next poll re-evaluates after resolution).

**Recovery analysis — decide which resolutions are actually feasible (don't jump to skip/push):**
- **`leave_earlier` (preferred)** — the at-risk stop is reachable in time if the user trims dwell at
  the stop(s) they still control *before* it. `recoverable_slack = Σ(dwell − min_useful)` over the
  place the user is at/heading to and any intermediate stops before the at-risk one.
  Feasible iff `deficit ≤ recoverable_slack`. Compute a concrete **target leave time** for the
  nearest controllable stop = `planned_leave − deficit` (trim nearest-first, each floored at its
  `min_useful`). This is **advisory** — no place removed or moved.
- **`skip`** — always feasible (drop the at-risk stop).
- **`push`** — feasible only if `_day_capacity_summary` (B3) yields ≥1 non-`closed` day. Otherwise
  carry an explicit reason: `"closed_all"` (place shut on every remaining day) or `"no_other_day"`
  (single-/last-day, nowhere to move).

- Insert `alert_type="closing_risk"`, `day_number=active_day`, a human message that **states the
  problem and the best fix** (*"Bạn dự kiến tới Tràng An lúc 18:25 nhưng nơi này đóng cửa 18:00. Rời
  điểm hiện tại trước 17:40 là vẫn kịp."*), and structured `metadata`:
  ```
  metadata = {
    place_id, place_name, projected_arrival, close_time, deficit_min,
    resolutions: {
      leave_earlier: { feasible, current_place_name, target_leave_time, save_minutes }
                     | { feasible: false },
      skip:          { feasible: true },
      push:          { feasible, reason?: "closed_all" | "no_other_day",
                       day_capacity: [ {day, date, weekday, remaining_minutes, status}, ... ] },
    },
  }
  ```
  The UI renders only feasible actions and shows the `reason` text for any it hides/disables (see F1).
- **Dedup:** same `(trip_id, alert_type="closing_risk")` with matching `metadata->>place_id`,
  unresolved, within 10 min → skip (same cutoff pattern as the other checks).

### B5 — wire into `check_alerts_for_trip(...)`
- Add optional `arrived_at_min` and `anchor_min` (ints, minute-of-day SGT). `now_min` is derived
  server-side from `datetime.now(SGT)`. After the weather block, when `active_day` is set and that
  day is today → call `_check_closing_risk(...)`; bump `alerts_inserted`.

### B6 — resolve via `adapt_trip()` (extend, don't duplicate)
- `models/trip.py::AdaptRequest`: add optional
  `resolution: Literal["leave_earlier","skip","push"] | None` and `target_day: int | None`.
- In `adapt_trip`, branch on `alert_type == "closing_risk"`:
  - **leave_earlier** → **advisory, no structural change.** Don't touch places/legs; just mark the
    alert acknowledged (`resolved_at`) so it won't re-fire in the dedup window. The projection
    self-corrects once the user actually leaves early and advances the leg (their "I left this stop"
    anchor / `active_leg_index` moves on). Return an `AdaptResponse` with zero deltas and a `changes`
    note ("Rời {current_place} trước {target_leave_time} để kịp {place_name}").
  - **skip** → remove the at-risk place from its day and re-route the two neighbouring legs
    (reuse the trips-router remove-place path; factor a shared helper if needed).
  - **push** → move the place to `target_day`, re-route that day's affected legs, mark the source
    day's stitch. Reuse the add-place/reorder routing already in `routers/trips.py`.
    **Guard:** recompute `close_days` for `target_day`'s weekday and **reject the push** (return an
    error in `AdaptResponse`/4xx) if the place is closed that day — never trust the client's choice.
  - skip/push build the standard `AdaptResponse` (changes + deltas) and persist via `_persist_updated_legs`.
- Resolve the alert (`resolved_at`) on accept, same as existing flows.

---

## Frontend

> **Messaging principle (applies to every state below):** never silently hide or disable an option.
> If a resolution isn't offered, say *why* in plain language so the user isn't left guessing.

### F1 — `components/adaptation/AlertBanner.jsx`
- New `TYPE_CONFIG.closing_risk` (amber/orange, `Clock` icon, `labelKey: 'alertSchedule'`).
- New `ClosingRiskBanner` sub-component (sibling of `WeatherAlertBanner`):
  - Header from `metadata`: *"{place_name} đóng cửa {close_time} — bạn dự kiến tới {projected_arrival}
    (trễ ~{deficit_min}p)."*
  - Render **only the feasible actions** from `metadata.resolutions`, ranked least-disruptive first:
    1. **"Rời sớm hơn"** (`leave_earlier`, when `feasible`) — highlighted/recommended:
       *"Rời {current_place_name} trước {target_leave_time} (sớm hơn ~{save_minutes}p) là vẫn kịp."*
    2. **"Bỏ điểm này"** (`skip`) — always available.
    3. **"Đẩy sang ngày khác"** (`push`, when `feasible`) — expands the day list from
       `resolutions.push.day_capacity`; each row badged by `status`: `room` → `Còn ~Xh` (green,
       selectable); `full` → `Đã đầy ~Xp` (amber, selectable with warning); `closed` →
       `Đóng cửa T{weekday}` (grey, **disabled, with the reason shown inline**).
  - **When an action is not feasible, show the reason instead of hiding blankly:**
    - `leave_earlier` infeasible → no card, but the header keeps the "trễ ~{deficit}p" context.
    - `push` infeasible → show a disabled-style note: `closed_all` → *"Không thể dời sang ngày khác —
      {place_name} đóng cửa vào tất cả các ngày còn lại của chuyến đi."*; `no_other_day` →
      *"Không thể dời — đây là ngày cuối / không còn ngày nào khác."*
  - Selecting an action → `api.adaptTrip(tripId, {alert_id, session_id, resolution, target_day})` →
    preview deltas (existing `DeltaPill`; `leave_earlier` previews zero deltas + the advice text) →
    confirm. Mirrors the existing preview/accept states.

### F2 — `pages/Trip.jsx` + `components/adaptation/ActiveLegFocus.jsx`
- Live mode already POSTs `check-alerts` with `active_day`/`active_leg_index` — closing_risk now rides
  that same call; no new trigger needed for the auto path.
- **Capture `arrived_at`** when the user presses "Arrived" (the dev13 arrived/advance flow already
  exists): store the timestamp in the same `sessionStorage` slot as `active_leg`, and send it as
  `arrived_at_min` (minute-of-day SGT) on subsequent `check-alerts` calls so B2 can use
  `max(now, arrived_at + dwell)` for the in-progress stop.
- Add a small **"Tôi đã rời điểm này"** button in `ActiveLegFocus`; tapping posts `check-alerts` with
  `anchor_min` = current SGT minutes (re-anchors B2 to the real departure moment) and clears `arrived_at`.

### F3 — `services/api.js`
- `adaptTrip` passes through optional `resolution` / `target_day`.
- `checkAlerts` passes through optional `arrived_at_min` / `anchor_min`.

### F4 — `contexts/LanguageContext.jsx`
- VI/EN strings: `alertSchedule`, banner header (with deficit), the three action labels
  (`leave_earlier`/`skip`/`push`) + leave-earlier advice, capacity badges (room/full/closed), and the
  push-infeasible reasons (`closed_all`, `no_other_day`).

### F5 — `routers/trips.py`
- `/trips/{id}/check-alerts`: accept `arrived_at_min` / `anchor_min` in `CheckAlertsRequest`, forward to agent.
- `/trips/{id}/adapt`: forward `resolution` / `target_day` to `adapt_trip`.

---

## Tests

**Backend** (`tests/test_agents/test_adaptation_agent.py`):
- `_close_minute_today`: single slot, multi-slot, `24h`, closed-today (`close_days`), midnight-crossing.
- `_project_today_timeline`: skips passed stops, honours `anchor_min`, excludes hotel leg;
  dwelling stop uses `max(now, arrived_at + dwell)`; **net-zero case** (arrive early + overstay by the
  same amount) projects on-time and fires no alert; pure overstay beyond the bank does fire.
- `_check_closing_risk`: at-risk vs safe, "already too late", picks earliest, dedup, today-only;
  computes `deficit`; `leave_earlier.feasible` true when `deficit ≤ recoverable_slack` and false
  beyond it; `push.reason` = `closed_all` / `no_other_day` in the right cases.
- `_day_capacity_summary`: room vs full vs closed (close_days), remaining-minutes, excludes current day.
- `adapt_trip` closing_risk: **leave_earlier** changes nothing, resolves alert, zero deltas;
  **skip** re-stitches legs; **push** moves to `target_day` + re-routes; push to a `full` day warns;
  push to a `closed` day is **rejected** server-side.

**Frontend** (`__tests__/adaptation/AlertBanner.test.jsx`):
- Renders only the feasible actions; `leave_earlier` shown first with the target-leave time.
- Push expands day picker with correct status badges; `closed` rows disabled with weekday reason.
- When push infeasible, the explicit reason text (`closed_all` / `no_other_day`) is rendered.
- Each action calls `adaptTrip` with the right `resolution`/`target_day`.

---

## Edge cases
- 24h / no `opening_hours` → never at risk.
- Closed today (`close_days`) → that stop can't be reached open at all → flagged (arrival after close).
- **Small deficit recoverable by leaving earlier** → `leave_earlier` offered as the recommended fix;
  skip/push still available but secondary. (This is the case the user called out — don't force a
  skip/push when trimming the current stay is enough.)
- Last remaining stop with no later day → push hidden **with reason** (`no_other_day`), skip only.
- All other days `full` (but open) → push allowed with "ngày X sẽ quá tải" warning (amber badge).
- Candidate day where `close_days` includes that weekday → `closed`, not selectable + weekday reason
  shown (backend also rejects). If **every** other day is `closed` → push hidden **with reason**
  (`closed_all`), skip only.
- One alert at a time; re-poll after resolve picks up the next at-risk stop if any.
- Distinct from `gap_notifications` (pre-trip idle gaps) — different mechanism, no overlap.

---

## Out of scope
- Plan-time / pre-trip tightness warnings (user locked scope to live only).
- Real-time GPS-derived dwell measurement (we use leg durations + wall-clock + optional manual anchor).
- Re-optimising the *whole* trip on resolve (only the affected day(s) are re-routed).
