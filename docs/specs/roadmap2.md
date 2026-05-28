# Roadmap 2 — Implementation Spec

> **Instruction for implementing session:** After you finish and verify each phase, replace that entire phase section with a 1–2 line summary (e.g. "✅ Phase 1 done — fixed Issues 1, 5, 7.") to save tokens for later phases.

Status markers: `[ ]` pending · `[~]` in progress · `[x]` done

---

## Context

**Stack:** React 18 + Vite frontend (`frontend/src/`) · FastAPI backend (`backend/app/`) · Supabase DB  
**Key prop flow:** `Trip.jsx` → `DayPlan` → `ActiveLegFocus` / `TransitSegment`  
**Key data shapes:**
```
TripPlan  { id, days: DayPlan[], places: Place[], warnings }
DayPlan   { day: int, legs: LegResponse[] }
LegResponse { id, from_place_id, to_place_id, transport_mode: "MRT"|"LRT"|"BUS"|"WALK", duration_minutes, cost_sgd, distance_km, is_estimated, sub_legs }
Place     { id, name, lat, lng, dwell_minutes, best_time_start, best_time_end, category, is_outdoor }
```
**API base:** `frontend/src/services/api.js` — all calls go through `request(path, options)` which throws on non-2xx.

---

## ✅ Phase 1 done — fixed Issues 1, 5, 7.
- Issue 1: removed dead `setSavedMeta` call, added `savedConfirm` state + success overlay with "Go to Home" → `navigate('/')` in `Trip.jsx`
- Issue 5: changed `{index + 1}.` → `{index}.` in `PlaceCard.jsx` (buildTimeline already gives 1-based indices)
- Issue 7: `onOptimize={tripStarted ? undefined : async () => {...}}` in `Trip.jsx`

---

## ✅ Phase 2 done — fixed Issues 2, 3, 4.
- Issue 2: `totalMin = transitMin + dwellMin` in both OverviewTab + SummaryTab; walkM uses `distance_km` when available; `totalCost` filters WALK legs
- Issue 3: removed `TRANSPORT_META`, `TRANSPORT_CYCLE`, `recommendTransport`, `cycleMode`, `TransportChip`, `cycleTransportAt` and `builder.transports` from Planner.jsx; `prefer_mrt: true` static default
- Issue 4: fixed guard `opt.apiMode === leg.transport_mode`; silent catch → `console.error`; unavailable rows hidden with `return null`; "No transit route" note added; `selected` check updated to match actual mode string

## ✅ Phase 3 done — fixed Issue 6.
- Backend: added `POST /trips/{trip_id}/days` (increment num_days) and `DELETE /trips/{trip_id}/days/{day_num}` (re-plan with num_days-1) to `trips.py`
- Frontend api.js: added `addDay` and `removeDay` methods
- Frontend Trip.jsx: `dayMutating` state; `+` button wired to `addDay` + spinner; `×` badge inside each DayPill calling `removeDay` (hidden when 1 day left or trip started)

## ✅ Phase 4 done — fixed Issue 8.
- `Trip.jsx`: added `haversineMeters` helper, `virtualStartLeg` state, `useEffect` on `tripStarted` to fetch `compareRoutes(pos→stop1)` when dist ≥ 1 km; pass `virtualStartLeg`/`onVirtualArrive` to `DayPlan`
- `DayPlan.jsx`: prop pass-through of `virtualStartLeg`/`onVirtualArrive` to `ActiveLegFocus`
- `ActiveLegFocus.jsx`: amber "GET TO START" card rendered after `CompletedStack` when `virtualStartLeg` is set; `targetIndex = completedPlaces.length + (virtualStartLeg ? 1 : 2)`
