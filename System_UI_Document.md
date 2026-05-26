# IMOVE — AI Adaptive Transit Agent
## System Context Document — Tab Architecture, UI Hierarchy & Transition Logic

> **Version:** 2.1 (Edit-Setup modal added)
> **Status:** Implemented — reflects current build of `IMOVE Ver2.html`
> **Owners:** UX Architecture · Frontend Engineering · Product
> **Last revised:** 2026-05-26
>
> **Changelog**
> - **2.1** — Added `TripSetupModal` accessible via the new `[ ⚙ Edit setup ]` header button in the planner. Documented all previously-undocumented header controls (`[ ← Back ]`, panel expand/collapse, `[ + ]` add-day, `[ ✓ Arrived ]`, mode chip selectors). Added Flow 5 (Edit Setup) and §7 Button & Control Reference.
> - **2.0** — Citymapper-style multi-step transit card; transit-disruption alternative route (`[ Switch to Bus Route ]`).
> - **1.0** — Initial three-screen architecture.

---

## 0. Document purpose

This document is the canonical product specification for IMOVE's screen architecture, tab hierarchy, and state-transition logic. It is the source of truth for:

1. **Engineering** — to verify the React component tree (`v2-app.jsx` → `v2-home.jsx` / `v2-plan.jsx`) matches the intended state machine.
2. **UX & Visual Design** — to confirm layout density, data field coverage, and CTA placement.
3. **QA** — to derive test plans from the documented flows (Flow 1 → Flow 4).

All section labels (e.g. "The Heading Page", "Active Leg View") use the product-canonical names that appear in code comments and in the user-facing UI.

---

## 1. Top-level state machine

The application is a three-screen single-page React app. Global navigation is controlled by a single `currentScreen` value held in `<V2App>`:

| Value          | Surface                       | File                    | Entered from                        |
| -------------- | ----------------------------- | ----------------------- | ----------------------------------- |
| `home`         | Heading Page                  | `src/v2-home.jsx`       | App boot · Back from planner        |
| `initialize`   | Setup / Initialization View   | `src/v2-plan.jsx` (intro form) | `[ + Create New Itinerary ]` |
| `planner`      | Active Navigation Dashboard   | `src/v2-plan.jsx`       | `[ Open ]` or `[ ✨ Create My Trip ]` or `[ 🧭 Start Trip ]` |

```json
{
  "globalState": {
    "currentScreen": "home | initialize | planner",
    "activeTripId":  "string | null",
    "tripStarted":   "boolean",
    "activeLegIndex": "integer  // -1 = no active leg",
    "geo":           "{ status, mode, duration, coords } | null",
    "weatherAlert":  "{ legIndex, attractionName, swapName, swapId, swapped } | null",
    "transitAlert":  "{ legIndex } | null",
    "transitVariant":"'mrt' | 'bus'"
  }
}
```

---

## 1.1 Module map

| File                     | Responsibility                                                              |
| ------------------------ | --------------------------------------------------------------------------- |
| `src/v2-app.jsx`         | Top-level state machine, screen routing, geo loop, disruption handlers      |
| `src/v2-home.jsx`        | Heading Page · trip card grid · `StartTodayModal`                           |
| `src/v2-start.jsx`       | Setup / Initialization view · `COMPANIONS / STYLES / PACES` constants       |
| `src/v2-plan.jsx`        | Planner shell · Overview / Day / Summary tabs · `ActiveLegFocus` · `TripSetupModal` · `DisruptionSimulator` |
| `src/v2-transit-card.jsx`| `CitymapperTransitCard` — multi-step transit guidance                       |
| `src/v2-map.jsx`         | `V2Map` — stylised geographic SVG + animated polyline                       |
| `src/v2-data.jsx`        | Seed trips, place catalogue, summary aggregators                            |
| `src/v2-icons.jsx` / `src/icons.jsx` | Lucide-style icon set extending `window.Icon`                   |

---

## 2. Component & tab architecture

### A. The Heading Page — Root Dashboard Layout

The Heading Page is the application's hub: a card-based index of every itinerary the user owns, filterable by lifecycle state.

#### A.1 Tab filter bar (horizontal, top of viewport)

