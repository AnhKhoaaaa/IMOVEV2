# design-system.md — IMOVE Unified Design System (đề xuất Phase 2)

> **Phase 2 deliverable — ĐỀ XUẤT, chờ duyệt. Chưa đụng app.**
> Kế thừa nền dev29 (blue + state tokens), bổ sung 3 hệ token domain còn thiếu (audit §0) theo 4 quyết định đã chốt:
> MODE-based transit · pill action / 10px input · Inter + Plus Jakarta Sans · POI/weather giữ phân nhóm (token hóa on-brand).
> Mockup trực quan: **`docs/design/design-system-preview.html`** (mở bằng trình duyệt).
> Mọi hex dưới đây **có thể chỉnh** — đây là bản đề xuất để bạn duyệt/sửa trước khi tôi áp vào code.

---

## 1. Color tokens

### 1.1 Brand (GIỮ nguyên dev29)
| Token | Hex | Dùng cho |
|-------|-----|----------|
| `--color-primary-50` | `#eff6ff` | nền nhạt, hover ghost |
| `--color-primary-100` | `#dbeafe` | badge nền |
| `--color-primary-200` | `#bfdbfe` | viền hover card |
| `--color-primary-500` | `#3b82f6` | accent phụ |
| `--color-primary-600` | `#2563eb` | **action chính (khớp logo)** |
| `--color-primary-700` | `#1d4ed8` | hover/active |

### 1.2 State — LÀM NHẠT/PASTEL HƠN (theo thang Tailwind 500) + dọn lệch
> Theo yêu cầu: state cũ (600) hơi đậm → hạ về **500** cho nhẹ/pastel hơn, vẫn đạt tương phản khi dùng làm dot/icon/solid nhỏ. Badge vẫn dùng nền `*-50` + chữ `*-700`. Tham chiếu thang Tailwind (palette thực tế, hài hòa sẵn).

| Token | Hex MỚI (500) | (cũ 600) | Nghĩa |
|-------|---------------|----------|-------|
| `--color-success` | `#10b981` | ~~#059669~~ | live / đúng giờ / thành công |
| `--color-warning` | `#f59e0b` | ~~#d97706~~ | cảnh báo / thời tiết cần lưu ý |
| `--color-danger` | `#ef4444` | ~~#dc2626~~ | gián đoạn / lỗi |
| `--color-info` | `#3b82f6` | ~~#2563eb~~ | thông tin / thời tiết trung tính |

Mỗi state kèm tint nền: `success-50 #ecfdf5 · warning-50 #fffbeb · danger-50 #fef2f2 · info-50 #eff6ff`.
→ **Bỏ hệ `sky-*` riêng** ở `AlertActionCard` (audit §0): thời tiết route về `info`/`warning`. Hết sky≈brand.

### 1.3 ⭐ Mode tokens (MỚI — transit theo MODE)
Mỗi mode 1 màu **nền badge** + **màu chữ tương phản** (bài học a11y refs.md §2 — KHÔNG ép trắng cho mọi badge). Đề xuất, chỉnh được:

| Mode | `--mode-*` nền | Chữ | Ghi chú |
|------|----------------|-----|---------|
| 🚇 MRT / Rail | `#2563eb` blue (brand) | trắng | xương sống rail = brand |
| 🚈 LRT | `#3b82f6` blue-500 | trắng | rail nhẹ hơn |
| 🚌 Bus | `#06b6d4` **cyan** | trắng | cyan tươi, thân thiện; tách rõ khỏi metro blue (yêu cầu user) |
| 🚶 Walk | `#64748b` slate | trắng | đoạn đi bộ — de-emphasize, nét đứt |
| 🚕 Taxi / Grab | `#00b14f` **Grab green** | trắng | màu thương hiệu Grab chính thức (verified) — taxi dùng Grab |
| 🚲 Cycle | `#f97316` **cam** | trắng | cam ấm; tách khỏi Grab green & cyan (yêu cầu user) |

