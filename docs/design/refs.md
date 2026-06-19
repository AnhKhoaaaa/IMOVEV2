# refs.md — Transit App Design Evidence (for IMOVE frontend redesign)

> **Phase 0 deliverable.** Bằng chứng thiết kế thật, thu bằng firecrawl, để làm nền cho design system ở Phase 2. **Không bịa** — mọi giá trị đều ghi rõ nguồn & độ tin cậy.

## Phương pháp & lưu ý trung thực

- **Nguồn:** firecrawl `branding` scrape các trang marketing (chụp 2026-06-19) + Wikipedia *Module:Adjacent stations/SMRT* cho màu tuyến MRT Singapore chính thức.
- **Giới hạn quan trọng:** token dưới đây trích từ **trang marketing/homepage** của mỗi app, **không phải UI in-app** (journey card, timeline thật trong app nằm sau đăng nhập/JS, scrape không lấy được). Các pattern in-app được mô tả theo **quy ước UX transit đã được kiểm chứng** và gắn nhãn `[quy ước]` — tôi **không** bịa hex cụ thể cho chúng.
- **Bản quyền:** không ngụ ý IMOVE có quyền dùng logo/màu/nhãn hiệu bên thứ ba. Đây chỉ là tài liệu tham chiếu thiết kế.
- Độ tin cậy `confidence` lấy trực tiếp từ output firecrawl (LLM-assisted extraction).

---

## 1. Token quan sát được theo từng app (marketing site)

| App | colorScheme | Primary | Accent | Text / Link | Button primary | Heading font | Body font | Personality | conf. |
|-----|-------------|---------|--------|-------------|----------------|--------------|-----------|-------------|-------|
| **Citymapper** | light | `#407394` steel-blue | `#37AB2E` green | `#37AB2E` | green, **pill 96px** | BloggerSans | Proxima Soft | modern, medium | 0.93 |
| **Transit** | light | `#FFEEE6` peach | `#27A559` green | `#0000EE` electric-blue | green, pill 32px | Puffin Transit Bold *(custom)* | Puffin Transit / Lora | **playful, high** | 0.93 |
| **SimplyGo (SG)** | light | `#B1CDE7` lt-blue | `#3F84C5` blue | `#000000` | blue, **sharp 4px** | Montserrat | Helvetica/Arial | professional, medium | 0.93 |
| **Google Maps** | light | `#1A73E8` Google-blue | `#1A73E8` | `#202124` | blue, pill 48px | Google Sans | Google Sans Text | modern, medium | 0.93 |

Chi tiết bổ sung:
- **Citymapper:** secondary `#B6241C` (đỏ), radius nền 5px, spacing unit 4px. Green `#37AB2E` là màu "Go" đặc trưng — dùng cho cả text/link/CTA.
- **Transit:** h1 **88px** (display cực lớn), secondary `#047CFF` (xanh điện), radius nền 3px. Tông vui nhộn, năng lượng cao nhất nhóm.
- **SimplyGo:** secondary `#316AA1` (navy). Đây là tông **chính phủ/corporate** — vuông vức (button radius 4px), an toàn, ít cá tính. Đại diện ngữ cảnh Singapore thực tế.
- **Google Maps:** spacing unit **8px**, button phụ trắng viền nhẹ. Tông trung tính, "utility-first".

**Đọc nhanh:** 3/4 app neo vào **xanh dương** (steel/Google/SimplyGo) như màu tin cậy; **xanh lá** xuất hiện ở 2/4 như màu "đi/đúng giờ". Button **bo tròn dạng pill** là chuẩn chung (trừ SimplyGo corporate). Heading thiên về **geometric/rounded sans** (Google Sans, Montserrat, BloggerSans), không dùng Inter.

---

## 2. Màu tuyến MRT Singapore — CHÍNH THỨC (quan sát được)

> Nguồn: Wikipedia *Module:Adjacent stations/SMRT* (dữ liệu vận hành chuẩn). Mỗi tuyến có **màu nền + màu chữ cặp đôi** đảm bảo tương phản — đây chính là bài học a11y cho hệ "line/mode color coding".

| Tuyến | Mã | Màu nền | Màu chữ | Ghi chú |
|-------|----|---------|---------|---------|
| North–South Line | NSL | `#d42e12` đỏ | trắng | |
| East–West Line | EWL | `#009645` xanh lá | trắng | |
| North East Line | NEL | `#9900aa` tím | trắng | |
| Circle Line | CCL | `#fa9e0d` cam/vàng | **đen** | nền sáng → chữ đen |
| Downtown Line | DTL | `#005ec4` xanh dương | trắng | |
| Thomson–East Coast | TEL | `#9D5B25` nâu | trắng | |
| Jurong Region Line | JRL | `#0099aa` xanh mòng két | trắng | (tương lai) |
| LRT / line nhạt | — | `#97C616` lime | **đen** | nền sáng → chữ đen |
| (biến thể cam đậm) | — | `#b85600` | trắng | |

