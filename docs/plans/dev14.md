# Dev 14 — Quick-Win Bug Fixes (7 issues)

**Status:** Pending approval  
**Source:** Architecture analysis (GAP-1 through GAP-10)  
**Scope:** 7 independent fixes across backend + frontend

---

## Impact Analysis (GitNexus)

| Symbol | Risk | Callers | Notes |
|--------|------|---------|-------|
| `_TRAVEL_SPEED_KM_MIN` | LOW | 0 upstream | Self-contained constant |
| `_is_open_now` | **HIGH** ⚠️ | 3 execution flows (adapt/weather/check) | Change is additive (timezone fix only) — no signature/return-type change |
| `score_alternatives` | LOW | `plan_trip` | Adding penalty is additive |
| `ModeConstraints` | LOW | 4 importers | New field `avoid_transfers=False` → backward-compat |
| `dedupe` | LOW | `useAlerts` → `Trip` | Non-breaking key change |

> `_is_open_now` is HIGH because it propagates through 3 scheduler flows. However, the fix is purely
> additive (supply SGT timezone to `datetime.now()`). Return type is `bool`, unchanged.

---

## Execution Order

```
Fix 1, 2, 3, 4  — independent, implement in parallel
Fix 5           — after Fix 4 (same planning flow)
Fix 6           — independent
Fix 7           — last (verify data shape from backend first)
```

---

## Fix 1 — GPS High Accuracy (GAP-3)

**File:** `frontend/src/hooks/useGeolocation.js`, line 16  
**Risk:** LOW — config-only change inside `watchPosition`, no logic change

| Before | After |
|--------|-------|
| `enableHighAccuracy: false` | `enableHighAccuracy: true` |
| `maximumAge: 30000` | `maximumAge: 5000` |

**Why:** With `false`, browser uses WiFi/cell (50-150m error in urban SG). Auto-arrive threshold is 100m → false positives. With `true` + 5s cache, GPS accuracy drops to ~5-10m.

---

## Fix 2 — Timezone in `_is_open_now` (GAP-6)

**File:** `backend/app/agents/adaptation_agent.py`, line 354  
**Risk:** HIGH flag but safe — `datetime.now()` without tz returns local server time (UTC on cloud), not SGT. Fix is timezone-only.

**grep result:** Only 1 `datetime.now()` without tz in this file (line 354). All other calls already use `datetime.now(timezone.utc)`.

Changes:
1. Add import: `from zoneinfo import ZoneInfo`
2. Line 354: `datetime.now()` → `datetime.now(tz=ZoneInfo("Asia/Singapore"))`

**Note:** `ZoneInfo` is stdlib since Python 3.9. No new dependency.

---

## Fix 3 — Dedupe Alerts by (type + line) (GAP-10)

**File:** `frontend/src/hooks/useAlerts.js`, line 9  
**Risk:** LOW

**Problem:** `byType.set(a.alert_type, a)` — NSL delay + EWL delay both have `alert_type="train_delay"` → only 1 shown.

**Fix:** Composite key `${a.alert_type}:${a.affected_line ?? 'unknown'}`.

- Weather alerts have `affected_line = null` → key becomes `"weather_warning:unknown"` → works correctly.
- Service_unavailable also null → `"service_unavailable:unknown"` → deduped correctly.

---

## Fix 4 — Travel Speed Constant (GAP-2)

**File:** `backend/app/agents/planning_agent.py`, line 93  
**Risk:** LOW — 0 upstream dependents, constant only used inside `_day_bucketed_greedy()`

`_TRAVEL_SPEED_KM_MIN = 0.1` → `_TRAVEL_SPEED_KM_MIN = 0.25`

**Why 0.25:** MRT average across 2–8km tourist routes ≈ 20-30 min per 5km = 0.25 km/min.  
With 0.1, a 5km route estimates 50 min → greedy skips it → under-packs days.  
With 0.25, same route estimates 20 min → closer to reality.

---

## Fix 5 — Wire `avoid_transfers` into Scoring (GAP-4)

**Files:**
- `backend/app/models/preferences.py` — `ModeConstraints` class
- `backend/app/services/scoring.py` — `score_alternatives()`

**Problem:** `avoid_transfers` is stored in DB via memory_agent but `ModeConstraints` has no such field → scoring ignores it.

**Changes:**

### preferences.py — Add field to ModeConstraints
```python
class ModeConstraints(BaseModel):
    avoid_bus:        bool = False
    avoid_metro:      bool = False
    minimize_walking: bool = False
    minimize_fee:     bool = False
    avoid_transfers:  bool = False   # ← ADD
```

### scoring.py — Apply penalty in score loop
In `score_alternatives()`, inside the per-mode score loop, after computing `s`, add:
```python
if profile.constraints.avoid_transfers and int(d["transfers"]) > 1:
    s = max(0.0, s - 0.30)
```

**Why -0.30:** Score is 0.0–1.0. A 0.30 penalty is significant enough to override any non-transfer route without completely zeroing high-transfer modes (safety fallback).

