# Plan: Draft Auto-Save & Re-plan Context Refactor

## Context

Hai vấn đề độc lập cần giải quyết trong sprint này:

1. **Draft auto-save** — Hiện tại trip được tạo trong Supabase (status=DRAFT) nhưng KHÔNG được lưu vào localStorage ngay sau khi planning xong. Nếu user đóng tab hoặc navigate ra giữa chừng trước khi bấm "Save", trip biến mất khỏi Home page. Trip cần được auto-save vào localStorage ngay với `isDraft: true`.

2. **Re-plan operations thiếu context** — 5 endpoint re-plan (`optimize`, `remove_day`, `remove_place`, `add_place`, `reorder`) gọi `planning_agent.plan_trip()` mà không truyền `profile` (user preferences) và `context` (weather + peak hours). Kết quả là mode scoring bỏ qua sở thích user và điều kiện thực tế.

---

## Phạm vi thay đổi

### Phần 1 — Frontend: Draft Auto-Save (5 files)

#### File 1 — `frontend/src/pages/Planner.jsx`

**Thêm `useAuth` import và gọi `api.saveTrip()` ngay sau `planTrip()` thành công:**

```javascript
import { useAuth } from '../contexts/AuthContext'

// Trong component body:
const { user: authUser } = useAuth()

// submitManual() — sau api.planTrip() thành công:
const draftName = tripName.trim() || 'Singapore Trip'
api.saveTrip(trip.trip_id, {
  name: draftName,
  startDate: manFlexible ? null : manStartDate,
  numDays: manNumDays,
  isDraft: true,
}, authUser?.id ?? null)
navigate(`/trip/${trip.trip_id}`, {
  state: { pendingSave: { name: draftName, startDate: manFlexible ? null : manStartDate, numDays: manNumDays } },
})

// submitAI() — tương tự, draftName = 'Singapore Trip', startDate từ aiStartDate/aiFlexible
```

**Lý do**: Trip đã tồn tại trên backend. Auto-save vào localStorage ngay để nó hiện trên Home page nếu user tắt tab. `pendingSave` vẫn được giữ để hiển thị "Review → Save" banner trong Trip.jsx.

---

#### File 2 — `frontend/src/lib/tripUtils.js`

**Thêm tham số `isDraft = false` vào `computeTripStatus()`:**

```javascript
// Trước
export function computeTripStatus(startDate, numDays) {
  if (!startDate) return 'draft'
  ...
}

// Sau
export function computeTripStatus(startDate, numDays, isDraft = false) {
  if (isDraft) return 'draft'    // ← explicit draft flag bypasses date logic
  if (!startDate) return 'draft'
  ...
}
```

**Lý do**: Trip có `startDate` nhưng chưa được user confirm vẫn phải hiện là `draft`, không phải `upcoming` hay `today`. Không trigger notification.

---

#### File 3 — `frontend/src/hooks/useSavedTrips.js`

**Pass `isDraft` flag vào `computeTripStatus()`:**

```javascript
function enrich(raw) {
  return raw.map((t) => ({
    ...t,
    status: computeTripStatus(t.startDate, t.numDays ?? 1, t.isDraft ?? false),
  }))
}
```

---

#### File 4 — `frontend/src/pages/Trip.jsx`

**Khi user bấm Save từ SummaryTab, xóa `isDraft` flag:**

```javascript
// Trong onSave handler (dòng ~475):
onSave={(name) => {
  const meta = { ...pendingSave, name, isDraft: false }  // ← graduate from draft
  saveTrip(id, meta)
  setPendingSave(null)
  try { sessionStorage.removeItem(pendingKey) } catch {}
  setSavedConfirm(true)
}}
```

---

#### File 5 — `frontend/src/components/planner/DayPlan.jsx`

**Xóa `!tripId` khỏi `dragDisabled` — drag luôn hoạt động khi không đang di chuyển:**

```jsx
// Trước
dragDisabled={!tripId || isActiveDay || reordering}

// Sau
dragDisabled={isActiveDay || reordering}
```

**Lý do**: Trip luôn được lưu ngay khi tạo (thay đổi từ File 1), nên `tripId` từ `useParams()` luôn hợp lệ. Condition `!tripId` không còn ý nghĩa và chỉ gây nhầm lẫn.

---

