# Mission — IMOVEV2

## Mission Statement

Giúp khách du lịch tại Singapore di chuyển bằng phương tiện công cộng một cách tự tin — từ lúc lên kế hoạch đến khi hoàn thành chuyến đi — dù chưa biết gì về MRT, bus hay địa lý Singapore.

---

## Vấn đề cần giải quyết

Singapore có hệ thống transit phức tạp (MRT + LRT + bus + walking) và thường xuyên xảy ra gián đoạn dịch vụ. Các ứng dụng như Google Maps giải quyết tốt "đi từ A đến B ngay bây giờ" nhưng **không giải quyết được**:

- Lập kế hoạch nhiều ngày, nhiều địa điểm theo thứ tự tối ưu
- Thích ứng khi kế hoạch thay đổi trong chuyến đi (delay tàu, mưa đột ngột)
- Học từ hành vi của người dùng để cải thiện các chuyến sau

IMOVEV2 lấp đầy 3 khoảng trống đó thông qua kiến trúc đa tác nhân (multi-agent).

---

## Đối tượng người dùng

**Primary:** Solo traveler hoặc nhóm nhỏ (2–4 người) đến Singapore lần đầu hoặc ít kinh nghiệm với transit địa phương.

**Đặc điểm:**
- Đã có danh sách địa điểm muốn tham quan và số ngày cụ thể
- Không quen với tuyến MRT/bus, không biết thời gian di chuyển thực tế
- Cần hướng dẫn chi tiết từng bước (kiểu Citymapper), không chỉ tên trạm
- Muốn biết chi phí transit trước chuyến đi

**Guest mode:** Không cần đăng ký — Planning Agent và Adaptation Agent hoạt động hoàn toàn không cần tài khoản. Memory Agent (học preference) chỉ dành cho user đã đăng nhập.

---

## Giá trị cốt lõi (so với Google Maps)

| Tính năng | Google Maps | IMOVEV2 |
|-----------|------------|---------|
| Route A → B ngay lập tức | ✓ | ✓ |
| Kế hoạch nhiều ngày, nhiều điểm | ✗ | ✓ (Planning Agent) |
| Thứ tự địa điểm tối ưu | ✗ | ✓ (greedy nearest-neighbor) |
| Cảnh báo tự động khi delay/mưa | ✗ | ✓ (Adaptation Agent) |
| Đề xuất thay thế khi gián đoạn | ✗ | ✓ (swap outdoor → indoor) |
| Học từ preference qua nhiều chuyến | ✗ | ✓ (Memory Agent) |
| Đặt Grab khi cần taxi | ✗ | ✓ (Deep Link, Phase 6) |

---

## Nguyên tắc Anti-Hallucination (bắt buộc)

IMOVEV2 **không bao giờ bịa dữ liệu**. Mọi thông tin hiển thị với người dùng phải có nguồn xác thực:

| Tình huống | Hành vi |
|-----------|---------|
| Địa điểm không trong curated dataset | Báo lỗi: thiếu dữ liệu dwell time |
| OneMap không tìm được route | Raise `NoRouteError` → HTTP 422, không ước tính |
| Budget không đủ | Báo lỗi: vượt ngân sách, gợi ý điều chỉnh |
| LTA DataMall API down | Adaptation Agent báo tạm vô hiệu, không fake alert |
| Giá trị ước tính (is_estimated=True) | Badge "~" / "Ước tính" trên UI |

**Lý do:** 75% logic là rule-based (deterministic), 25% dùng Gemini chỉ cho natural-language parsing — tránh phụ thuộc LLM cho quyết định routing có chi phí/thời gian thực.

---

## Tiêu chí thành công (measurable)

| Tiêu chí | Ngưỡng |
|---------|--------|
| E2E trip creation (3 địa điểm) | < 30 giây |
| Concurrent users (không timeout) | ≥ 10 |
| PWA installable | Chrome Android + Safari iOS |
| Uptime backend (Render) | Giữ sống bằng `/health` keepalive |
| Adaptation alert đến tay user | < 3 phút sau khi LTA phát sự kiện |

---

## Phạm vi v1 (không làm)

- Không hỗ trợ multi-city (chỉ Singapore)
- Không offline routing (phụ thuộc OneMap API)
- Không real-time tracking GPS bắt buộc (geolocation là optional, dùng cho proximity alert)
- Taxi/rideshare hỗ trợ qua Grab Deep Link (Phase 6 — xem `roadmap.md`)
- Không tích hợp thanh toán

---

## Liên kết

- Kiến trúc kỹ thuật: [`techstack.md`](./techstack.md)
- Lộ trình phát triển: [`roadmap.md`](./roadmap.md)
- Business rules chi tiết: [`../plans/business_rules.md`](../plans/business_rules.md)
- UI/UX specification: [`../plans/System_UI_Document.md`](../plans/System_UI_Document.md)