| Tab        | Predicate                                                    | Empty-state copy                       |
| ---------- | ------------------------------------------------------------ | -------------------------------------- |
| `All`      | All trips, sorted by `startDate ASC`                         | "No itineraries yet."                  |
| `Today`    | `today ∈ [trip.startDate, trip.endDate]`                     | "Nothing happening today."             |
| `Upcoming` | `trip.startDate > today`                                     | "No upcoming trips."                   |
| `Drafts`   | `trip.status === 'draft'`                                    | "No drafts saved."                     |
| `Past`     | `trip.endDate < today`                                       | "No completed trips yet."              |

Tab counts (e.g. `Today (1)`) are rendered as superscript-style pills using `tabular-nums` for stable alignment.

#### A.2 Top utility bar (global)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  IMOVE · Logo                            [ + Create New Itinerary ]     │
│  Subtitle: AI Adaptive Transit Agent                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

The `[ + Create New Itinerary ]` CTA is the **only** entry point to the `initialize` screen.

#### A.3 Trip Card — data fields

```json
{
  "tripCard": {
    "destinationName":    "Singapore",
    "heroThumbnail":      "uploads/singapore-hero.jpg",
    "dateRange":          "Jun 12 – Jun 14, 2026",
    "durationType":       "3 Days · Specific  |  5 Days · Flexible",
    "summaryMetrics": {
      "activeTime":       "14 h 30 m",
      "transitCost":      "S$24.50",
      "walkingDistance":  "8.2 km",
      "stopsCount":       8
    },
    "pacingSummary":      "Moderate pace with 8 stops across 3 days",
    "lifecycleState":     "happeningToday | upcoming | draft | past",
    "primaryAction":      "open | startTrip"
  }
}
```

#### A.4 Primary interactive actions

| Condition                          | CTA rendered                                  | Visual treatment                          |
| ---------------------------------- | --------------------------------------------- | ----------------------------------------- |
| `lifecycleState !== 'happeningToday'` | `[ Open ]`                                 | Slate outline button                      |
| `lifecycleState === 'happeningToday'` | `[ 🧭 Start Trip ]` ( + `[ Open ]` secondary ) | Indigo→fuchsia gradient, ring-pulse animation |
| Card-wide hover                    | Subtle elevation, `shadow-card → shadow-pop`  | Used for affordance, not interaction      |

---

### B. The Setup / Initialization View

A focused single-column form. Triggered exclusively from `[ + Create New Itinerary ]`.

#### B.1 Core form layout

```
┌──────────────────────────────────────────────┐
│  Starting from   [ Ho Chi Minh City      ▼ ] │
│  Heading to      [ Singapore             ▼ ] │
│                                              │
│  Dates           ( Specific )  ( Flexible )  │  ← segmented tabs
│  ──────────────────────────────────────────  │
│  if Specific:   [ Jun 12 ]  →  [ Jun 14 ]    │
│  if Flexible:   [ Duration: 3 days       ▼ ] │
└──────────────────────────────────────────────┘
```

#### B.2 Collapsible Preferences Panel

Toggle pills grouped into three labelled rows. Multi-select within each row; persisted to `trip.preferences`.

| Group              | Chips                                                       |
| ------------------ | ----------------------------------------------------------- |
| Travel Companions  | Solo · Couple · Family · Friends · Business                 |
| Travel Style       | Foodie · Culture · Adventure · Relaxed · Shopping · Nature  |
| Travel Pace        | Slow & Deep · Balanced · Packed                             |

Closed by default; chevron toggles `aria-expanded`.

#### B.3 Primary CTA

```
[ ✨ Create My Trip ]      ← full-width, gradient (purple-600 → blue-500),
                           shadow-pop on hover, ring-pulse on idle.
```

Disabled until `origin && destination && (dates || duration)` are all filled.

---

### C. The Active Navigation Dashboard

The planner is a **two-pane layout**: a left "control plane" (tabs + content) and a right "spatial plane" (live map).

