# dev26 — Fix day-boundary loss on non-optimize trip edits

## Symptoms (reported)

1. **Add day N then delete it → a neighbouring day also disappears.** Only reappears
   after pressing *Optimise Route*.
2. **Add a place to an empty day (e.g. day 2) → after *Update Route* a place jumps to
   day 1** even though day 1 was already fine.

## Root cause (single, shared)

Every non-optimise edit funnels through
`planning_agent.plan_trip(place_ids=<flat list>, num_days, optimize_order=False)`.

The routers build a correct per-day map (`days_map`) but then **flatten** it to `all_ids`
(`trips.py` add_place `:651-662`, reorder `:728-736`), discarding *which place belongs to
which day*. Inside `plan_trip`, the `optimize_order=False` branch calls
`_distribute_days(places, num_days)` (`planning_agent.py:837`) which **re-buckets from
scratch** by simulating a 09:00–17:00 day and packing places into the earliest day that
fits, then drops empty days (`planning_agent.py:389  [d for d in days if d]`).

- **Bug 2**: places the user put on day 2 get re-packed into day 1 (still room before 17:00).
- **Bug 1**: `remove_day` (`trips.py:510`) ignores `day_num` entirely — it just does
  `num_days-1` and re-distributes everything; sparse itineraries collapse into fewer days
  and the empty tail days are dropped, so a day the user never touched vanishes. *Optimise*
  uses `_day_bucketed_greedy` which spreads evenly, so it "comes back".

The *Let AI optimise* path (`optimize_order=True` → `_day_bucketed_greedy`) is **correct by
design** — the user is asking the AI to re-distribute. Untouched.

## Fix

Add an explicit day-assignment mode to the non-optimise pipeline.

### 1. `planning_agent.plan_trip`
Add optional `day_assignments: list[list[str]] | None = None` (one place-id list per day).
When provided: build `day_groups` directly from it (look up resolved place dicts), **keep
empty groups** so the user's day count is preserved, and **skip both** `_day_bucketed_greedy`
and `_distribute_days`. Defensive: any resolved place not present in any group is appended to
the last group so no place is silently lost. `_relocate_closed_day_places` still runs (close-
day awareness is desirable and pre-existing on this path).

### 2. Routers — pass `day_assignments` built from `DayPlan.place_ids`
Switch `days_map` construction from legs-based `_ordered_place_ids(d.legs, …)` to
`[pid for pid in (d.place_ids or []) if pid != "hotel"]` (captures single-place + empty days,
removing the need for the P5-BUG-2b orphan hack), then pass
`day_assignments = [days_map.get(dn, []) for dn in range(1, num_days+1)]`.

- **`add_place`** (`:614`): preserves day grouping → fixes Bug 2.
- **`reorder_places`** (`:694`): preserves grouping for all days; validation now uses the
  place_ids-based current-day set (more correct for single-place days).
- **`remove_place`** (`:563`): preserves day grouping minus the removed place (consistency).
- **`remove_day`** (`:510`): now honours `day_num` — drop that day, keep others, append the
  removed day's places (if any) to the previous remaining day, renumber sequentially → fixes
  Bug 1 (removing an empty day touches nothing else).

`_distribute_days` is kept for the genuine flat-selection case (initial guest plan).

## Impact analysis (gitnexus, upstream)
- `plan_trip` (agent): LOW — new param is optional/keyword, no caller breaks.
- `_distribute_days`: LOW — only called by `plan_trip` + tests; signature unchanged, only
  conditionally bypassed.
- `remove_day`: LOW — HTTP endpoint, no internal callers.

## Tests
- add place to empty day 2 → place stays in day 2 after plan.
- remove empty trailing day → remaining days unchanged (count + per-day membership).
- remove a middle non-empty day → its places merge into previous day, others intact.
- reorder within a day → other days unchanged.
- `_distribute_days` still drives the no-`day_assignments` path.
