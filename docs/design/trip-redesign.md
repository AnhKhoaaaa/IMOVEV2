# Trip page — redesign audit & plan (Phase 3)

Branch: `feat/dev17-ux-feedback` @ b1236bb. Scope: rewrite presentation, keep logic.
Workflow: audit → propose → user approves → code → test → commit (per page).

## Files in scope
- `src/pages/Trip.jsx` (1873 lines) — header+tab nav, mode banner, alert strip, 2-col (list+map), modals.
  Internal components: `TransportBadge`, `CompactPlaceCard`, `PlaceCard`, `LegCard`, `Overview`, `DayView`.
- `src/lib/transport.js` — `TRANSPORT_META` (single mode-color source for badges/icons/map hex).
- `src/components/planner/CitymapperTransitCard.jsx` — own `MODE_CONFIG` (live-leg transit card).
- `src/components/map/TripMap.jsx` — polyline fill colors per mode.
- Sub-components reused: `SummaryTab`, `RouteCard`, `ActiveLegFocus`, `TransitSegment`.

## Root finding — THREE divergent mode-color systems (none use the locked tokens)
| Mode | transport.js | CitymapperTransitCard | TripMap polyline | Locked token (index.css) |
|------|-------------|----------------------|------------------|--------------------------|
| MRT  | blue #2563eb | indigo #4f46e5 | (brand) | `--color-mode-mrt` #2563eb |
| LRT  | violet #7c3aed | violet #7c3aed | — | `--color-mode-lrt` #3b82f6 |
| BUS  | emerald #10b981 | emerald #059669, badge **rose #e11d48** | #059669 | `--color-mode-bus` **#06b6d4 cyan** |
| WALK | orange #f97316 | orange #ea580c | #ea580c | `--color-mode-walk` **#64748b slate** |
| CYCLE| teal #0d9488 | teal #0d9488 | #0f766e | `--color-mode-cycle` **#f97316 orange** |
| GRAB | green-util #00b14f | violet (DRIVE) | — | `--color-mode-taxi` #00b14f |

**Fix:** make `transport.js` the single source that emits both Tailwind tone classes (`bg-mode-bus-50
text-mode-bus`) and hex from the tokens; `CitymapperTransitCard` + `TripMap` consume it. Deletes
`MODE_CONFIG` divergence. Tests asserting old hex (TripMap.test BUS/WALK/CYCLE; possibly
CitymapperTransitCard.test) updated to new tokens — intentional color change.

## Secondary findings (anti-slop / design-system drift)
1. **Raw buttons everywhere** (~15): `bg-blue-600`, `bg-emerald-600`, `bg-green-600`, `bg-teal-600`,
   all `rounded-md`, manual `btn-lift shadow-sm`. Should use the design-system `Button` (pill +
   brand-tinted shadow). Need a `success` intent for Start/Arrived/Live (emerald) — propose adding
   a `success` variant to button.jsx rather than inlining.
2. **Radius drift**: cards `rounded-lg`, modals `rounded-xl`/`rounded-3xl`, badges `rounded-md`.
   Unify to the 10px `--radius` scale (cards `rounded-[10px]`/`rounded-xl`, pills `rounded-full`).
3. **Status colors ad hoc**: emerald=live, amber=edit/estimated, sky=weather, red=error — map these
   onto state tokens (success/warning/info/danger) for consistency.
4. **Mode banner + status pill** (lines 1604–1630) duplicate the header's Live chip — consolidate.
5. **PlaceCard category chip** uses `bg-blue-50 text-blue-700` for ALL categories — should use the
   `cat-*` POI tokens (culture/landmark/nature/food/shopping/entertainment) like PlaceBrowser now does.

## Proposed workstreams (for approval)
- **A — Mode color unification** (core, app-wide, high-leverage, low-risk data change). Touches
  transport.js + CitymapperTransitCard + TripMap + 2–3 tests.
- **B — Buttons → design system** (pill + shadow + `success` variant). Trip.jsx + button.jsx.
- **C — Surface/radius/state-token polish** (cards, banners, tabs, category chips).
- **D — Layout changes (bố cục)** — the 2-col list+map is already Citymapper-grade; candidate
  restructures: Overview day-card grid, header tab nav, consolidate the two status banners. Bigger,
  optional.

Open question for user: scope (A+B+C vs +D), and whether to build a visual mockup first (like
Planner) or apply directly since Trip's layout is largely sound.