```
┌────────────────────────────────────────┬──────────────────────────────────┐
│ ‹ Back  Singapore · Jun 12 – Jun 14    │                                  │
│ ┌────────────────────────────────────┐ │                                  │
│ │ Overview | Day 1 | Day 2 | Day 3 | │ │   ╔═══ V2 Map Canvas ════════╗   │
│ │ Summary                            │ │   ║                          ║   │
│ └────────────────────────────────────┘ │   ║   stylised SVG geography ║   │
│                                        │   ║   + animated polyline     ║   │
│  (tab-specific content scrolls here)   │   ║   + numbered markers      ║   │
│                                        │   ║                          ║   │
│                                        │   ╚══════════════════════════╝   │
└────────────────────────────────────────┴──────────────────────────────────┘
```

> **Deprecation note:** The previous "Ideas" tab (pre-v2) is **removed** from the navigation. Any saved ideas surface inside the **Overview** tab's "To be planned" bucket instead.

#### C.1 Planner header — control bar

The sticky header at the top of the left pane contains four control clusters, left-to-right:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ ← ]  Itinerary · Singapore · 3 days        [ ⚙ Edit setup ]  [ ⤢ ]         │
├──────────────────────────────────────────────────────────────────────────────┤
│ ( Overview )  ( Day 1 )  ( Day 2 )  ( Day 3 )  ( Summary )    [ + ]          │
└──────────────────────────────────────────────────────────────────────────────┘
```

| Control                           | Behavior                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `[ ← Back ]`                      | Calls `onBack()` → `currentScreen: 'home'`. Discards no data; trip is persisted in `trips[]`.             |
| Title block                       | Read-only display: "Itinerary · {destination} · {durationDays} days". Not interactive.                    |
| `[ ⚙ Edit setup ]` *(new in 2.1)* | Opens the `TripSetupModal` (see §C.6). Always available — works in both standard and Active Leg states.   |
| `[ ⤢ Expand / ⇲ Collapse ]`       | Toggles `mode` between `'split'` (50/50 with map) and `'expanded'` (full-width planner; map hidden).      |
| Tab pills                         | Switch the `tab` value (`'overview' | 'd{N}' | 'summary'`). See §C.1.1.                                  |
| `[ + ]` add day                   | Dashed pill at end of tab row. Appends a new empty Day to `trip.days`. *(Reserved — stub in v2.1.)*       |

#### C.1.1 Horizontal tab hierarchy

```
Overview  ➔  Day 1  ➔  Day 2  ➔  Day 3  ➔  Summary
```

- Day count is data-driven (`trip.days.length`); tabs render dynamically `Day 1 … Day N`.
- When **`tripStarted === true`**, the active Day tab shows a pulsing green dot indicator beside its label and Day tabs flanking the active one are visually subdued.

#### C.2 Overview tab — structure

| Block                       | Contents                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Day-by-day summary list     | Per-day mini-card: title, theme, stop count, total active time, mode-mix dots                 |
| `View on map` mini-card     | 240×140 thumb of the map with pin clusters, click → focuses planner map                       |
| `To be planned` bucket      | Horizontally-scrolling row of unassigned venue chips, draggable into a Day                    |
| Top-of-tab metrics strip    | Trip totals (Active Time · Transit Cost · Walking · Stops)                                    |

#### C.3 Day X tab — **standard viewing state** (trip not started)

A chronological timeline of `places[]` interleaved with `transits[]`:

```
1. Marina Bay Sands       09:30 → 11:00   ★ 4.7
       │ Transit · 18 min · S$1.90  (MRT EW · 4 stops)
2. Gardens by the Bay     11:30 → 13:30   ★ 4.8
       │ Walk · 6 min · 480 m
3. Lunch · Lau Pa Sat     14:00 → 15:00
       │ …