**Scope note:** The DB → router wiring (loading user_preferences and constructing UserPreferenceProfile with `avoid_transfers=True`) is out of scope. This fix activates the capability at the scoring layer; the router-level connection is a separate task.

---

## Fix 6 — Persist Trip State Across Refresh (GAP-1)

**File:** `frontend/src/pages/Trip.jsx`  
**Risk:** LOW — only changes useState initialization + adds useEffect side-effects

**Problem:** `tripStarted` and `activeLegIndex` are plain useState → lost on page refresh. User restarts from Day 1 even if mid-trip.

**Changes:**

1. `tripStarted` lazy initializer: reads `sessionStorage.getItem('imove_trip_started_${id}')`
2. `activeLegIndex` lazy initializer: parses `sessionStorage.getItem('imove_active_leg_${id}')`
3. Two `useEffect` to sync state → sessionStorage on change
4. Cleanup in `advanceLeg()` when trip ends (already has the `setTripStarted(false)` path)

**Keys are trip-specific** (`_${id}`) to avoid conflicts between multiple trips.

**Note:** `tripId` (`id` from `useParams()`) is available in scope at useState call time.

---

## Fix 7 — Collapsible Gap Chip ở cuối DayView (GAP-7)

**File:** `frontend/src/pages/Trip.jsx`  
**Risk:** LOW — additive render, no data mutation

**Context:** 
- `trip.gap_notifications` đã render trong `Overview` tab (lines 418–430) dạng summary block.
- `DayView` hiện không có gap visibility — user switch sang day tab mất thông tin này.
- **UX constraint:** Không được làm loãng timeline chính (place → leg → place).

**Approach:** Single collapsed chip ở **cuối** DayView (không inline giữa cards). Mặc định collapsed, click để expand.

**Data shape:**
```ts
GapNotification {
  day_index: number   // 0-based (day.day - 1)
  gap_start: string   // "HH:MM"
  gap_end: string     // "HH:MM"
  gap_minutes: number
  message: string
}
```

**Changes:**

1. Add local state `const [gapsOpen, setGapsOpen] = useState(false)` inside `DayView`.
2. In `DayView` function signature, add `gapNotifications = []` prop.
3. Filter: `const dayGaps = gapNotifications.filter(g => g.day_index === day.day - 1)`
4. At the **bottom** of the return (after the items list, outside the `items.length` check), render the collapsed chip:

```jsx
{dayGaps.length > 0 && (
  <div className="rounded-lg border border-blue-100 bg-blue-50">
    <button
      onClick={() => setGapsOpen(v => !v)}
      className="flex w-full items-center gap-2 px-3 py-2.5 text-[12.5px] font-semibold text-blue-700"
    >
      <Sparkles size={13} className="shrink-0" />
      <span>{dayGaps.length} free time gap{dayGaps.length > 1 ? 's' : ''} today</span>
      <ChevronDown size={13} className={cn('ml-auto transition-transform', gapsOpen && 'rotate-180')} />
    </button>
    {gapsOpen && (
      <div className="space-y-1.5 border-t border-blue-100 px-3 pb-3 pt-2">
        {dayGaps.map((gap, i) => (
          <div key={i} className="text-[12px] text-blue-800">
            <span className="font-bold tabular-nums">{gap.gap_start}–{gap.gap_end}</span>
            <span className="mx-1 text-blue-400">·</span>
            <span>{gap.message}</span>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

5. At the two `<DayView ...>` call sites in `Trip`, pass `gapNotifications={trip.gap_notifications ?? []}`.

**Icons used:** `Sparkles` và `ChevronDown` đã import sẵn trong Trip.jsx.

---

## Files Touched

| File | Fix(es) |
|------|---------|
| `frontend/src/hooks/useGeolocation.js` | Fix 1 |
| `backend/app/agents/adaptation_agent.py` | Fix 2 |
| `frontend/src/hooks/useAlerts.js` | Fix 3 |
| `backend/app/agents/planning_agent.py` | Fix 4 |
| `backend/app/models/preferences.py` | Fix 5a |
| `backend/app/services/scoring.py` | Fix 5b |
| `frontend/src/pages/Trip.jsx` | Fix 6 + Fix 7 |

---

## Test Plan

### Backend (cd backend && pytest tests/ -v)
- Fix 2: `test_is_open_now` — assert returns correct bool in SGT (not UTC)
- Fix 4: `test_day_bucketed_greedy` — 5km route should be included now (was excluded with 0.1)
- Fix 5: `test_score_alternatives_avoid_transfers` — mode with 2 transfers penalized when flag=True

### Frontend (vitest)
- Fix 1: unit test for `useGeolocation` config object
- Fix 3: `dedupe` unit test — two alerts with same type but different `affected_line` → both retained
- Fix 6: sessionStorage read/write on mount/change
- Fix 7: DayView renders gap card when `gapNotifications` prop contains matching day_index
