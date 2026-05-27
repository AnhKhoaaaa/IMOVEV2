# Phase 3 — UX Fixes & Data Integrity

**Status:** Planning  
**Scope:** 12 issues across 4 groups (A: UI, B: Backend Logic, C: Database/Auth, D: Data Quality)

---

## Execution order

Quick wins first, then moderate changes, backend last to minimize restart cycles.

| # | Task | Files touched | Risk |
|---|------|---------------|------|
| A3 | Remove duplicate header from Home.jsx | `pages/Home.jsx` | Low |
| A2 | Fix date overflow in TripCard | `pages/Home.jsx` | Low |
| A6 | Map legend for transport modes | `components/map/TripMap.jsx` | Low |
| C3 | Switch Supabase to PKCE flow | `lib/supabase.js` | Low |
| A1 | Delete trip button + backend endpoint | `pages/Home.jsx`, `services/api.js`, `routers/trips.py` | Medium |
| A4 | Confirm step after AI planning | `pages/Planner.jsx` | Medium |
| A5 | Real place images | `data/places.json`, `models/place.py`, `components/planner/PlaceCard.jsx` | Medium |
| B2 | Verify TransitSegment dropdown e2e | `components/planner/TransitSegment.jsx`, `pages/Trip.jsx` | Low |
| B1 | Smart transport per preferences | `agents/planning_agent.py` | Medium |
| C1 | IDOR fix: auth check on GET /trips/{id} | `routers/trips.py`, `dependencies.py` | Medium |
| C2 | Verify localStorage fallback works | `hooks/useTrip.js` (already implemented — verify only) | Low |
| D1 | Real distance_km from OneMap | `services/onemap.py`, `models/trip.py`, `components/planner/TransitSegment.jsx` | Low |

---

## Detail per task

### A3 — Remove duplicate header
**Problem:** `App.jsx` renders `<Header />` globally. `Home.jsx` has its own `<header>` block (lines 252–270) with a second IMOVE logo, Search, and User icons.  
**Fix:** Delete the inner `<header>...</header>` block from `Home.jsx` (keep only `<main>`). The global `<Header />` in `App.jsx` handles all pages.

### A2 — Date overflow
**Problem:** `DestinationThumb` in `Home.jsx` renders `dateLabel` in a floating `<span>` (top-right of the card image) with no max-width or truncation. On 375 px screens it overflows.  
**Fix:** Add `max-w-[140px] truncate` to that span.

### A6 — Map legend
**Problem:** `TripMap.jsx` defines `MODE_STYLE` (6 colors) but no legend — users can't tell which color means what.  
**Fix:** Add an absolute-positioned `div` (bottom-left, `bg-white/90 rounded-lg shadow-sm text-xs p-2`) that renders only modes present in the `legs` prop — colored swatch + label.

### C3 — PKCE flow
**Problem:** `supabase.js` uses `flowType: 'implicit'` which stores tokens in URL hash/localStorage of one browser only.  
**Fix:** Change `flowType: 'pkce'`. This makes magic-link confirmation work across devices.

### A1 — Delete trip
**Backend:** Add `DELETE /trips/{id}` to `routers/trips.py` — removes from `_trip_store`, `_trip_meta`, and Supabase tables (`route_legs`, `trip_places`, `trips`) in that order.  
**Frontend api.js:** Add `deleteTrip(id)` method calling `DELETE /trips/${id}`.  
**Frontend Home.jsx:** Add trash icon button to `TripCard`. Clicking opens a confirm dialog (using `window.confirm` — no need for the `dialog.jsx` component for this simplicity level). On confirm: call `api.deleteTrip(id)` + `remove(id)` from `useSavedTrips`. If user is currently on `/trip/:id` that trip → `navigate('/')`.

### A4 — Confirm step after planning
**Problem:** `submitManual()` and `submitAI()` in `Planner.jsx` call `saveTrip()` + `navigate()` immediately after `planTrip()` succeeds.  
**Fix:** Add a `planResult` state. After `planTrip()` succeeds, store `{tripId, meta}` in `planResult` and render a confirm step showing: trip name (editable), days count, place count, and a "Save & View Itinerary" button. Only that button triggers `saveTrip()` + `navigate()`.

### A5 — Place images
**Backend `places.json`:** Add `"image_url": "https://..."` to all 50 entries (Wikimedia Commons public domain URLs for Singapore attractions).  
**Backend `models/place.py`:** Add `image_url: Optional[str] = None`.  
**Frontend `PlaceCard.jsx`:** Update `ImageStrip()` — show `<img src={place.image_url} ...>` when available, keep placeholder gradient as fallback.

### B2 — Verify TransitSegment
`TransitSegment.jsx` already calls `api.updateLeg()` and `onUpdated()`. Verify that `DayPlan.jsx` passes `tripId={tripId}` and `onLegUpdated` correctly to `TransitSegment`. If working, mark done. If broken, fix the prop chain.

### B1 — Smart transport per preferences
**Problem:** `_primary_mode()` in `planning_agent.py` ignores `prefs`.  
**Fix (rule-based):** After getting `route` from OneMap, apply:
1. If `prefs.get("prefer_mrt") == False` and `transport_mode == "MRT"` → override to `"BUS"` (no second API call needed — just change the mode label since we already have the duration/cost from PT routing).
2. If `transport_mode == "WALK"` and `duration > prefs.get("max_walk_minutes", 20)` → override to `"BUS"`.
3. Budget check: replace `raise BudgetExceededError` with `warnings.append(...)` so planning still completes.

### C1 — IDOR fix
**Problem:** `GET /trips/{id}` returns trip to anyone with the UUID.  
**Fix:** Inject `current_user: Optional[str] = Depends(get_current_user)` (already returns `None` for unauthenticated). If `current_user` is not None, verify the trip's `user_id` matches. Guest trips (user_id=None) are accessible only when unauthenticated.

### C2 — Guest trip localStorage fallback
**Already implemented** in `useTrip.js` (lines 27–33). The catch block uses `api.getCachedTripData()` when the API returns any error (including 404 after server restart). Verify this works end-to-end and add a user-visible "Loaded from cache" indicator if `isOffline=true`.

### D1 — Real distance_km
**`onemap.py`:** For PT mode: extract per-leg distance from `leg.get("distance", 0)` and sum. For non-PT: extract `summary.get("total_distance", 0)`. Return `"distance_km": round(total_distance / 1000, 2)`.  
**`models/trip.py`:** Add `distance_km: float | None = None` to `LegResponse`.  
**`TransitSegment.jsx`:** Use `leg.distance_km` if available instead of `distM = Math.round(leg.duration_minutes * distFactor)`.

---

## Definition of Done

All 11 items in roadmap checklist for Phase 3 must be ✅.
