# dev29 — Design System Lock: Color + Cards

> Chốt **một** hệ màu accent và **một** chuẩn card/radius cho toàn hệ thống.
> Nguyên tắc nền: **redesign-preserve** (Section 11) — giữ logo, trích màu thương hiệu sẵn có, không đập đi xây lại.
> Phạm vi: chỉ `frontend/`. Không đổi logic, không đổi API, không đổi i18n nội dung.

## 1. Bối cảnh & vấn đề (đã audit)

- Logo IMOVE là **xanh dương** (cyan→lam, chữ `#2563eb`-ish). Đây là màu thương hiệu thật → accent chính phải là xanh dương.
- `index.css @theme` hiện khai báo `primary = #6366f1` (indigo/**tím — "AI-purple"**) + `accent = #f59e0b` (amber). **Không component nào dùng `primary` indigo** → token lạc.
- Component thực tế dùng lẫn lộn nhiều hệ: `blue` (93 lần/11 file), `emerald` (88/19), và nhóm `sky/indigo/violet/amber/cyan` (215/34).
- `rounded-*` xuất hiện **377 lần / 41 file**, trộn `rounded-md/lg/xl/2xl/full` + px lẻ (`28px`, `14px`, `10px`) → không có thang thống nhất.

### Phân loại màu (QUYẾT ĐỊNH PHẠM VI)
| Loại | Vai trò | Xử lý |
|------|---------|-------|
| **Brand / action** | nút chính, link, focus, nhấn mạnh thương hiệu | → **gộp về xanh dương `primary`** |
| **Semantic — transit** (`transport.js`: METRO lam / LRT tím / BUS lục / WALK cam / CYCLE teal / GRAB lá) | màu tuyến & phương tiện | **GIỮ NGUYÊN** |
| **Semantic — state** (success/live = emerald, warning = amber, danger = red, info = blue, neutral = slate) | trạng thái, cảnh báo, badge | **GIỮ NGUYÊN** (chỉ chuẩn hoá qua token) |
| **Decorative AI-slop** (glow conic `sky+indigo`, gradient 3 màu, amber làm accent travel-style) | trang trí | → **gộp về primary hoặc bỏ** |

> Quy tắc vàng: **không thay thế hàng loạt bằng find-replace.** Mỗi lần đổi phải xác định nó là *brand* hay *semantic*. Semantic giữ nguyên.

## 2. Mục tiêu (Definition of Done)

1. `@theme` chỉ còn **1 accent thương hiệu = xanh dương**; bỏ indigo primary + amber accent.
2. Có **bộ token semantic** rõ ràng (success/warning/danger/info/neutral) để ngừng hardcode rải rác.
3. Có **1 chuẩn card** (border + nền + bóng + radius) dùng lại được, thay cho việc lặp `rounded-2xl border bg-white shadow-sm` thủ công.
4. Có **1 thang radius** tài liệu hoá và áp cho card/panel/input/button/pill.
5. `npm run build` + `npm test` xanh; không hồi quy thị giác ở transit/alert (vì đã giữ semantic).

## 3. Thiết kế

### 3.1 Token màu — `frontend/src/index.css @theme`
```css
@theme {
  /* Brand / action — anchor theo logo */
  --color-primary-50:  #eff6ff;  /* blue-50  */
  --color-primary-100: #dbeafe;  /* blue-100 */
  --color-primary-200: #bfdbfe;  /* blue-200 */
  --color-primary-500: #3b82f6;  /* blue-500 */
  --color-primary-600: #2563eb;  /* blue-600 — màu hành động chính (khớp chữ logo) */
  --color-primary-700: #1d4ed8;  /* blue-700 — hover/active */

  /* Semantic (giữ ngữ nghĩa, chỉ gom token) */
  --color-success-50: #ecfdf5; --color-success-600: #059669;  /* emerald */
  --color-warning-50: #fffbeb; --color-warning-600: #d97706;  /* amber  */
  --color-danger-50:  #fef2f2; --color-danger-600:  #dc2626;  /* red    */
  --radius: 0.625rem; /* 10px — đơn vị gốc cho input/button */
}
```
- **Xoá** `--color-accent-400/500` (amber) khỏi vai trò accent thương hiệu (amber chuyển sang `warning`).
- Giữ `emerald/red/orange/violet/teal` cho semantic; **không** xoá khỏi Tailwind (mặc định vẫn có).

### 3.2 Thang radius (Shape Consistency Lock)
| Nhóm | Radius | Class |
|------|--------|-------|
| Card / panel / section / modal | **16px** | `rounded-2xl` |
| Input / button / select / small box | **10px** | `rounded-lg` (≈ `--radius`) |
| Pill / badge / avatar-chip | **full** | `rounded-full` |
| Inner thumbnail nhỏ | 8px | `rounded-md` |

Bỏ các px lẻ trong `index.css`: `preview-bento-card 28px` → 16px; `glowing-search 14/13px` → thống nhất; `rdp 10px` giữ (đã khớp input).

### 3.3 Chuẩn card
- Mở rộng `frontend/src/components/ui/card.jsx` (đã có, kiểu shadcn) thành nguồn chuẩn **HOẶC** thêm utility `.card` trong `@layer utilities`:
```css
.card { @apply rounded-2xl border border-slate-200 bg-white shadow-card; }
.card-hover { @apply transition hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-pop; }
```
- Dùng `.shadow-card` / `.shadow-pop` đã có sẵn (tinted, đúng chuẩn) thay cho `shadow-sm` chung chung.

## 4. Triển khai theo PHA (mỗi pha = 1 commit, cherry-pick được)

### Pha 0 — Token (rủi ro thấp nhất, đòn bẩy cao nhất)
- Sửa `@theme` trong `index.css`: thêm scale `primary` xanh + token semantic; bỏ indigo/amber-accent.
- **Chưa** đổi component. Vì `primary-*` cũ không ai dùng → không hồi quy.
- Test: build xanh.

### Pha 1 — Card + radius
- Thêm `.card`/`.card-hover` (hoặc chuẩn hoá `ui/card.jsx`).
- Sửa px lẻ trong `index.css` về thang radius.
- Áp `.card` cho **các panel/section lặp lại nhiều nhất** (ưu tiên: `Planner.jsx` sidebar sections, `Home.jsx TripCard`, `Trip.jsx` panels, `SummaryTab`). Pill/full giữ nguyên.
- Test: build + vitest; mắt thường so 3 trang.

### Pha 2 — Gộp accent về xanh (cẩn trọng, file-by-file)
Chuyển **chỉ các dùng decorative/brand** sang `primary`; **giữ semantic**. Trình tự:
1. `index.css`: `glowing-search` conic-gradient bỏ `sky+indigo`, còn 1 tông xanh (hoặc bỏ glow → tinted shadow, theo audit #4); `home-*` gradient giảm còn xanh + neutral.
2. `components/ui/*` (badge, button, tabs, slider…): map biến thể "primary" về `primary`.
3. Trang & planner components: rà từng `sky-*` / `indigo|violet` / `amber` →
   - nếu là **transit/alert/state** → **giữ**;
   - nếu là **nút/nhấn mạnh/trang trí** → đổi `primary`.
4. Bỏ gradient thumbnail 3 màu `from-blue-50 via-emerald-50 to-amber-50` → `from-primary-50 to-slate-50`.
- Sau mỗi file: build. Cuối pha: vitest đầy đủ.

### Pha 3 (tuỳ chọn) — dọn neon glow
- Theo audit #4: thay `glowing-search`/`spotlight-card` glow neon bằng inner-border + `.shadow-pop`. Có thể tách PR riêng nếu lớn.

## 5. KHÔNG đụng (ràng buộc)
- ❌ `lib/transport.js` tone màu (semantic tuyến/phương tiện).
- ❌ Logo (giữ nguyên file PNG).
- ❌ Màu severity alert (red/amber/emerald) ở `AlertActionCard`, `useAlerts`, status badge Home.
- ❌ Map line colors / weather colors.
- ❌ Logic, API payload, nội dung i18n.

## 6. Kiểm thử
- `cd frontend && npm run build` (xanh sau mỗi pha).
- `npm test` — đặc biệt: `Planner.test.jsx`, `Trip.test.jsx`, `AlertActionCard.test.jsx`, `Home`/`Header` (đảm bảo class đổi không phá assert).
- Grep kiểm chứng cuối: không còn `--color-primary-*` indigo; không còn `bg-amber`/`sky` ở vai trò nút chính (rà tay danh sách brand).
- Mắt thường: Home, Planner 4 bước, Trip (list+map), Settings ở **cả light** (app là light theme).

## 7. Rủi ro & giảm thiểu
| Rủi ro | Giảm thiểu |
|--------|-----------|
| Nhầm semantic thành brand → mất nghĩa màu tuyến | Pha 2 rà từng file, đối chiếu `transport.js`; không find-replace |
| Test assert theo class màu cũ | Chạy vitest sau mỗi pha; sửa test nếu assert class trình bày |
| Quy mô 377 radius/215 màu lớn | Chia pha; Pha 1/2 chỉ áp panel & brand-use, không đụng mọi pill |
| Trộn vào nhánh dev17 đang dirty | Làm trong **worktree off `main`**, FF + push, giữ dev17 nguyên |

## 8. Thứ tự commit đề xuất
1. `feat(ui): lock blue brand token + semantic color tokens (dev29 pha0)`
2. `feat(ui): standard card primitive + unified radius scale (dev29 pha1)`
3. `refactor(ui): consolidate decorative accents to brand blue, preserve semantic (dev29 pha2)`
4. *(tuỳ chọn)* `refactor(ui): replace neon glow with tinted shadow (dev29 pha3)`

---
**Chờ duyệt.** Sau khi bạn OK, tôi bắt đầu **Pha 0** trong worktree off `main`, build/test, rồi báo cáo trước khi sang pha kế.