```

Each timeline node is read-only and lightly interactive (click to expand details, drag handles surfaced on hover).

#### C.4 Day X tab — **Active Leg View** (trip started)

When `tripStarted === true` **and** the user is on `Day {activeDayId}`, the day timeline collapses into a single focused triptych — the origin block, the active transit block, and the target venue card. Past legs collapse upward into a compact "Completed" stack; future legs collapse downward into "Up next".

##### C.4.1 Origin Block — `• YOU ARE HERE`

```
┌─────────────────────────────────────────────────┐
│  ● YOU ARE HERE                                 │
│  Lat 1.3007°N · Lng 103.8390°E                  │
│  0.42 km to Marina Bay Sands                    │
└─────────────────────────────────────────────────┘
```

- Live GPS coordinates surfaced via `navigator.geolocation.watchPosition` (or simulator for prototyping).
- Distance is recalculated each `geo` tick; uses haversine on the trip-relative coordinate grid.
- Pulse animation around the leading bullet to signal "live".

##### C.4.2 Citymapper-style Transit Block

The transit block is a multi-step accordion (`CitymapperTransitCard`). Sequence:

| Step | Label              | Data displayed                                                                 |
| ---- | ------------------ | ------------------------------------------------------------------------------ |
| 1    | **Walk to station**| Destination station name, walk minutes, walk distance                          |
| 2    | **Board**          | Line badge (color + ID), direction, platform letter, "Next train in N min", crowding chip |
| 3    | **Ride N stops**   | Expandable accordion of intermediate station names; total ride minutes        |
| 4    | **Alight**         | Station name, exit letter pill, final walk minutes & distance                  |
| 5    | **Arrived**        | Destination pin (terminal node)                                                |

```json
{
  "transitVariants": {
    "mrt": {
      "lineBadge": "EW",
      "color":     "emerald-600",
      "vehicle":   "MRT · East-West Line",
      "totalMins": 18,
      "totalStops": 4,
      "cost":      "S$1.90"
    },
    "bus": {
      "lineBadge": "7",
      "color":     "rose-600",
      "vehicle":   "Bus 7",
      "totalMins": 14,
      "totalStops": 6,
      "cost":      "S$1.90"
    }
  }
}
```

**Alternate mode selector.** When the agent recommends an alternative (see Flow 4), a sliding panel appears below the steps with a comparison strip — *Time saved · Cost delta · Transfers* — and a `[ Switch to Bus Route ]` CTA that calls `onSwitchToBus()` and re-renders the block with `transitVariant: 'bus'`.

##### C.4.3 Target Venue Block

```
┌─────────────────────────────────────────────────┐
│  #2  Gardens by the Bay              ★ 4.8      │
│  Open · 09:00 – 21:00                           │
│  [TripAdvisor Choice] [Family-friendly]         │
│  ┌────┐┌────┐┌────┐                             │
│  │img ││img ││img │     ← thumbnail gallery     │
│  └────┘└────┘└────┘                             │
│  ─────────────────────────────────────────────  │
│  Note ▾   "Try the Cloud Forest first…"         │
│                                                 │
│      [ ✓ Arrived at Destination ]               │
└─────────────────────────────────────────────────┘
```

Includes the only state-advancing CTA in the active view: `[ ✓ Arrived at Destination ]` → calls `onArrive()`.

#### C.6 Trip Setup Modal *(new in 2.1)*

A centred, dismissable overlay launched from `[ ⚙ Edit setup ]`. Lets the user re-tune the initial setup **without leaving the planner** and without losing already-planned legs.

```
┌──────────────────────────────────────────────────────────────┐
│  [Edit setup]   Trip preferences                       [ × ] │
│  Adjust dates and travel preferences. Existing days stay …  │
├──────────────────────────────────────────────────────────────┤
│  Origin  [ Ho Chi Minh City ]   Destination  [ Singapore   ] │
│                                                              │
│  Dates                                                       │
│   ( Specific dates )  ( Flexible duration )                  │
│   ┌ Start [ 2026-05-22 ] ┐  ┌ End [ 2026-05-24 ] ┐           │
│                                                              │
│  Travel companions   [Solo] [Family●] [Couple] …             │
│  Travel style        [Cultural●] [Nature] [Foodie] …         │
│  Travel pace         [Ambitious] [Moderate●] [Relaxed]       │
│                                                              │
│  ⚠  Changing dates may shift planned legs. Pacing & Summary  │
│     will recalculate; existing places stay on their day.     │
├──────────────────────────────────────────────────────────────┤
│                        [ Cancel ]   [ ✓ Save changes ]       │
└──────────────────────────────────────────────────────────────┘
```

**Editable fields**

| Field        | Type                              | Persisted to                   |
| ------------ | --------------------------------- | ------------------------------ |
| Origin       | text input                        | `trip.origin`                  |
| Destination  | text input                        | `trip.destination`             |
| Date mode    | segmented (`specific | flexible`) | `trip.dateMode`                |
| Start / End  | `<input type="date">` (specific)  | `trip.dateStart`, `trip.dateEnd` (auto-computes `durationDays`) |
| Duration     | ±N day stepper (flexible)         | `trip.durationDays`            |
| Companions   | single-select chip                | `trip.companions`              |
| Style        | multi-select chips                | `trip.style[]`                 |
| Pace         | single-select chip                | `trip.pace`                    |

**Behavior contract**
- Edits are held in a **local draft** until `[ ✓ Save changes ]` commits to `trip`.
- `[ Cancel ]`, backdrop click, or `[ × ]` close-button all dismiss without commit.
- Always available — works while `tripStarted === true`; live nav loop is **not** interrupted.
- Existing `trip.days[]` and `trip.places[]` are preserved; only top-level metadata is rewritten.
- `trip.durationLabel` is automatically rebuilt from new `durationDays` + `dateMode`.

See **Flow 5** below for the full state transition.

#### C.7 Summary tab — structure

| Block                       | Contents                                                                  |
| --------------------------- | ------------------------------------------------------------------------- |
| Trip metrics aggregate      | Total Active Time · Total Transit Cost · Total Walking Distance · Total Transfers |
| Automated Pace Check        | Comparison of planned vs typical pace, plus a textual verdict (e.g. "Comfortable") |
| Optimization history log    | Chronological badge list of agent interventions (weather swaps, transit reroutes) |
| Share / Export actions      | `[ Save as PDF ]`, `[ Share Link ]`                                       |

---

## 3. Contrast: standard view vs Active Leg view

| Aspect              | Day X — Standard (`tripStarted=false`)            | Day X — Active Leg (`tripStarted=true`)             |
| ------------------- | ------------------------------------------------- | --------------------------------------------------- |
| Layout              | Full chronological timeline of all places/transits| Triptych: Origin → Transit → Target                 |
| Past legs           | Inline in timeline                                | Collapsed into "Completed" stack at top             |
| Future legs         | Inline in timeline                                | Collapsed into "Up next" stack at bottom            |
| Transit detail      | Compact one-liner (mode · time · cost)            | Full Citymapper card (5 steps, badges, crowding)    |
| Geo block           | Hidden                                            | `• YOU ARE HERE` block at top with live coords      |
| Map sync            | Static overview of day route                      | Focused polyline on **active leg only**             |
| Day-tab indicator   | None                                              | Pulsing green dot beside active Day label           |
| Disruption banners  | Hidden                                            | Injected above the transit block when triggered     |
| Primary CTA         | None                                              | `[ ✓ Arrived at Destination ]`                      |

---

## 4. Tab navigation & state-transition logic

### Flow 1 — Initialization → Dashboard

```
[Setup form] —— click [ ✨ Create My Trip ] ——▶
   setCurrentScreen('planner')
   setActiveTripId(newTrip.id)
   setInitialTab('overview')         // ← Overview is the macro preview
   setTripStarted(false)
   setActiveLegIndex(-1)
