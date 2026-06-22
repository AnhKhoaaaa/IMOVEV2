# audit.md — Frontend Anti-Slop Audit (nền: origin/main `e9c5a25`)

> **Phase 1 deliverable.** Audit theo `redesign-existing-projects` (Scan→Diagnose) + lõi anti-slop của `design-taste-frontend`. Phạm vi đã đọc kỹ: `index.css` (693 dòng), primitives `ui/{button,card,badge}`, `CitymapperTransitCard` (toàn bộ), spot-check `AlertActionCard`/`PlaceCard`, + quét định lượng toàn `frontend/src`. Deep-dive từng trang sẽ làm ở Phase 3.

---

## 0. Kết luận gốc (vì sao polish trước không "dính")

dev29 đã thống nhất **2 lớp màu**: **brand** (blue `#2563eb`) và **state** (success/warning/danger). Nhưng còn **3 hệ màu "domain" bị bỏ quên — chưa token-hóa, vẫn dùng indigo/violet/sky của brand cũ**, nằm rải rác trong từng component:

| Hệ màu domain | Ở đâu | Hiện trạng |
|---------------|-------|-----------|
| **Transit mode** (MRT/LRT/BUS/WALK…) | `CitymapperTransitCard.jsx` `MODE_CONFIG` | hex tùy ý: MRT `#4f46e5` indigo, LRT `#7c3aed` violet, BUS icon emerald **nhưng** badge `#e11d48` rose → mâu thuẫn nội bộ; **không khớp** brand blue lẫn màu tuyến MRT SG thật (refs.md §2) |
| **POI category** | `PlaceCard.jsx` L11–16 | culture/heritage/museum = `violet-*`, landmark/attraction = `indigo-*` (brand cũ) |
| **Weather / alert** | `AlertActionCard.jsx` L45–253 | toàn `sky-*` — gần trùng brand blue-600, gây rối thị giác |

→ **Đây chính là thứ làm app "không đồng bộ".** Mỗi lần redesign trước chỉ sửa bề mặt trang mà không gom 3 hệ này về token → màu lạc (indigo/violet/sky) vẫn quay lại. **Phase 2 phải định nghĩa chúng thành token families** thì mới khóa được nhất quán.

---

## 1. ✅ Điều TỐT — phải GIỮ (đừng đập)

- **Token nền dev29** (`index.css` L3–21): primary blue scale + semantic `success/warning/danger` + `--radius: 10px`. Đúng hướng, refs.md xác nhận blue.
- **Primitives chuẩn & on-brand:**
  - `button.jsx`: cva variants (default/outline/ghost/destructive/secondary/link), toàn blue-600/700/800, `btn-lift`, focus-ring blue-500. Sạch.
  - `card.jsx`: `rounded-2xl border-slate-200 shadow-card` — khớp `.card`.
  - `badge.jsx`: 6 variant semantic (blue/slate/red/amber/emerald/outline). **Đây là khuôn mẫu token đúng** — nhân rộng cho domain colors.
- **Kỷ luật `prefers-reduced-motion`** xuyên suốt `index.css` (L64–67, 665–692). A11y tốt, hiếm gặp.
- **Focus keyboard nền** (L40–44) color-agnostic dùng `currentColor`. Tốt.

→ Hệ quả: nhiệm vụ **không phải** viết lại primitives, mà **bắt các component dùng primitives + token thay vì hardcode**.

---

## 2. 🎨 Màu — mức độ rải rác (định lượng)

| Tín hiệu | Số chỗ / file | Đánh giá |
|----------|---------------|----------|
| Class lệch brand `indigo/violet/purple/fuchsia/sky/cyan-*` | **39 / 11 file** | Migration indigo→blue dev29 **chưa xong**. Tệ nhất: `AlertActionCard`(10), `ActiveLegFocus`(6), `CitymapperTransitCard`(6), `PlaceCard`(5), `Trip.jsx`(3) |
| Hex hardcode trong JSX | **105 / 10 file** | `TripMap`(28, phần lớn hợp lệ cho Leaflet), `CitymapperTransitCard`(18 ❌), `DateRangePicker`(19), `ai-image-generator-hero`(13), `AuroraBackground`(10) |
| `style={{…}}` inline | **31 / 10 file** | `TripMap`(10 hợp lệ), `CitymapperTransitCard`(9 ❌ — màu lẽ ra là token) |

**Lỗi color-lock cụ thể (anti-slop "COLOR CONSISTENCY LOCK"):**
- `index.css` L103 `.focus-ring` còn **indigo** `hsl(243 75% 59%)` — sót brand cũ, lệch focus blue ở `button.jsx`. → đổi sang blue.
- `index.css` L188–205 date-picker `--rdp-accent-color: #1f2937` (**slate đen**) — ngày được chọn KHÔNG phải brand blue. Comment tự thừa nhận "swap when brand palette is set". → token hóa về blue.
- `index.css` L385 conic-gradient glowing-search còn `rgb(99 102 241)` (indigo).
- Brand blue xuất hiện dưới ≥4 dạng số khác nhau: `#2563eb`, `#3b82f6`, `rgb(37 99 235)`, `rgba(56,114,224,…)` → cùng một màu, 4 cách viết.