Quy ước nền-nhạt (icon container trong card): `bg = mode tint 50` (vd MRT `#eff6ff`), `icon = mode 600`.
Hàm chọn màu chữ: nền sáng (orange/amber/lime…) → chữ `#0f172a`; nền đậm → chữ `#fff`.

### 1.4 ⭐ Category tokens (MỚI — POI, giữ phân nhóm, on-brand)
Dạng mềm `bg-50 / text-700 / border-200` như `badge.jsx` (audit §1 — nhân khuôn mẫu này). Thay indigo/violet cũ bằng bảng hài hòa:

| Nhóm POI | Hue | Token |
|----------|-----|-------|
| Văn hóa / di sản / bảo tàng | violet | `--cat-culture` |
| Địa danh / điểm tham quan | blue (brand) | `--cat-landmark` |
| Thiên nhiên / công viên / vườn | emerald | `--cat-nature` |
| Ẩm thực | amber | `--cat-food` |
| Mua sắm | pink | `--cat-shopping` |
| Giải trí / về đêm | fuchsia | `--cat-entertainment` |
| Tôn giáo / khác | slate | `--cat-default` |

### 1.5 Neutrals & Nền web (tối ưu cho ảnh places)
Một họ xám duy nhất: **slate** (`slate-50…900`). Không trộn warm/cool gray.

| Vai trò | Màu | Lý do (web nhiều ảnh) |
|---------|-----|------------------------|
| **Page background** | `#f8fafc` (slate-50, off-white mát) | KHÔNG dùng trắng tinh: off-white giảm chói, cho card trắng "nổi" tinh tế không cần viền nặng; mát → hài hòa brand blue; trung tính → ảnh places không bị ám màu. (Tham chiếu: Airbnb `#F7F7F7`, Apple `#F5F5F7`, Google Maps neutral — đều off-white cho UI nhiều ảnh.) |
| **Card / surface** | `#ffffff` | nổi trên nền slate-50; ảnh đặt trong card bo 16px |
| **Text chính (ink)** | `hsl(222 47% 11%)` ~`#0f172a` | tương phản cao trên off-white |
| **Ảnh place** | — | luôn có overlay gradient nhẹ + bo góc để hòa vào hệ; alt-text bắt buộc |

→ **Kết luận:** giữ nền `#f8fafc` (main đang dùng) là tối ưu cho web nhiều ảnh — không đổi. Nếu muốn trắng hơn nữa thì `#FFFFFF` page + card cần viền `slate-200` rõ hơn (kém khuyến nghị).

---

## 2. Typography (Inter + Plus Jakarta Sans — dùng nhất quán)

- **Display/Heading face:** `Plus Jakarta Sans` (đã có, `.font-display`) — dùng cho MỌI tiêu đề (hiện đang dùng lẻ tẻ).
- **Body/UI/Data face:** `Inter` — body, label, số liệu (`tabular-nums`).

| Bậc | Font | Size / line-height | Weight | Tracking |
|-----|------|--------------------|--------|----------|
| display-xl | Jakarta | 44/48 (clamp 36→44) | 800 | -0.02em |
| display-lg | Jakarta | 32/38 | 800 | -0.02em |
| title-lg | Jakarta | 22/28 | 700 | -0.01em |
| title-md | Jakarta | 18/24 | 700 | -0.01em |
| body-lg | Inter | 16/24 | 400–500 | 0 |
| body-md | Inter | 14/20 | 400–500 | 0 |
| caption | Inter | 12/16 | 500 | 0 |
| label | Inter | 11/14 | 700 uppercase | 0.06em (dùng tiết chế) |
| data | Inter | inherit | 600 | `tabular-nums` |

Quy tắc: body ≤ 65ch; tiêu đề câu thường (sentence case), không Title Case mọi nơi.

---

## 3. Shape (KHÓA — pill action / 10px input / 16px card)

