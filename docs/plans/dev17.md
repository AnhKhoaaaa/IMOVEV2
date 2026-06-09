# dev17 — Tester UX feedback batch (A, C2/C3, D, E1/E2/E3)

Scope agreed with user (from `improve.md`): implement **A1, A2, A3, C2, C3, D1, D2, E1, E2, E3** + audit all numeric inputs in the Planner. **Skip** B (i18n), C1 (keep API live payload box), E4 (resizer).

Guiding note from user: for **D** and **E3**, make the UI polished by following patterns used by large apps (segmented Low/Med/High controls; per-day colour-coding on the map like Wanderlog / Google Maps "My Maps").

---

## A — Auth & Settings

### A1. Add a sign-in CTA inside Settings (when logged out)
**File:** `frontend/src/pages/Settings.jsx`
- The `!user` branch currently shows a passive "Sign in required" amber card. Add:
  - A short benefit list (Save preferences across devices · personalised routing profile · use "My Preferences" profile in the planner).
  - A **Sign in** button that opens `AuthModal` locally.
- Implementation: add `const [showAuth, setShowAuth] = useState(false)`; render `{showAuth && <AuthModal onClose={() => setShowAuth(false)} />}`. On success, `AuthContext.onAuthStateChange` flips `user` and Settings re-renders to the preferences view automatically. No prop drilling from Header needed.

### A2. Remove the decorative icon in Settings
**File:** `frontend/src/pages/Settings.jsx`
- Remove the `<div class="grid h-12 w-12 … bg-blue-600"><SettingsIcon/></div>` block (currently L114–117) and the now-unused `Settings as SettingsIcon` import.
- Header row becomes a single left-aligned title block.

### A3. Google login graceful handling + enablement note
**Root cause:** `{"msg":"Unsupported provider: provider is not enabled"}` is a **Supabase config issue**, not a code bug. The Google provider is not enabled in the Supabase Auth dashboard.
- **Action required by user (cannot be done from code):** Supabase Dashboard → Authentication → Providers → Google → enable + set OAuth Client ID/Secret (Google Cloud OAuth consent + credentials), and add the site URL / redirect URL.
- **Code change (`AuthModal.jsx`):** make `signInWithGoogle` `async`, await the result, and surface `error.message` into `authError` instead of failing silently — so the user sees a clear message rather than nothing happening. (Currently the promise result is ignored.)
- Optional (mention only): gate the Google button behind `VITE_GOOGLE_AUTH_ENABLED` so it can be hidden until configured. **Default: not doing this** unless you ask — graceful error is enough.

---

## C — Planner inputs

### C2 + numeric-input audit
**File:** `frontend/src/pages/Planner.jsx`
- **Days** (`numDays`, L440–447): cause of "001" is the controlled-number pattern allowing empty/`0` and leading zeros. Fix with parse + clamp:
  ```js
  onChange={(e) => {
    const n = parseInt(e.target.value, 10)        // parseInt("001") === 1
    if (Number.isNaN(n)) { setNumDays(1); return }
    setNumDays(Math.min(14, Math.max(1, n)))
  }}
  ```
  Keeps `numDays` a valid 1–14 number at all times (the `dayStartTimes` effect relies on it), and guarantees no leading zeros since the displayed value is the sanitised number.
- **Transit Budget** (`budget`, L427–433): same hardening — `const n = Number(e.target.value); setBudget(Number.isNaN(n) ? 0 : Math.max(0, n))`.
- Audit confirms the only other inputs are `tripName` (text) and `dayStartTimes` (`type=time`) — no change needed.

### C3. "Go to top" button on the long Sightseeing list
**File:** `frontend/src/pages/Planner.jsx`
- Add a fixed bottom-right floating button that appears when `window.scrollY` passes a threshold (e.g. > 600px) and calls `window.scrollTo({ top: 0, behavior: 'smooth' })`. A `useEffect` adds/removes a passive scroll listener.
- Scoped to the Planner page (covers the growing step-4 list which scrolls the window).

---

## D — Preferences / Scoring (polished, big-app style)

### D1. Replace percentages with a 3-level Low / Medium / High segmented control
**Files:** `frontend/src/pages/Settings.jsx`, `frontend/src/pages/Planner.jsx`

**Settings — "Scoring weights":** replace the 4 range sliders + `%` with a 3-button segmented control per weight (big-app segmented style).
- Level→coefficient: `{ low: 1, med: 2, high: 3 }`. On **Save**, normalise: `weight_i = coeff(level_i) / Σ coeff` (backend also normalises, so this is consistent).
- Load mapping (weight→level, for display of an existing saved profile), threshold-based:
  `w >= 0.30 → high · w >= 0.18 → med · else low`. (Defaults 0.4/0.3/0.2/0.1 → High/Med/Med/Low.)
- Remove the `%` readout and the "Weight total = X.XX" card; replace with a short "Higher level = stronger priority. Levels are balanced automatically when saved." helper.

**Planner — Step 3 breakdown ("Scoring Weights Allocation"):** the preset cards stay (already a big-app pattern). In the breakdown panel, replace `{Math.round(val*100)}%` + the percentage bar with a qualitative **Low/Med/High** chip + a 3-segment indicator, using the same thresholds. No percentages shown to the user anywhere.