---

## 3. 🔲 Shape (bo góc)

- Scale tài liệu hóa rõ (`index.css` L81): `card=16px / input·btn=10px / pill=full`. Tốt.
- **Lệch:** `button.jsx` dùng `rounded-md` (**6px**) chứ không phải 10px như tài liệu. → thống nhất ở Phase 2 (đây cũng là chỗ quyết định **pill vs 10px** từ refs.md).
- Arbitrary `rounded-[…]` chỉ 7 chỗ/4 file → kỷ luật tốt, không lo.

## 4. 🅰️ Typography

- Body = **Inter** (`index.css` L28); display = **Plus Jakarta Sans** (`.font-display` L96). Có sẵn 2 face nhưng **chưa có type scale chuẩn hóa** — các trang tự đặt `text-4xl…7xl` rải rác (Trip 10, Home 9, Planner 6, Settings 3 chỗ).
- refs.md: transit app thiên geometric/rounded display. **Quyết định ở Phase 2:** giữ Inter+Jakarta hay đổi display font; chốt type scale (display/title/body/caption/data).
- Tốt: `.font-display` ép `tabular-nums` cho số liệu (L47).

## 5. 🧱 CSS bloat & motion

- `index.css` **693 dòng**, phần lớn là utility one-off cho Home/HomePreview marketing: `.preview-*` (hero/bento/journey/signal), `.motion-footer-*`, `.glowing-search__*`, `.spotlight-card`, `.stats-floating-*`, `.home-*-map`. Nhiều gradient **hex hardcode** (cyan/sky/emerald/indigo) không qua token.
- **Motion marketing rò sang product:** floating cards, marquee, conic glow, spotlight — hợp cho landing, nhưng cần đảm bảo Planner/Trip **điềm tĩnh hơn** (anti-slop "motion must be motivated"). Cần xác minh per-page ở Phase 3.

## 6. 🔁 States & a11y (cần xác minh sâu Phase 3)

- Chưa kiểm tra đủ loading/empty/error từng trang trong audit này → **không khẳng định**. Sẽ rà theo checklist khi redesign từng trang (skeleton khớp layout, empty state có hướng dẫn, error inline không `alert()`).
- Bài học a11y từ refs.md §2: badge tuyến phải **tự chọn màu chữ theo độ sáng nền** (CCL cam→chữ đen). Hiện `CitymapperTransitCard` L273 ép `text-white` cho mọi line badge → sẽ sai khi gặp nền sáng.

---

## 7. 🛠️ Kế hoạch sửa ưu tiên (rủi ro thấp → cao)

> Theo "Fix Priority" của redesign-existing-projects, điều chỉnh cho product UI.

1. **[Phase 2] Khóa token domain colors** — định nghĩa `--mode-*` (dùng màu tuyến/phương tiện SG thật + hàm chọn màu chữ tương phản), `--category-*` (POI), route weather→token. Đây là đòn bẩy nhất quán lớn nhất.
2. **[Phase 2] Hoàn tất migration → blue** — focus-ring, date-picker accent, glowing-search; gom 4 cách viết blue về 1 token.
3. **[Phase 2] Chốt shape scale** (pill vs 10px) + sửa `button.jsx` cho khớp.
4. **[Phase 2] Chốt type scale** + quyết display font.
5. **[Phase 3] Áp per-page**, thay hardcode bằng token + primitive: thứ tự **Planner → Trip → Home → Settings**. Trip ưu tiên `CitymapperTransitCard` (refactor `MODE_CONFIG`→token).
6. **[Phase 3] Bổ sung states** (loading/empty/error) + badge tuyến a11y-aware.
7. **[Phase 3] Dọn `index.css`** — gom utility one-off, thay gradient hex bằng token.

---

## 8. ❓ Quyết định cần bạn chốt ở Phase 2

1. **Hệ màu transit mode:** tô theo **MODE** (MRT/BUS/WALK — đơn giản) hay theo **LINE** (NSL đỏ/EWL xanh… — đúng chuẩn SG, refs.md §2, nhưng cần dữ liệu line từ backend)? *(Khuyến nghị: theo line khi có `route`, fallback theo mode.)*
2. **Button:** pill (full) hay giữ bo 10px? *(refs.md: pill phổ biến ở transit; nhưng pill toàn app là thay đổi nhận diện lớn.)*
3. **Display font:** giữ Inter+Plus Jakarta Sans, hay đổi sang geometric (Sora/Outfit/Space Grotesk)?
4. **POI category & weather:** giữ phân biệt màu theo nhóm (đã token hóa) hay rút về 1 accent + icon?

## Rerun Inputs
```
workflow: redesign-existing-projects (audit) + design-taste-frontend (anti-slop lens)
base: origin/main e9c5a25
scope_read: index.css, ui/{button,card,badge}, CitymapperTransitCard (full); AlertActionCard/PlaceCard (spot); quantified grep all frontend/src
output: docs/design/audit.md
```
