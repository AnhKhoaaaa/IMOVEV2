# IMOVE V2 — Từ điển thuật ngữ (Glossary)

> **Bối cảnh chung:** IMOVE V2 là web app lập kế hoạch du lịch bằng giao thông công cộng ở Singapore. Backend FastAPI + các AI agent → frontend React 18 → Supabase → Gemini 2.5 Flash. File này giải nghĩa các thuật ngữ xuất hiện trong code và tài liệu.

---

## Khái niệm nghiệp vụ
| Thuật ngữ | Nghĩa trong dự án |
|---|---|
| **Trip (chuyến đi)** | Một kế hoạch du lịch nhiều ngày của người dùng; thực thể trung tâm. |
| **Leg (chặng)** | Một đoạn di chuyển giữa 2 điểm bằng 1 phương tiện. |
| **Day / DayPlan** | Lịch của một ngày: danh sách điểm + các chặng nối chúng. |
| **Place / POI** | Địa điểm tham quan (Point of Interest); ~50 điểm tuyển chọn trong `singapore_places.json`. |
| **Dwell (dwell_minutes)** | Thời gian dự kiến lưu lại ở một điểm (phút). |
| **Best time window** | Khung giờ nên thăm một điểm (`best_time_start`–`best_time_end`). |
| **Anchor (điểm neo)** | Khách sạn — nơi mỗi ngày bắt đầu và kết thúc. |
| **Gap notification** | Thông báo khi có đoạn di chuyển dài giữa 2 điểm (kèm gợi ý). |
| **Trip lifecycle / status** | Vòng đời chuyến: `DRAFT → UPCOMING → HAPPENING_TODAY → PAST`. |

## Tác tử & thuật toán
| Thuật ngữ | Nghĩa |
|---|---|
| **Agent (tác tử)** | Module logic nghiệp vụ độc lập: Planning / Adaptation / Memory / Chat. |
| **Planning Agent** | Lập lịch: chia điểm vào ngày, lấy tuyến, chọn phương tiện. |
| **Adaptation Agent** | Phát hiện sự cố (mưa/MRT) và đề xuất điều chỉnh (100% rule-based). |
| **Memory Agent** | Học sở thích người dùng từ feedback (chỉ user đăng nhập). |
| **Chat Agent** | Trợ lý hội thoại, điều phối các agent khác qua function-calling. |
| **Greedy (tham lam)** | Chiến lược xếp lịch: mỗi bước chọn điểm gần nhất khả thi. |
| **dwell_budget** | Quỹ thời gian lưu lại chia đều mỗi ngày (chống nhồi ngày 1). |
| **Scoring / weighted scoring** | Chấm điểm phương tiện theo 4 tiêu chí có trọng số. |
| **Context adjustment** | Tự đổi trọng số chấm điểm theo mưa/giờ cao điểm. |
| **User Consent Flow** | Quy trình đề xuất → người dùng xác nhận → mới ghi thay đổi. |
| **post-filter + retry** | Chiến lược reroute MRT: thử PT, hậu kiểm, ép bus nếu còn dính tuyến lỗi. |

## Phương tiện & cờ dữ liệu
| Thuật ngữ | Nghĩa |
|---|---|
| **TransportMode** | Phương tiện: `BUS | METRO | CYCLE | WALK | GRAB`. |
| **METRO / MRT** | Tàu điện. "MRT"/"LRT" là giá trị cũ trong DB, được map về "METRO". |
| **PT (Public Transport)** | Giao thông công cộng (MRT + bus). |
| **GRAB** | Dịch vụ gọi xe; giá được mô hình hoá riêng (không từ OneMap). |
| **`is_estimated`** | Cờ: `true` = số liệu ước lượng (haversine/Grab); `false` = tuyến thật từ OneMap. |
| **sub_legs** | Các đoạn con của một chặng PT (mode, route, trạm, mã trạm…). |
| **geometry / geometries** | Polyline mã hoá để vẽ tuyến trên bản đồ. |
| **first_bus_stop_code** | Mã trạm bus đầu tiên — để tra giờ bus realtime. |
| **alternatives** | Dữ liệu các phương tiện thay thế đã nạp sẵn cho 1 leg (in-memory, không lưu DB). |

## Hạ tầng & công cụ
| Thuật ngữ | Nghĩa |
|---|---|
| **FastAPI** | Framework backend Python. |
| **Pydantic** | Thư viện định nghĩa & kiểm tra cấu trúc dữ liệu (models). |
| **APScheduler** | Bộ lập lịch job nền (poll cảnh báo LTA/weather). |
| **Supabase** | Nền tảng gồm PostgreSQL + Auth + Realtime + Storage. |
| **PostGIS** | Tiện ích không gian địa lý của PostgreSQL (tìm điểm gần nhất). |
| **RLS (Row-Level Security)** | Cơ chế Supabase: mỗi user/session chỉ thấy dữ liệu của mình. |
| **Realtime / Postgres Changes** | Supabase đẩy thay đổi bảng qua WebSocket tới client. |
| **JWT** | Token đăng nhập; backend trích `user_id` từ đó. |
| **service_role key / anon key** | Khoá Supabase mạnh (backend) / khoá công khai (frontend). |
| **OneMap** | API bản đồ & định tuyến chính thức của Singapore. |
| **OTP (OpenTripPlanner)** | Bộ máy định tuyến giao thông công cộng mà OneMap dùng. |
| **LTA DataMall** | API dữ liệu giao thông của Land Transport Authority (tàu/bus). |
| **OpenWeather** | API thời tiết/dự báo. |
| **Gemini 2.5 Flash** | Mô hình LLM của Google dùng cho các tác vụ ngôn ngữ. |
| **Vertex AI** | Một cách xác thực Gemini qua service account (thay vì API key). |

## Khái niệm thời gian & đo lường
| Thuật ngữ | Nghĩa |
|---|---|
| **Haversine** | Công thức tính khoảng cách chim bay giữa 2 toạ độ. |
| **Minutes since midnight** | Quy ước biểu diễn thời gian: 09:00 = 540, 17:00 = 1020, 17:30 = 1050. |
| **Peak hours (giờ cao điểm)** | 7:30–9:30 và 17:00–20:00 (giờ Singapore). |
| **rain_probability** | Xác suất mưa (%); ngưỡng cảnh báo > 70%. |
| **dedup (10 phút)** | Bỏ qua cảnh báo trùng loại trong 10 phút gần nhất. |
| **SGT (Asia/Singapore)** | Múi giờ dùng cho mọi tính toán lịch/định tuyến. |

## Tư duy tính toán (Computational Thinking) — cho người viết báo cáo
| Thuật ngữ | Biểu hiện trong IMOVE |
|---|---|
| **Decomposition (phân rã)** | Chia thành 4 agent + kiến trúc 4 tầng; `plan_trip` chia 8 bước con. |
| **Pattern Recognition (nhận diện mẫu)** | Một primitive định tuyến (`_fetch_all_alternatives`) dùng cho 6 luồng; "sửa lịch = lập lại lịch". |
| **Abstraction (trừu tượng hoá)** | Mọi phương tiện → 4 con số; thời gian → trục phút; `ContextSnapshot`. |
| **Algorithm Design (thiết kế thuật toán)** | Greedy theo quỹ thời gian; chấm điểm đa tiêu chí; post-filter+retry. |