```

| Trigger                                 | State delta                                                  |
| --------------------------------------- | ------------------------------------------------------------ |
| `[ ✨ Create My Trip ]` (new itinerary) | `currentScreen → planner`, `initialTab → 'overview'`         |
| `[ Open ]` (existing card, non-today)   | `currentScreen → planner`, `initialTab → 'overview'`         |

### Flow 2 — Activating Live Navigation

```
[Heading Page] —— click [ 🧭 Start Trip ] ——▶
   1. setCurrentScreen('planner')
   2. setInitialTab('d1')             // bypass Overview
   3. setTripStarted(true)
   4. setActiveLegIndex(0)
   5. begin navigator.geolocation.watchPosition() loop
   6. Day 1 mounts in Active Leg View, injecting:
        • YOU ARE HERE ──▶ Destination 1   (Citymapper transit block)
```

| Side-effect                              | Component touched                |
| ---------------------------------------- | -------------------------------- |
| Map redraws focused polyline             | `V2Map`                          |
| Day 1 tab grows pulsing green dot        | `Plan` tab bar                   |
| Floating Agent Simulator becomes visible | `V2App` overlay layer            |

### Flow 3 — Continuous Navigation (`Arrived` event)

```
[Active Leg View] —— click [ ✓ Arrived at Destination ] ——▶
   onArrive():
     activeLegIndex += 1
     clear weatherAlert, transitAlert
     transitVariant ← 'mrt'           // reset to default mode for next leg
