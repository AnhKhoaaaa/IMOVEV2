# IMOVE — Dev 3: Frontend Core

**Branch:** `dev/frontend-core`  
**Owns:** `pages/` · `components/planner/` · `components/layout/` · `components/auth/`  
**Quy trình PR, testing, anti-hallucination rules → xem PLAN_OVERVIEW.md**

---

## File ownership

```
frontend/src/pages/
  Home.jsx · Planner.jsx · Trip.jsx
frontend/src/components/planner/
  PlaceSearch.jsx · DayPlan.jsx · RouteCard.jsx
frontend/src/components/layout/Header.jsx
frontend/src/components/auth/AuthModal.jsx
frontend/vite.config.js · package.json · .env.example
```
Shared (báo nhóm trước khi sửa): `App.jsx` · `services/api.js`

---

## Phase 0 — Setup (bạn khởi tạo cho cả nhóm)

```bash
cd frontend
npm create vite@latest . -- --template react
npm install react-router-dom leaflet react-leaflet @supabase/supabase-js
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

`vite.config.js` — thêm Vitest config:
```js
test: { environment: 'jsdom', setupFiles: ['./src/setupTests.js'], globals: true }
```
`src/setupTests.js`: `import '@testing-library/jest-dom'`  
`package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`

`.env.example`:
```
VITE_API_BASE_URL=http://localhost:8000
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

**Checkpoint:** `npm run dev` load React trống · `npm run test` chạy không lỗi.

---

## Tasks — Phase 3A

### Task 1: App routing (`App.jsx` — thảo luận Dev 4 trước)
```jsx
// Routes: /  → Home · /plan → Planner · /trip/:id → Trip
import { BrowserRouter, Routes, Route } from 'react-router-dom'
```

### Task 2: api.js skeleton (share với Dev 4)
```js
export const searchPlaces = (query) => fetch(`${BASE_URL}/places/search?q=${query}`).then(handleResponse)
export const getCuratedPlaces = () => fetch(`${BASE_URL}/places/curated`).then(handleResponse)
export const createTrip = (data) => fetch(`${BASE_URL}/trips`, {method:'POST', ...}).then(handleResponse)
export const planTrip = (tripId, req) => fetch(`${BASE_URL}/trips/${tripId}/plan`, {method:'POST', ...}).then(handleResponse)
export const getTrip = (tripId) => fetch(`${BASE_URL}/trips/${tripId}`).then(handleResponse)
export const updateLeg = (tripId, legId, data) => fetch(`${BASE_URL}/trips/${tripId}/legs/${legId}`, {method:'PATCH', ...}).then(handleResponse)
```
Notify Dev 4 sau khi viết xong — họ dùng cùng file.

### Task 3: Home page
Mô tả IMOVE + nút "Bắt đầu lập kế hoạch" → navigate `/plan`. Responsive mobile. Không cần test.

### Task 4: Planner page — 4-step form
- **Step 1**: Singapore (hardcode MVP)
- **Step 2**: `PlaceSearch` — debounce 500ms → `searchPlaces()` → dropdown kết quả
  - Badge ✅ xanh nếu `in_curated_dataset: true`
  - Badge ⚠️ vàng "Thiếu dữ liệu" nếu `false` → không cho chọn
- **Step 3**: số ngày · budget SGD · checkbox "Ưu tiên MRT" · slider "Tối đa đi bộ X phút"
- **Step 4**: toggle tối ưu thứ tự → nút "Tạo kế hoạch" → loading spinner
  - `createTrip()` rồi `planTrip()` → navigate `/trip/:id`
  - Lỗi → hiện `error.message` từ backend, không tự đặt text

### Task 5: Trip page
Layout: Header (tên trip, tổng chi phí) · Tab "Danh sách" | "Bản đồ" (Dev 4 implement tab Bản đồ)

**`DayPlan.jsx`**: accordion mỗi ngày → header "Ngày 1 — 3 địa điểm" → list `RouteCard`

**`RouteCard.jsx`**:
- Icon: 🚇 MRT · 🚌 Bus · 🚶 Walk
- Thời gian + chi phí
- **`is_estimated: true` → badge "~ Ước tính" màu vàng** ← bắt buộc theo PRD
- Nút ✏️ → modal đổi transport_mode → `updateLeg()`

Soft warning banner: nếu `warnings` không rỗng → banner vàng "best time conflict" (có nút X dismiss)

### Task 6: AuthModal
- Sign In / Sign Up toggle · dùng `supabase.js` (Dev 4 tạo)
- Guest mode: đóng modal → tiếp tục không đăng nhập
- Làm sau khi core flow xong

---

## Test files

| File | Cần test gì |
|------|------------|
| `__tests__/planner/PlaceSearch.test.jsx` | Render · nhập text → gọi searchPlaces · in_curated_dataset false → badge "Thiếu dữ liệu" · click hợp lệ → thêm vào list |
| `__tests__/planner/DayPlan.test.jsx` | Render không crash · RouteCard is_estimated=true → badge · is_estimated=false → không badge |
| `__tests__/auth/AuthModal.test.jsx` | Render khi mở · nút đóng → modal đóng, không redirect |

---

## Acceptance Criteria

- [ ] `npm run test` → 100% PASS
- [ ] Flow: nhập 3 địa điểm → kế hoạch → RouteCard hiển thị đúng
- [ ] Badge "~ Ước tính" đúng khi `is_estimated: true`
- [ ] Badge "Thiếu dữ liệu" đúng khi ngoài curated dataset
- [ ] Error message từ backend hiển thị đúng (không bị nuốt)
- [ ] Responsive trên 375px mobile