**Bài học rút ra cho IMOVE:** badge/pill tuyến phải **tự chọn màu chữ theo độ sáng nền** (cam/lime → chữ đen; đỏ/tím/nâu → chữ trắng). Không hardcode chữ trắng cho mọi badge.

---

## 3. Tổng hợp chéo — điều các UI transit chia sẻ

1. **Xanh dương = trục tin cậy/điều hướng** (Google `#1A73E8`, SimplyGo `#3F84C5`, Citymapper steel `#407394`).
2. **Xanh lá = đi / live / đúng giờ / thành công** (Citymapper `#37AB2E`, Transit `#27A559`).
3. **Button pill** (bo tròn mạnh) cho hành động chính — cảm giác "bấm được", thân thiện di động.
4. **Mã màu theo tuyến/phương tiện** là xương sống nhận diện transit, kèm **màu chữ tương phản theo nền**.
5. **Sans hình học/bo tròn** cho heading (Google Sans, Montserrat, Proxima Soft) — KHÔNG dùng Inter làm điểm nhấn.
6. **Nền sáng, tương phản cao, lấy bản đồ làm trung tâm**; mật độ vừa phải, không "cockpit".
7. **Số liệu (giờ, phút, giá)** cần rõ ràng — `[quy ước]` các app dùng chữ số tabular/đậm cho thời gian chờ & thời lượng.

### Pattern in-app `[quy ước]` (không scrape được — mô tả theo chuẩn ngành)
- **Journey/route card:** header tổng (tổng thời gian + giờ đến) → các leg xếp dọc, mỗi leg có **chip màu tuyến/phương tiện** + thời lượng; icon mode (🚆/🚌/🚶) thống nhất một họ.
- **Trip timeline:** trục dọc nối các điểm, đoạn transit tô màu tuyến, đoạn đi bộ nét đứt; nhãn thời gian căn phải.
- **Live state:** chấm xanh lá nhấp nháy + "real-time" cho dữ liệu đến giờ; xám cho dữ liệu ước tính.

---

## 4. Hệ quả cho IMOVE (đối chiếu nền dev29 hiện tại)

| Bằng chứng | Hệ quả đề xuất cho IMOVE (chốt ở Phase 2) |
|------------|--------------------------------------------|
| 3/4 app neo xanh dương; main đã có `--color-primary-600 #2563eb` | ✅ **Giữ blue `#2563eb`** — đã đúng hướng, được 3 app lớn xác nhận. Không cần đổi brand. |
| Green = đi/live; main đã có `--color-success-600 #059669` | ✅ Giữ green cho live/on-time/success. |
| Mã màu tuyến + chữ tương phản | ➕ **Thêm bộ token `--mode-*` / `--line-*`** dùng đúng màu MRT SG chính thức (mục 2), kèm hàm chọn màu chữ. Đây là thứ IMOVE đang thiếu rõ nhất. |
| Button pill phổ biến | ⚠️ Cân nhắc: main hiện radius 10px (bo vừa). Quyết định pill-cho-action vs giữ 10px → đưa ra ở Phase 2 (shape lock). |
| Heading dùng geometric sans, không Inter | ⚠️ Inter (hiện tại) ổn cho body/số liệu nhưng generic cho heading. Cân nhắc 1 display font (Plus Jakarta Sans đã có sẵn trong `font-display`, hoặc Sora/Outfit) → Phase 2. |
| SimplyGo = tông SG corporate, an toàn | Ngữ cảnh: IMOVE phục vụ **du khách**, nên nghiêng Citymapper/Transit (thân thiện, rõ ràng) hơn là corporate SimplyGo, nhưng giữ độ tin cậy của blue. |

---

## Rerun Inputs
```
workflow: firecrawl-website-design-clone (consolidated, multi-source)
sources:
  - https://citymapper.com            (branding,images)
  - https://transitapp.com            (branding,images)
  - https://simplygo.com.sg           (branding,images)
  - https://www.google.com/maps/about/ (branding,images)
  - https://en.wikipedia.org/wiki/Module:Adjacent_stations/SMRT (markdown — official SG line colors)
capture_date: 2026-06-19
artifacts: .firecrawl/*.md (raw scrape evidence, preserved)
output: docs/design/refs.md
```