```

Visual transition:

```
Before:  YOU ARE HERE ──[T]──▶ Venue 2
After :  Venue 2 (now origin) ──[T]──▶ Venue 3
```

Past legs animate upward into the "Completed" collapsed stack. The map re-runs its polyline animation on the new active leg.

**Terminal condition:** when `activeLegIndex === places.length - 1` and the user clicks Arrived, the Day rolls forward to `Day {n+1}` if available, else routes the user to the Summary tab with a `Trip Complete` toast.

### Flow 5 — Edit Setup *(new in 2.1)*

```
[Plan header]  ── click [ ⚙ Edit setup ] ──▶  setSetupOpen(true)
                                              │
                                              ▼
                                       TripSetupModal mounts
                                       (local draft = snapshot of trip)
                                              │
                                              ▼
   ┌─────────────────────────────┬─────────────────────────────┐
   │  Cancel / backdrop / [ × ]  │  [ ✓ Save changes ]         │
   │            │                │            │                │
   │            ▼                │            ▼                │
   │  setSetupOpen(false)        │  setTrip(prev => ({         │
   │  draft discarded            │     ...prev,                │
   │                             │     ...draft,               │
   │                             │     durationLabel: rebuilt  │
   │                             │  }))                        │
   │                             │  setSetupOpen(false)        │
   └─────────────────────────────┴─────────────────────────────┘
```

| Trigger                       | State delta                                                    |
| ----------------------------- | -------------------------------------------------------------- |
| `[ ⚙ Edit setup ]`            | `setupOpen → true`                                             |
| `[ ✓ Save changes ]`          | `trip ← {...trip, ...draft}` · `setupOpen → false`            |
| `[ Cancel ]` / backdrop / `×` | `setupOpen → false` (draft thrown away)                        |

**Side-effects on Save:**
- Day tab labels stay (`Day 1 … Day N`), but if `durationDays` decreased, trailing days move into a soft-deprecated stack at the bottom (engineering note: not yet UX-visible — reserved).
- Summary tab metrics & pace label recompute on next render via `tripSummary(trip)` in `v2-data.jsx`.
- The map polyline is **not** redrawn unless geographic places changed (which this modal does not touch).
- If `tripStarted === true`, the active leg pointer `activeLegIndex` is preserved.

---

### Flow 4 — Adaptive Agent Interrupt Handling

The Agent Simulator widget (bottom-right floating dock) exposes two disruption triggers:

#### 4a — Weather Disruption

```
Trigger:  [ ☔ Trigger Weather Disruption ]
  → setWeatherAlert({ legIndex: activeLegIndex,
                       attractionName, swapName, swapId, swapped: false })

Banner injected ABOVE the active transit block:
  ┌─────────────────────────────────────────────────────┐
  │ ⚠  Heavy rain expected at Gardens by the Bay        │
  │    Swap to ArtScience Museum (indoor)?              │
  │                  [ Dismiss ]    [ Approve Swap ▶ ]  │
  └─────────────────────────────────────────────────────┘

User approves:
  → onAcceptSwap():
     places[legIndex] ← swapVenue
     weatherAlert.swapped = true
     V2Map emits force-redraw to indoor venue coordinates
```

#### 4b — Live Transit Delay

```
Trigger:  [ 🚇 Trigger Transit Disruption ]
  → setTransitAlert({ legIndex: activeLegIndex })

Inside CitymapperTransitCard:
  • EW line badge gains red ring + pulse
  • Step 2 node animates red
  • Alert strip slides in:
      ┌────────────────────────────────────────────┐
      │ ⚠ Live alert · Signal fault                │
      │   Delays up to 15 mins between Somerset    │
      │   and Bugis                                │
      └────────────────────────────────────────────┘
  • Alternative panel slides in below steps:
      [ Switch to Bus Route ▶ ]   (Bus 7 · Platform A · 14 min)

User approves:
  → onSwitchToBus():
     transitVariant ← 'bus'
     transitAlert    ← null
     trip.days[d].transits[t] ← { mode: 'transit', duration: 14 }
     V2Map emits force-redraw with bus-route polyline (different curve, rose gradient)
