# dev27 — Tích hợp redesign giao diện Home/Hero từ nhánh `Hữu-Long`

## Bối cảnh

Nhánh `Hữu-Long` tách ra từ điểm chung `a13cef6` và chỉ thêm 3 commit về giao diện:
- `e443020` — thêm component UI mới + ảnh hero + chỉnh Home/CSS (lẫn nhiều file rác: `node_modules.zip` 39MB, `.tex`, `report/`, `.md`).
- `3b41fec` — redesign `Home.jsx`, thêm `HomePreview.jsx`, route trong `App.jsx`.
- `31b08b0` — đổi logo `Header.jsx` sang ảnh trong suốt.

Nhánh hiện tại (`feat/dev17-ux-feedback`) đi trước **43 commit** so với điểm chung (i18n VI/EN, chat companion P5, GRAB…). Vì vậy **tuyệt đối không merge nguyên nhánh** — sẽ kéo lùi và xóa code mới.

Chiến lược: **chọn lọc** phần UI mới, giữ nguyên i18n và toàn bộ tính năng hiện có.

## Quyết định đã chốt với người dùng
- Mang **toàn bộ redesign Home + hero**.
- **Giữ i18n VI/EN** — áp lại các key dịch lên layout hero mới.

## Phạm vi thay đổi

### A. Thêm mới sạch (copy nguyên từ `origin/Hữu-Long`)
1. 6 component UI → `frontend/src/components/ui/`:
   - `ai-image-generator-hero.jsx`, `animated-glowing-search-bar.jsx`, `motion-footer.jsx`, `ripple-button.jsx`, `spotlight-card.jsx`, `wave-light-shader.jsx`
2. Ảnh hero → `frontend/public/imove-hero/*.png` (8 ảnh) + `frontend/public/imove-logo-transparent.png`
3. `frontend/src/pages/HomePreview.jsx` (trang preview)

### B. Dependency
- `frontend/package.json`: **thêm `gsap` ^3.15.0** (motion-footer cần). **GIỮ `react-markdown`** (chat hiện tại dùng — KHÔNG lấy phần Hữu-Long xóa nó).
- Chạy `npm install` để cập nhật lock.

### C. Merge thủ công (giữ i18n + tính năng hiện có)
1. `frontend/src/pages/Home.jsx` — lấy cấu trúc mới (`ImageCarouselHero`, section `WaveLightShader` + stats floating, `ScrollReveal`, `AnimatedGlowingSearchBar`, `CinematicFooter`) nhưng:
   - Giữ `useT()` và mọi `t(...)`; truyền text hero qua prop bằng key i18n.
   - Thêm key i18n mới cho tiêu đề/mô tả hero + 3 feature card vào `LanguageContext.jsx` (VI + EN).
   - Giữ `TripCard` dùng `t(...)` như bản hiện tại.
2. `frontend/src/index.css` — **append** các block CSS mới (chỉ phần class mới, bỏ qua reformat whitespace): `ripple-button`, `spotlight-card`, `glowing-search*`, `motion-footer-*`, `stats-floating-*`, `home-scroll-reveal`, `preview-*` + keyframes liên quan + khối `prefers-reduced-motion`.
3. `frontend/src/components/layout/Header.jsx` — thay khối logo gradient bằng `<img src="/imove-logo-transparent.png">` (giữ nguyên phần i18n/menu còn lại).
4. `frontend/src/App.jsx` — thêm `import HomePreview` + route `/home-preview`.

### D. KHÔNG đụng tới
- `node_modules.zip`, các file `.tex`/`report/`/`*.md` rác trong commit Hữu-Long.
- Mọi file mà diff cho thấy Hữu-Long "xóa" (AlertActionCard, ChatBlocks, useLiveCompanion, LanguageContext −810…) — đó là do Hữu-Long cũ, phải giữ bản hiện tại.

## Kiểm thử
1. `cd frontend && npm install` — không lỗi.
2. `npm run build` — build pass (không thiếu import, không vỡ gsap/webgl).
3. `npm test` — bộ test hiện có vẫn pass.
4. `npm run dev` — kiểm tra mắt: Home hero quay ảnh, search bar phát sáng, footer cinematic, chuyển VI/EN đổi đúng chữ trên hero, logo mới hiển thị.

## Ghi chú commit (để cherry-pick)
- Tách commit theo nhóm: (A) ui components + assets, (B) package.json/lock, (C) Home.jsx + i18n keys, (D) index.css, (E) Header.jsx + App.jsx.