### Phần 2 — Backend: Re-plan Context Refactor (1 file)

#### File 6 — `backend/app/routers/trips.py`

**Thêm helper `_fetch_plan_context()` ở cuối file (trước helper section):**

```python
async def _fetch_plan_context(
    current_user: Optional[str],
) -> tuple[UserPreferenceProfile, ContextSnapshot]:
    """Shared helper cho tất cả re-plan operations: fetch preferences + weather.
    
    Luôn trả về giá trị hợp lệ — Supabase failure và weather failure đều non-fatal.
    """
    profile = UserPreferenceProfile()
    if current_user and supabase:
        try:
            pref_resp = (
                supabase.table("user_preferences")
                .select("profile")
                .eq("user_id", current_user)
                .limit(1)
                .execute()
            )
            if pref_resp.data:
                profile = UserPreferenceProfile(**pref_resp.data[0]["profile"])
        except Exception as exc:
            log.warning("Preferences fetch failed for %s (using defaults): %s", current_user, exc)

    rain_mm = 0.0
    try:
        from app.services import openweather
        weather = await openweather.get_current_weather()
        rain_mm = weather.get("rain_1h", 0.0)
    except Exception:
        pass

    return profile, ContextSnapshot.now(rain_mm=rain_mm)
```

**Áp dụng vào 5 endpoint — thêm 2 dòng vào mỗi endpoint trước khi gọi `plan_trip()`:**

```python
# Thêm trước mỗi planning_agent.plan_trip() call:
profile, context = await _fetch_plan_context(current_user)

# Thêm 2 kwargs vào plan_trip() call:
    profile=profile,
    context=context,
```

| Endpoint | Vị trí hiện tại | Thay đổi |
|---|---|---|
| `POST /{id}/optimize` | line ~366 | thêm `_fetch_plan_context` + kwargs |
| `DELETE /{id}/days/{day}` | line ~451 | thêm `_fetch_plan_context` + kwargs |
| `DELETE /{id}/places/{place_id}` | line ~495 | thêm `_fetch_plan_context` + kwargs |
| `POST /{id}/places` | line ~564 | thêm `_fetch_plan_context` + kwargs |
| `PATCH /{id}/reorder` | line ~629 | thêm `_fetch_plan_context` + kwargs |

**Lưu ý**: `_fetch_plan_context` là `async def` → các endpoint này đều đã là `async def`, không cần thay đổi gì khác.

---

### Thứ tự thực hiện

```
1. tripUtils.js          — thêm isDraft param (dependency của useSavedTrips)
2. useSavedTrips.js      — pass isDraft vào computeTripStatus
3. Planner.jsx           — auto-save draft + useAuth
4. Trip.jsx              — clear isDraft on save
5. DayPlan.jsx           — remove !tripId condition
6. trips.py              — _fetch_plan_context + 5 endpoint updates
```

---

## Tests cần cập nhật / thêm mới

### Frontend

**`frontend/src/__tests__/hooks/useSavedTrips.test.js`** — thêm:
```
test_draft_flag_overrides_today_status
  — trip với startDate=today và isDraft=true → status='draft'
test_draft_flag_overrides_upcoming_status  
  — trip với startDate=tomorrow và isDraft=true → status='draft'
test_save_clears_draft_flag
  — (integration) sau khi saveTrip với isDraft=false, status re-computes correctly
```

### Backend

**`backend/tests/test_routers/test_trips.py`** — thêm:
```
test_optimize_uses_preference_profile
  — mock preferences fetch returns custom profile → plan_trip called với profile đó
test_reorder_uses_weather_context  
  — mock openweather returns rain → plan_trip called với ContextSnapshot có rain_mm > 0
```

---

## Verification

### Frontend
```bash
cd frontend
npm test
# Kiểm tra: trip mới tạo hiện ngay trên Home page dưới tab "Drafts"
# Kiểm tra: drag hoạt động ngay sau khi plan xong (trước khi Save)
# Kiểm tra: trip có startDate=hôm nay + isDraft=true KHÔNG trigger StartTodayModal
# Kiểm tra: sau khi Save → status đổi sang 'upcoming'/'today'/'past' đúng
```

### Backend
```bash
cd backend
pytest tests/test_routers/test_trips.py -v
pytest tests/ -v
```
