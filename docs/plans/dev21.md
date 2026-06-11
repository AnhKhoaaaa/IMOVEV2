# dev21 — Plan-time scheduling correctness (get the itinerary right up front)

Companion to **dev20** (runtime closing-risk alert). dev20 is the live safety net; dev21 reduces how
often that net is needed by making the *initial* plan respect opening constraints better. Both are
rule-based (no LLM) and share the same opening-hours / `close_days` semantics.

> **Goal:** fewer itineraries that schedule a stop on a day it's closed, or outside its hours, or in an
> order that makes a tight-window stop unreachable — and when the planner genuinely can't fit
> everything, **say so clearly** instead of silently overflowing.

---

## Problems in the current planner

Both distribution paths live in `agents/planning_agent.py`:
- **AI-optimize** (`optimize_order=True`) → `_day_bucketed_greedy` (`:138`) + `_assign_evening_to_days`.
- **Keep-order** (`optimize_order=False`) → `_distribute_days` (`:250`).

1. **No `close_days` awareness.** Both paths check `opening_hours` (time-of-day) but never map a day
   index → weekday → `close_days`. `plan_trip` (`:561`) doesn't even receive `start_date`, so it can't.
   → A place can be scheduled on a day it is closed.
2. **Silent best-effort overflow.** When nothing fits a window, `_distribute_days` (`:310-317`) drops
   the place into the lightest day **ignoring hours, with no warning**; `_day_bucketed_greedy`
   (`:210-215`) at least emits a "could not fit" warning. Inconsistent + partly invisible to the user.
3. **Ordering ignores window urgency.** The optimize greedy picks `min(candidates, key=haversine)`
   (`:200`) — nearest place — so an early-closing / narrow-window stop can be deferred until its window
   has passed, then overflowed.
4. **Fixed 09:00 start** (`START_MIN=540`) in both paths; users can't say a day starts later/earlier
   (already noted in `To_fix.md`).

---

## Scope (P1–P3 now; P4 deferred)

P1–P3 are cheap, rule-based, and high-value. P4 (configurable day start) is larger (touches the
Planner UI + API contract) and is listed but **out of scope for this plan** unless requested.

---

## P1 — `close_days` awareness at plan time

### P1.1 Shared helper — `agents/planning_agent.py`
- New pure fn `_is_open_on_weekday(place, weekday_name: str) -> bool`: `False` if
  `weekday_name ∈ place.close_days`, else `True`. (Time-of-day stays handled by the existing
  `_parse_opening_hours`; `close_days` is the day-of-week gate.) Mirrors the semantics of
  `adaptation_agent._is_open_now` so the two agents agree.

### P1.2 Thread `start_date` into planning
- `plan_trip(...)` gains `start_date: date | None = None`. `routers/trips.py` already has the trip's
  `start_date` (from `TripCreate`) → pass it through. When `None` (guest / no dates) → P1 is a no-op
  (graceful, same as today).
- Both distribution fns receive `start_date` (or a precomputed `day_index → weekday` list). Day `N`'s
  date = `start_date + (N-1) days` → weekday name.

### P1.3 Apply the gate
- **`_distribute_days`** and **`_day_bucketed_greedy`**: when testing whether a place fits day `N`,
  also require `_is_open_on_weekday(place, weekday_of[N])`. A place closed that weekday is **never**
  placed there; the loop tries other days.
- If a place is closed on **every** day of the trip window → it can't be scheduled at all → add a
  clear warning (see P3) and place it best-effort with the warning, rather than dropping it silently.

---

## P2 — Window-urgency-aware ordering (optimize path only)

Keep nearest-neighbour as the default (route efficiency), but stop deferring stops whose window is
about to close.

### P2.1 `_day_bucketed_greedy` candidate selection
- Among the already-feasible `candidates` at the current `clock`, change the pick from pure nearest
  (`min(..., key=haversine)`) to a **two-tier key**: first prefer candidates whose window is *closing
  soon* relative to `clock` (e.g. `oh_close - (clock + travel_est) < URGENCY_MIN`, default 90), then
  by distance within each tier. This grabs an early-closing stop before it becomes infeasible while
  still keeping nearby stops first when nothing is urgent.
- Pure heuristic, O(candidates) — no optimiser, consistent with the 75%-rule-based constraint.

> Keep-order path is intentionally *not* reordered (user chose that order) — P1 + P3 cover it.

---

## P3 — Transparent fallback + plan-level feasibility feedback

### P3.1 Make keep-order warn too
- `_distribute_days` best-effort branch (`:310-317`): when it places a stop outside its window or on a
  closed day, append a warning string (same shape as the optimize path) so it reaches
  `TripPlan.warnings`. No more silent out-of-hours placement.

### P3.2 Distinct, actionable warning messages
- Differentiate the reasons so the UI can show something useful:
  - `"{name}: scheduled outside opening hours — day too tight"`
  - `"{name}: closed every day of your trip — consider different dates"`
  - `"Day {n} is over-packed; consider adding a day or removing a stop"` (from `_check_schedule_fit`
    overfull result, already computed).
- These flow through the existing `TripPlan.warnings` list (already surfaced in the planner UI).

### P3.3 (optional, small) Surface in Planner UI
- If warnings exist, the Planner review step shows them as an amber notice before the user confirms —
  "plan right from the start" feedback loop. Reuses existing warning rendering if present.

---

## P4 — Configurable per-day start time (DEFERRED — not in this plan)
- Replace fixed `START_MIN=540` with a user-set start per day (Planner field already requested in
  `To_fix.md`). Touches Planner UI, `TripPlanRequest`, and both distribution fns. Larger surface;
  break out into its own plan if/when prioritised.

---

## Tests

**Backend** (`tests/test_agents/test_planning_agent.py`):
- `_is_open_on_weekday`: closed weekday → False; open weekday / empty `close_days` → True.
- `_distribute_days` with `start_date`: a place closed on day-1's weekday is pushed to an open day;
  closed-every-day → placed best-effort **and** warned.
- `_day_bucketed_greedy`: an early-closing stop is picked before a nearer all-day stop when its window
  is about to close (P2); nearest-first behaviour unchanged when nothing is urgent.
- Warnings: keep-order out-of-hours placement now emits a warning (P3.1); messages match P3.2.
- `start_date=None` → behaviour identical to today (no regression).

**Frontend** (if P3.3 done) — Planner review shows warnings notice when `plan.warnings` non-empty.

---

## Edge cases
- `start_date` unknown → `close_days` gate skipped (best-effort, no regression).
- Place open 24h / no `opening_hours` → never constrained by P1/P2.
- Single-day trip → `close_days` still applies (that one weekday); urgency ordering still helps.
- Hotel anchor (`opening_hours:"24h"`) is exempt from all gates.
- P2 must not starve a far-but-all-day stop forever — urgency only *raises* priority when a window is
  imminent; otherwise distance wins.

---

## Relationship to dev20
- Shared semantics: `_is_open_on_weekday` (P1.1) and dev20's `close_days` push-guard should agree;
  factor a single helper if convenient.
- dev21 reduces closing-risk frequency at plan time; dev20 still required for real-world execution
  drift (overstays, transit delays, late starts) that no plan-time logic can pre-empt.

## Out of scope
- P4 configurable day start (above).
- Real OneMap routes on the keep-order path (kept as instant haversine estimates by design).
- Full time-window vehicle-routing optimisation (VRPTW) — over-engineering vs the rule-based budget.