```

#### 4 — Common contract

| Aspect                | Behavior                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| Banner placement      | **Above** the active transit block (weather) or **inside** it (transit)  |
| Map redraw            | Both flows emit a redraw signal; `V2Map` swaps polyline coords & colors  |
| Caption banner        | Updates to alert/rerouted variant with appropriate icon & color          |
| Global cost variables | Transit reroute may write a `Δcost` value into `trip.summary.transitCost`|
| Reset on leg change   | All alerts auto-clear when `activeLegIndex` advances                     |

---

## 5. Component → tab matrix

| Component (`src/…`)              | Surfaces in                                  |
| -------------------------------- | -------------------------------------------- |
| `V2Home`                         | Heading Page                                 |
| `TripCard`                       | Heading Page                                 |
| `StartTodayModal`                | Heading Page → entry pop-up                  |
| `Start` (in `v2-start.jsx`)      | Setup / Initialization                       |
| `Plan` (root)                    | Active Navigation Dashboard                  |
| `Overview` block                 | Planner → Overview tab                       |
| `DayTimeline`                    | Planner → Day X (standard view)              |
| `ActiveLegFocus`                 | Planner → Day X (active leg view)            |
| `CitymapperTransitCard`          | Inside `ActiveLegFocus` (transit block)      |
| `WeatherSwapBanner`              | Inside `ActiveLegFocus` (above transit)      |
| `TripSetupModal` *(new in 2.1)*  | Planner header overlay (any tab)             |
| `SummaryView`                    | Planner → Summary                            |
| `V2Map`                          | Planner right pane (always)                  |
| `DisruptionSimulator`            | Planner floating overlay (active leg only)   |

---

## 7. Button & Control Reference

A flat index of every interactive control in the application, grouped by surface, with its label, icon, behavior, and the state(s) it mutates.

### 7.1 Heading Page controls

| Control                        | Surface                  | Label / icon         | Action                                                                 |
| ------------------------------ | ------------------------ | -------------------- | ---------------------------------------------------------------------- |
| Create new itinerary           | Top utility bar          | `[ + Create New Itinerary ]` | `currentScreen → 'initialize'`; seeds a fresh `draftTrip`        |
| Filter tab                     | Filter bar               | `All / Today / Upcoming / Drafts / Past` | Sets local `filter` state; re-renders trip grid          |
| Open card                      | Trip card                | `[ Open ]`           | `setActiveTripId(id)` + `currentScreen → 'planner'`; tab → `overview`  |
| Start trip                     | Trip card (today only)   | `[ 🧭 Start Trip ]`  | Opens `StartTodayModal`; on confirm → planner, `tripStarted = true`    |
| Card thumbnail                 | Trip card                | (image area)         | Same as `[ Open ]` — entire card is the click target                   |

### 7.2 Setup view controls

| Control                  | Label / icon                       | Action                                                          |
| ------------------------ | ---------------------------------- | --------------------------------------------------------------- |
| Origin chip              | `[ Ho Chi Minh City × ]`           | Clears origin (placeholder for autocomplete picker)             |
| Destination input        | text field                         | Writes to `draftTrip.destination`                               |
| Date / Duration tile     | `[ Date / Duration ▾ ]`            | Opens `DateModal` (specific dates vs flexible duration)         |
| Preferences toggle       | `[ Preferences ▾ ]`                | Expands/collapses chip groups                                   |
| Companions / Style / Pace chips | emoji + label pills         | Multi-select for `style`; single-select for `companions`, `pace`|
| Create My Trip CTA       | `[ ✨ Create My Trip → ]`          | Commits draft to `trips[]`; `currentScreen → 'planner'`         |

### 7.3 Planner header controls

| Control                | Label / icon                | Action                                                                          |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Back                   | `[ ← ]`                     | `currentScreen → 'home'`; trip persists                                         |
| Edit setup *(new)*     | `[ ⚙ Edit setup ]`          | Opens `TripSetupModal` (see Flow 5)                                             |
| Expand / collapse pane | `[ ⤢ ]` / `[ ⇲ ]`           | Toggles map visibility — `mode: 'split' ↔ 'expanded'`                          |
| Tab pill               | `Overview / Day N / Summary`| Sets `tab`                                                                       |
| Add day                | `[ + ]` (dashed)            | *(Reserved)* Will push an empty day onto `trip.days`                            |

### 7.4 Active Leg View controls

| Control                  | Surface (inside ActiveLegFocus) | Action                                                                                |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------- |
| Mode chip selector       | Origin block · `Walk · Transit · Drive` | `onChangeGeoMode(mode)` — rewrites `geo.mode` & duration                      |
| Step accordion (Ride)    | CitymapperTransitCard step 3    | Expands intermediate stop list                                                        |
| Switch to Bus Route      | Citymapper alt panel            | `onSwitchToBus()` — `transitVariant: 'mrt' → 'bus'`; clears `transitAlert`            |
| Dismiss transit alert    | Alert strip `[ × ]`             | `setTransitAlert(null)`                                                               |
| Approve weather swap     | Weather banner `[ Approve ▶ ]`  | `onAcceptSwap()` — mutates `trip.days[d].places[]`; `weatherAlert.swapped = true`     |
| Dismiss weather          | Weather banner `[ Dismiss ]`    | `setWeatherAlert(null)`                                                               |
| Apply drive (transit)    | (legacy fallback button)        | `onApplyDrive()` — rewrites transit mode to `drive`, recomputes duration & cost       |
| Arrived at destination   | Target venue card · `[ ✓ Arrived at Destination ]` | `onArrive()` → `activeLegIndex += 1`; clears alerts                |
| Back to itinerary view   | Trip-complete state · `[ ← ]`   | `onResetTrip()` — `tripStarted = false`; back to standard timeline                    |
| Note input               | Target venue card               | Saves freeform note onto place (`trip.days[d].placeNotes[id]`)                        |

### 7.5 Trip Setup Modal controls *(new in 2.1)*

| Control                 | Label / icon                 | Action                                                          |
| ----------------------- | ---------------------------- | --------------------------------------------------------------- |
| Close                   | `[ × ]`                      | `setSetupOpen(false)`; draft discarded                          |
| Backdrop                | (click outside card)         | Same as close                                                   |
| Date-mode toggle        | `( Specific )( Flexible )`   | `draft.dateMode = 'specific' | 'flexible'`                      |
| Start / End date        | `<input type="date">`        | Writes to draft; auto-computes `durationDays`                   |
| Duration ± stepper      | `[ − ]` / `[ + ]`            | Adjusts `draft.durationDays` (clamped 1–30)                     |
| Pref chip               | emoji + label                | Toggles chip in draft (single or multi as per group)            |
| Cancel                  | `[ Cancel ]`                 | Discard draft; close modal                                      |
| Save changes            | `[ ✓ Save changes ]`         | Commit draft → `trip`; close modal                              |

### 7.6 Disruption Simulator controls (debug overlay)

| Control                       | Label / icon                       | Action                                                  |
| ----------------------------- | ---------------------------------- | ------------------------------------------------------- |
| Minimise                      | `[ — ]` / floating `[ ✨ ]` re-open | Collapses to a pill in bottom-right                     |
| Trigger weather disruption    | `[ ☔ Trigger Weather Disruption ]` | Sets `weatherAlert` for current leg                     |
| Trigger transit disruption    | `[ 🚇 Trigger Transit Disruption ]`| Sets `transitAlert` for current leg                     |
| Reset trip                    | `[ ⟲ Reset ]`                      | `onResetTrip()` — `tripStarted = false`                 |

### 7.7 Map controls

| Control                       | Action                                                            |
| ----------------------------- | ----------------------------------------------------------------- |
| Caption banner (passive)      | Top-of-map status line — non-interactive; updates with leg state  |
| Numbered place marker         | (Reserved) Will focus that place's card in the Day tab            |

---

## 6. Out-of-scope / future work

- **Multi-day chaining of Active Leg view.** Today, Day handoff is manual when last leg completes; planned to auto-advance.
- **Real geolocation accuracy ring** on the map (currently simulated).
- **Persistent optimization log** across sessions (currently in-memory).
- **Voice prompts** for transit step transitions ("Alight at next stop").

---

*End of System Context Document — IMOVE Ver2.*