| Phần tử | Radius | Token/class |
|---------|--------|-------------|
| Button action chính, chip, badge, segmented | **pill** `9999px` | `rounded-full` |
| Input, select, textarea, button phụ/icon | **10px** | `--radius` (0.625rem) |
| Card, panel, modal, sheet | **16px** | `rounded-2xl` / `.card` |
| Tile nhỏ trong card (icon box) | 12px | `rounded-xl` |

→ Sửa `button.jsx`: action chính `rounded-full`; size sm/icon dùng 10px. (Hiện là `rounded-md` 6px — audit §3.)

---

## 4. Spacing & layout
- Base unit **4px**; thang: 4/8/12/16/20/24/32/40/48/64.
- Container nội dung: `max-w-7xl` (≈1280) hoặc `max-w-[1400px]` cho trang rộng; padding ngang `px-4 md:px-6`.
- Section rhythm dọc: 32–48px giữa khối.
- Grid thay vì flex-math (audit/anti-slop).

## 5. Elevation (GIỮ dev29 + shadow button mới)
- `shadow-card` — trạng thái nghỉ của card.
- `shadow-pop` — hover/overlay/popover.
- **`shadow-btn` (MỚI, mức B đã chốt)** — button action chính, shadow **nhuốm màu brand** (không đen thuần):
  `0 4px 12px -3px rgb(37 99 235/.42), 0 2px 4px -2px rgb(37 99 235/.28)`; hover sâu hơn
  `0 8px 18px -4px rgb(37 99 235/.50), 0 3px 6px -3px rgb(37 99 235/.32)`.
- Button danger: shadow nhuốm đỏ tương ứng. Shadow luôn nhuốm hue của chính nút, không đen thuần.

## 6. Motion
- Token easing chuẩn: `cubic-bezier(.2,.7,.2,1)`; thời lượng 180–280ms cho UI, 450–800ms cho reveal.
- `.btn-lift` (đã có) cho button; `.card-hover` cho card tương tác.
- **Product pages (Planner/Trip) điềm tĩnh:** chỉ hover + reveal nhẹ. Motion marketing (marquee/spotlight/floating) **chỉ ở Home**. Mọi motion tôn trọng `prefers-reduced-motion` (đã có).

---

## 7. Component patterns (áp ở Phase 3)
- **Button:** pill, variants giữ nguyên (default/outline/ghost/destructive/secondary/link) + `btn-lift`. Text 1 dòng, contrast WCAG AA.
- **Card:** `.card` (16px, slate-200, shadow-card) + `.card-hover` khi click được.
- **Badge:** mở rộng `badge.jsx` → thêm nhóm `mode` (§1.3) và `category` (§1.4) dùng cùng cơ chế cva. Badge tuyến tự chọn màu chữ theo nền.
- **Transit mode card** (`CitymapperTransitCard`): bỏ `MODE_CONFIG` hex → đọc `--mode-*`; timeline leg dùng màu mode; line badge a11y-aware.
- **Input/Select/DatePicker:** 10px; accent date-picker = brand blue (bỏ slate `#1f2937`); focus-ring = blue (bỏ indigo `hsl(243…)`).
- **States:** loading = skeleton khớp layout (đã có `skeleton.jsx`); empty = có hướng dẫn; error = inline, không `alert()`.

---

## 8. Việc dọn kèm theo (Phase 3)
1. Gom 4 cách viết brand-blue (`#2563eb / #3b82f6 / rgb(37 99 235) / rgba(56,114,224)`) về token.
2. `index.css`: chuyển gradient hex hardcode (home/preview) sang dùng token màu; cân nhắc tách CSS marketing Home ra file riêng để giảm 693 dòng.
3. Thay 39 class lệch-brand + 105 hex hardcode (trừ TripMap/Leaflet hợp lệ) bằng token.

## Rerun Inputs
```
phase: 2 (design system proposal)
decisions: mode-based transit · pill-action/10px-input · Inter+PlusJakarta · POI/weather tokenized per-group
base: origin/main e9c5a25 (dev29 tokens)
outputs: docs/design/design-system.md + docs/design/design-system-preview.html
```
