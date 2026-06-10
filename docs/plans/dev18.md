# dev18 — Weather adaptation: per-day scoping, richer alert, hotel return-marker fix

## Scope (from tester feedback)
1. **Hotel marker disappears on the return leg** during a live trip.
2. **`_apply_weather_swap` must be per-day**, not whole-trip. A swap suggestion appears only for a
   day whose OpenWeather forecast shows rain > 70%. The alert must name the affected day, the date,
   the rain probability, and explain *why* the alert appeared.
3. **Investigate "a new place is inserted after the hotel" when accepting a swap.**

---

## Issue 1 — Hotel marker on the return leg (frontend only)

**File:** `frontend/src/pages/Trip.jsx`, `mapPlaces` memo (~L1022–1038).

**Root cause:** during a live trip the map hides already-visited places:
```js
const visitedIds = new Set(legs.slice(0, activeLegIndex).map(l => l.from_place_id))
return (trip.places ?? []).filter(p => !visitedIds.has(p.id)).map(...)
```
The hotel is leg 0's `from_place_id`, so once you pass the first leg it lands in `visitedIds` and is
filtered out — even on the final `B → hotel` leg where the hotel is the active **destination**.

**Fix (1 line):** keep a place if it belongs to the active leg even when previously visited:
```js
.filter(p => !visitedIds.has(p.id) || activeIds.has(p.id))
```
`activeIds` is already computed just below; hoist it above the filter (small reorder).

---

## Issue 2 — Per-day weather swap + richer alert

### 2a. DB — new migration `016_lta_alerts_day_number.sql`
```sql
alter table lta_alerts add column if not exists day_number integer;
```
Nullable. Transit alerts leave it NULL; weather alerts set the affected day.
(No `metadata` column added — rain % / date / reason live in `message`, which the frontend already
parses. `day_number` is a real column so the backend can scope the swap deterministically.)

### 2b. Backend — `agents/adaptation_agent.py`
- **`_apply_weather_swap(plan, day: int | None = None)`** — new optional `day` param.
  When `day` is given, only swap outdoor places **belonging to that day** (derived from that day's
  `place_ids`/legs); legs/place_ids of other days pass through untouched. `day=None` keeps the old
  whole-trip behaviour (back-compat for tests / transit path).
- **Per-day forecast helpers**: add `_day_date(start_date, day)` and reuse `_compute_centroid` on a
  single day's place IDs. A day's outdoor set = that day's places filtered `is_outdoor`.
- **`poll_weather_alerts` / `check_alerts_for_trip`**: iterate days. For each day with outdoor
  places, fetch the forecast for *that day's date* at *that day's centroid*; if `rain > 70%`, build
  the day's indoor swap suggestions and insert ONE `weather_warning` row with `day_number=d` and a
  message like:
  > `Day 2 (Sat 13 Jun): 80% chance of rain. 2 outdoor stops may be wet — tap Preview to swap them for nearby indoor spots: Gardens by the Bay → ArtScience Museum; …`

  Dedup key extended to include `day_number` so different days don't suppress each other.
  Requires day→place mapping: `trip_places` query gains `day_number` (poll path) / use `plan.days`
  (check path). Trip start date comes from the `trips` row (`start_date`).
- **`adapt_trip`**: read `alert.get("day_number")` and pass it to `_apply_weather_swap(plan, day=…)`.

### 2c. Frontend — `components/adaptation/AlertBanner.jsx`
- Read `alert.day_number`; render a "Day N · <date>" chip and show the fuller message/reason.
- Keep the existing rain-%/outdoor-count parsing as fallback.

---

## Issue 3 — "New place inserted after the hotel"

**Finding:** `_apply_weather_swap` is verified correct via reproduction — the outdoor place is
replaced **in place**, old id removed, legs reconnected, hotel stays last:
```
places:   [hotel, fullerton, marina-bay-sands]
legs:     hotel→fullerton, fullerton→MBS, MBS→hotel
```
A place can only render "after the hotel" if it is **disconnected from every leg** — then
`buildOrderedPlaces` (`lib/tripUtils.js` L22–24) appends it at the end, which is visually after the
hotel. The latent trigger is the persist path:

**File:** `agents/adaptation_agent.py::_persist_updated_legs` (and the twin in
`routers/trips.py::_persist_trip_plan`). `place_day_order` is built **only** from `day.place_ids`.
When a plan is loaded for an older trip where `place_ids` is empty (legacy `has_day_number=False`),
every place is persisted with `day_number=NULL`; on reload the day→place map is empty and any place
not on a leg floats to the end.

**Fix (defensive):** when `day.place_ids` is empty, reconstruct it from the day's legs
(`_ordered_place_ids(day.legs, plan.places)`) before building `place_day_order`, so day assignments
are never lost across a swap. Combined with Issue 2's per-day scoping (which stops touching
unrelated days), this removes the path that surfaces stray markers.

> If the tester still sees a stray marker after these fixes, I'll need the exact repro (trip id,
> which day, before/after screenshots) — but the per-day scope + persist hardening should resolve it.

---

## Tests
- Backend: extend `tests/test_agents/test_adaptation_agent.py`
  - `_apply_weather_swap(plan, day=1)` only swaps day-1 outdoor places; day-2 untouched.
  - per-day alert carries `day_number` + day label in message.
  - persist hardening: empty `place_ids` → reconstructed from legs (no all-NULL day_number).
- Frontend: `npm run build` + existing vitest; add an AlertBanner render assertion for the day chip.

## Rollout note
Migration `016` must be applied (`supabase db push` or paste in SQL editor) before the per-day
`day_number` is stored; until then weather alerts still work (day_number simply reads NULL and the
swap falls back to whole-trip).

## Risk
GitNexus impact: `_apply_weather_swap` upstream = `adapt_trip` only (LOW); `poll_weather_alerts`
upstream = none (LOW). All edits additive/optional-param; transit reroute path untouched.