### D2. Remove the Constraints feature
**File:** `frontend/src/pages/Settings.jsx`
- User decision: the hard/negative checkboxes (avoid bus, avoid MRT, strongly minimise walking/fare) are too rigid and add little for SG; remove them and rely on weights only.
- Remove the `CONSTRAINTS` array, the Constraints `<section>`, `setConstraint`, and the `constraints` key from `DEFAULT_PROFILE` + `normalize()`; stop sending `constraints` in the save payload.
- **Backend-safe:** `scoring.py` reads `profile.constraints` via Pydantic `Field(default_factory=ModeConstraints)` (all-false defaults). Omitting it from the payload → defaults → no constraint applied. **No backend change required.**

---

## E — Trip view (tabs + map)

### E1. Only one transit "Change" menu open at a time + outside-click close
**File:** `frontend/src/pages/Trip.jsx` (`DayView` + `LegCard`)
- Lift open state to `DayView`: `const [openLegId, setOpenLegId] = useState(null)`. Pass `open={openLegId === leg.id}` and `onToggle={() => setOpenLegId(c => c === leg.id ? null : leg.id)}` to each `LegCard`.
- `LegCard` uses the controlled prop (fallback to internal state for the active-leg single-card call site so that path is unaffected).
- Add outside-click handling (document `mousedown` listener + ref) that resets `openLegId` to `null`, so switching to another leg / clicking elsewhere closes the previously opened panel — exactly the reported issue.

### E2. Remove the non-functional "drag handle" button
**File:** `frontend/src/pages/Trip.jsx` (`LegCard`, L337–343)
- The `GripVertical` button titled "Drag handle" only runs `setOpen(false)` — there is no drag-and-drop in `DayView`, so it does nothing visible (the tester's "button next to Change does nothing"). **Remove it.** Reordering already lives in the Overview tab (Up/Down). Drop the `GripVertical` import if it becomes unused in this file.

### E3. Colour-code the map by day + day legend (multi-day views)
**Files:** `frontend/src/components/map/TripMap.jsx`, `frontend/src/pages/Trip.jsx`
**Problem:** in Overview/Summary the map flattens every day's legs; routes are coloured by transport mode (so different days share colours and overlap), per-day numbering restarts (duplicate "1", "2"…), and nothing says which marker belongs to which day.
**Fix (big-app pattern — one colour per day):**
- Trip.jsx: build `placeDays` (placeId→day) and `legDays` (legId→day) from `trip.days`; pass them plus `colorByDay={activeTab === 'overview' || activeTab === 'summary'}` to `TripMap`.
- TripMap: add `DAY_PALETTE` (7 distinct hues, cycles). When `colorByDay`:
  - **Markers** coloured by `dayDays[place.id]` instead of category (keep the in-day sequence number).
  - **Routes** coloured by `legDays[leg.id]` — render a white halo + day-coloured fill so overlapping days stay legible.
  - **Legend** switches to "Day 1 / Day 2 …" colour swatches (instead of the transport-mode legend).
- When **not** `colorByDay` (single Day tab, or live/active-leg focus), keep the existing transport-mode colouring + mode legend (a single day is already one colour, and mode info is more useful there). Day/leg popups & tooltips unchanged.
- All new props are optional with safe defaults → existing `TripMap.test.jsx` stays green.

---

## Test plan
- `cd frontend && npm test` — full vitest suite (touches `Planner.test.jsx`, `TripMap.test.jsx`, `AuthModal.test.jsx`, etc.). Fix any fallout from input/markup changes.
- `cd frontend && npm run build` — ensure production build passes (no unused-import / syntax errors).
- Manual smoke (described, not automated): logged-out Settings shows Sign in; Days field can't show leading zeros; Travel Style shows Low/Med/High (no %); Constraints gone; opening a second leg's Change closes the first; no stray grip button; Overview/Summary map shows per-day colours + day legend.

## Out of scope / notes
- A3 provider enablement is a **dashboard action for the user**; code only makes the failure visible.
- `DayPlan.jsx` / `TransitSegment.jsx` are referenced **only by tests**, not the live Trip flow — left untouched.
- Per CLAUDE.md: run `gitnexus_impact` on the shared symbols before editing (`Settings`, `AuthModal.signInWithGoogle`, `Planner`, `LegCard`, `DayView`, `TripMap`) and report any HIGH/CRITICAL risk; `gitnexus_detect_changes` before commit.

## Commit grouping (for cherry-pickability)
1. `feat(settings): sign-in CTA + remove decorative icon` (A1, A2)
2. `fix(auth): surface Google OAuth provider error` (A3)
3. `fix(planner): harden Days/Budget numeric inputs` (C2)
4. `feat(planner): scroll-to-top on long sightseeing list` (C3)
5. `feat(prefs): Low/Med/High levels, drop percentages + constraints` (D1, D2)
6. `fix(trip): single transit menu open + remove dead drag handle` (E1, E2)
7. `feat(map): colour routes & markers by day in multi-day views` (E3)
