# Dev 2 Plan — Frontend Core (Phase 3A) + UI Upgrade

**Branch:** `dev/backend-infra` (Dev 1 làm tạm thời cho Dev 3)
**Ngày:** 2026-05-20

---

## Phần 1 — Phase 3A: Frontend Core Implementation

### Prerequisite fix (shared model)
`backend/app/models/place.py` — thêm `in_curated_dataset: bool = True`  
Lý do: `place.in_curated_dataset` luôn `undefined` → Add button disabled cho mọi kết quả search.

### Tasks đã hoàn thành

| Task | Files | Mô tả |
|------|-------|-------|
| Home page | `pages/Home.jsx` | CTA "Bắt đầu lập kế hoạch", `useNavigate` |
| Header + AuthModal | `components/layout/Header.jsx` | Sign In button → mở AuthModal; guest mode |
| Planner 4 steps | `pages/Planner.jsx` | Step 3 thêm MRT checkbox + walk slider; step 4 tách riêng với optimize toggle; preferences truyền vào `planTrip` |
| PlaceSearch | `components/planner/PlaceSearch.jsx` | Debounce 500ms, badge "Thiếu dữ liệu", Add button disabled cho non-curated |
| DayPlan | `components/planner/DayPlan.jsx` | Header "Ngày X — Y địa điểm", nhận `tripId` prop |
| RouteCard | `components/planner/RouteCard.jsx` | Nút ✏️ + edit modal + `updateLeg()`, `displayMode` local state |
| Trip page | `pages/Trip.jsx` | Warnings banner dismissible, pass `tripId` xuống DayPlan |
| AuthModal | `components/auth/AuthModal.jsx` | Kiểm tra error Supabase, guest mode, `String(authError)` |

### Bug fixes quan trọng
- `crypto.randomUUID()` fallback cho HTTP (non-HTTPS)
- NaN guard cho `numDays` / `budget` inputs
- `useTrip`: ignore flag tránh race condition, `useCallback` cho `refresh`
- `useAlerts`: channel name unique per trip, fetch existing alerts on mount
- `alertBanner`: try/catch trong `handleAdapt`

### Test suite: 77 tests pass
```
PlaceSearch.test.jsx   — 11 tests (debounce, badge, Add button)
RouteCard.test.jsx     — 16 tests (badge, edit modal, updateLeg, displayMode)
DayPlan.test.jsx       — 7 tests  (header text, badge)
AuthModal.test.jsx     — 11 tests (sign in/up, error, guest mode)
Header.test.jsx        — 5 tests  (Sign In → AuthModal)
Trip.test.jsx          — 8 tests  (loading skeleton, warnings banner, tripId)
Planner.test.jsx       — 19 tests (4 steps, preferences, submit, navigate, errors)
```

---

## Phần 2 — UI Upgrade: Shadcn/ui + Tailwind CSS

### Setup

**Tailwind v4 với Vite plugin (không cần `tailwind.config.js`):**
```bash
npm install -D tailwindcss postcss autoprefixer @tailwindcss/vite
npm install lucide-react clsx tailwind-merge class-variance-authority
npm install @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-tabs
npm install @radix-ui/react-checkbox @radix-ui/react-slider @radix-ui/react-select @radix-ui/react-label
```

**`vite.config.js`:** thêm `tailwindcss()` plugin  
**`src/index.css`:** `@import "tailwindcss"` + `@theme { --color-primary-500: #0ea5e9; ... }`  
**`src/lib/utils.js`:** `cn()` helper (clsx + tailwind-merge)

### Color palette (sáng và thân thiện)
- **Primary:** Sky blue `#0ea5e9` (sky-500) — transit/travel feel
- **Background:** White + sky-50 gradient
- **Text:** Slate-900 / Slate-500
- **Border:** Slate-200
- **Success:** Emerald, **Warning:** Amber, **Error:** Red

### UI Components tạo thủ công (`src/components/ui/`)

| Component | Radix primitive | Dùng cho |
|-----------|----------------|----------|
| `Button` | `@radix-ui/react-slot` + cva | Mọi button |
| `Input` | — | Form inputs |
| `Label` | `@radix-ui/react-label` | Form labels |
| `Card` / `CardHeader` / `CardContent` | — | DayPlan, RouteCard |
| `Badge` | — + cva | "~ Ước tính", "Thiếu dữ liệu" |
| `Alert` / `AlertDescription` | — + cva | Error, warnings |
| `Dialog` / `DialogContent` | `@radix-ui/react-dialog` | AuthModal, RouteCard edit |
| `Tabs` / `TabsList` / `TabsTrigger` | `@radix-ui/react-tabs` | Trip list/map |
| `Checkbox` | `@radix-ui/react-checkbox` | Planner step 3 |
| `Slider` | `@radix-ui/react-slider` | (unused — dùng native range cho test compat) |
| `Select` | `@radix-ui/react-select` | (unused — dùng native select cho test compat) |
| `Skeleton` | — | Trip loading state |

> **Lý do native select/slider:** Radix primitives không respond với `fireEvent.change` → test thất bại. Native HTML elements đảm bảo test compatibility.

### Components nâng cấp

| Component | Thay đổi |
|-----------|---------|
| `Header` | Sticky, logo + MapPin icon, mobile hamburger menu |
| `Home` | Hero gradient, feature cards với lucide icons |
| `Planner` | Step indicator với checkmarks, Card container, native range slider |
| `PlaceSearch` | Search icon, loading spinner, styled dropdown list |
| `AuthModal` | Radix Dialog, proper Label/Input, guest mode button |
| `RouteCard` | Card + lucide icons thay emoji, Dialog edit với native select |
| `DayPlan` | Custom button toggle, CalendarDays icon |
| `AlertBanner` | Alert Shadcn, lucide icons theo alert type |
| `Trip` | Tabs Shadcn, Skeleton loading cards |

---

## CORS fixes

**`backend/app/main.py`:** thêm `CORSMiddleware` cho `localhost:5173`, `localhost:5174`

**`backend/app/routers/trips.py` + `alerts.py`:**  
Thay `raise NotImplementedError` → `return JSONResponse(status_code=501, ...)`.  
Lý do: unhandled exception propagate ra ngoài middleware stack → CORS header mất trên error response.

---

## Verification

```bash
# Backend
cd backend
pytest tests/ -v          # 38 pass, 1 skip

# Frontend
cd frontend
npm run test              # 77/77 pass
npm run dev               # http://localhost:5173

# CORS check
curl -H "Origin: http://localhost:5173" http://localhost:8000/places/search?q=marina
# → Access-Control-Allow-Origin: http://localhost:5173
```
