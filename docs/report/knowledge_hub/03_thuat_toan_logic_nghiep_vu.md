# IMOVE V2 — Thuật toán & Logic nghiệp vụ

> **Bối cảnh chung:** IMOVE V2 là web app lập kế hoạch du lịch bằng giao thông công cộng ở Singapore. Backend FastAPI + các AI agent (Planning, Adaptation, Memory, Chat) → frontend React 18 → Supabase → Gemini 2.5 Flash. Ràng buộc: ~75% code quy tắc, ~25% LLM. Tài liệu này mô tả các thuật toán cốt lõi.

---

## 1. Quy trình lập lịch tổng thể (`plan_trip`)
File: `backend/app/agents/planning_agent.py`, hàm `plan_trip(...)`. Đây là trái tim hệ thống. Nó chia bài toán thành các bước con (đánh nhãn `[CODE]`/`[LLM]`):

| Bước | Việc làm | Loại |
|---|---|---|
| 1 | Xác thực `place_ids`; nếu không nhận ra → nhờ Gemini đoán tên (`_resolve_via_gemini`) | `[CODE]`+`[LLM]` |
| 2+4 | Chia điểm vào từng ngày bằng greedy theo quỹ thời gian (`_day_bucketed_greedy`) hoặc theo mô phỏng ngày (`_distribute_days`) | `[CODE]` |
| 3 | Lấy tuyến cho mọi cặp điểm liền kề (song song qua OneMap, hoặc ước lượng haversine) | `[CODE]` |
| 5 | Phát hiện ngày quá tải/quá rảnh → Gemini viết cảnh báo thân thiện | `[LLM]` |
| 6 | Dựng các *leg* (chặng) + tính giờ đến/đi từng điểm + phát hiện đoạn di chuyển dài | `[CODE]` |
| 6b | Gom các đoạn dài → Gemini viết thông báo gợi ý (gap notifications) | `[LLM]` |
| 7 | Kiểm tra ngân sách → thêm cảnh báo (không chặn) | `[CODE]` |

**Hai chế độ chạy (rất quan trọng):**
- **`optimize_order=True` (Optimize path):** gọi OneMap lấy **tuyến thật** cho mọi cặp; chấm điểm chọn phương tiện tốt nhất. Chậm hơn nhưng số liệu chính xác (`is_estimated=False`).
- **`optimize_order=False` (Non-optimize path):** chỉ dùng **ước lượng haversine** tức thì (không gọi OneMap), đánh dấu `is_estimated=True`. Dùng khi người dùng thêm/bớt/đổi thứ tự điểm liên tục để khỏi chờ API. Tuyến thật chỉ lấy khi bấm **Optimize Route**.

## 2. Thuật toán chia điểm vào ngày — Greedy theo quỹ thời gian
Hàm `_day_bucketed_greedy` (dùng khi optimize). **Bài toán:** xếp các điểm vào `num_days` ngày, mỗi ngày khả thi trong cửa sổ 09:00–17:00, tôn trọng giờ mở cửa, không nhồi hết vào ngày 1.

**Các bước:**
1. **Phân loại điểm** theo khung giờ nên thăm (`_classify_place`): `day` (ban ngày), `evening` (tối, best_time_start ≥ 17:00), `overlap` (vắt qua 17:00).
2. **Tính quỹ thời gian mỗi ngày:** `dwell_budget = tổng dwell ban ngày / num_days`.
3. **Với mỗi ngày**, bắt đầu ở khách sạn lúc 09:00 (= phút 540), lặp:
   - Lọc điểm **tới được + còn mở cửa + xong trước 17:00** (ước lượng thời gian đi bằng haversine, tốc độ MRT-bias `0.25 km/phút`, tối thiểu `10 phút/chặng`).
   - Chọn điểm **gần vị trí hiện tại nhất** (greedy theo khoảng cách).
   - Cộng thời gian đi + dwell vào đồng hồ; ngày (trừ ngày cuối) **ngừng nhận** khi đạt `dwell_budget`.
4. **Điểm buổi tối** gán *sau cùng* vào ngày có tổng dwell nhỏ nhất (`_assign_evening_to_days`) để cân bằng.
5. **Điểm tràn** (không vừa ngày nào) → đẩy vào ngày nhẹ nhất + thêm cảnh báo.

**Vì sao greedy mà không tối ưu toàn cục (TSP)?** Với 2–8 điểm/ngày của khách du lịch, greedy "gần nhất" cho kết quả đủ tốt, **chạy tức thì** và **dễ giải thích** — phù hợp ràng buộc rate-limit và trải nghiệm realtime. Haversine chỉ để *xếp lịch*; tuyến thật do OneMap trả ở bước sau.

> Hàm `_distribute_days` là biến thể dùng khi non-optimize / không có dữ liệu tuyến: mô phỏng một ngày 09:00–17:00, thêm điểm khi `arrival + dwell ≤ 17:00` và nằm trong giờ mở cửa.

## 3. Thuật toán chọn phương tiện — Chấm điểm đa tiêu chí có trọng số
File: `backend/app/services/scoring.py`, hàm `score_alternatives(...)`. **Bài toán:** một chặng có nhiều phương tiện khả dĩ — chọn cái "tốt nhất" theo sở thích người dùng + ngữ cảnh.

**Các bước:**
1. **Lọc ràng buộc cứng:** bỏ BUS nếu `avoid_bus`, bỏ METRO nếu `avoid_metro`.
2. **Rút mỗi phương tiện về 4 chiều đo:** `duration_minutes`, `cost_sgd`, `walk_minutes`, `num_transfers`.
3. **Chuẩn hoá tương đối trong nội bộ tập lựa chọn** (lower = better):
   `N(val) = 1 − (val − min) / (max − min)`; nếu mọi mode bằng nhau → `1.0` (trung lập).
4. **Điều chỉnh trọng số theo ngữ cảnh** (`_effective_weights`):
   - **Mưa to** (≥7.5mm/h) → mượn 60% trọng số *đi bộ* sang *thời gian/chi phí*; **mưa nhẹ** (≥2.5mm/h) → mượn 30%.
   - **Giờ cao điểm** (7:30–9:30 & 17:00–20:00) → tăng trọng số *ít chuyển tuyến*.
   - Ràng buộc mềm `minimize_walking` / `minimize_fee` → cộng +0.15 vào chiều liên quan.
   - **Re-normalize** tổng trọng số = 1.0.
5. **Tính điểm có trọng số:** `score = w_dur·N(dur) + w_cost·N(cost) + w_walk·N(walk) + w_xfer·N(xfer)`; phạt mềm −0.30 nếu `avoid_transfers` và >1 lần chuyển.
6. Sắp xếp giảm dần → `recommended_mode` + chuỗi *reasoning* để hiển thị.

**Trọng số mặc định** (`UserPreferenceProfile`): duration 0.40, cost 0.30, walking 0.20, transfers 0.10 (tổng = 1.0).

**Safety guard sau chấm điểm (trong `plan_trip`):** chặng ≥1.5 km mà bị chọn WALK → ưu tiên đổi sang METRO/BUS; ≥2 km mà không có phương tiện công cộng → đề xuất GRAB. **GRAB không tham gia chấm điểm**, chỉ được chọn qua guard khoảng cách này.

## 4. Mô hình giá GRAB tự xây
Hàm `_grab_fare` / `_estimate_grab`. Khi OneMap có chế độ "drive" → dùng polyline/khoảng cách/thời gian thật; khi không → ước lượng haversine. Công thức (theo bảng giá Grab Singapore 2026):
```
road_km  = distance_km * 1.3          (đường thực ~1.3x đường chim bay)
road_min = road_km / 30 * 60          (tốc độ thành phố ~30 km/h)
F_base   = 3.00 + road_km*0.70 + road_min*0.16
F_trip   = max(5.80, F_base)          (giá tối thiểu)
fare     = F_trip + 1.70 + phụ_phí_địa_điểm   (1.70 = platform 1.20 + fuel 0.50)
```
Phụ phí địa điểm: Changi +6.00, Sentosa/Gardens by the Bay/Marina Bay Cruise +3.00. Không mô hình hoá surge & ERP (không có dữ liệu realtime). Kết quả luôn `is_estimated=True`.

## 5. Đổi phương tiện một chặng
- **`switch_leg_mode` (chế độ kế hoạch):** ưu tiên dùng dữ liệu phương tiện đã nạp sẵn trong `leg.alternatives` (tức thì, không gọi API). Nếu cache trống (vd trip nạp lại từ DB) → gọi `_fetch_all_alternatives` lấy mới. Báo lỗi `NoRouteError` nếu mode yêu cầu không có tuyến.
- **`switch_leg_mode_live` (đang đi, theo GPS):** nếu GPS ≤200m so với điểm xuất phát → coi như "tại điểm" và dùng đường cache. Nếu đã rời điểm → gọi OneMap **từ vị trí GPS** tới điểm đến (định tuyến thật), trả `routed_from_current_position=True`.

## 6. Adaptation Agent — điều chỉnh chủ động (100% rule-based)
File: `backend/app/agents/adaptation_agent.py`. Hai kịch bản:

**(a) Mưa → đổi điểm ngoài trời sang trong nhà** (`_apply_weather_swap`)
- Tìm điểm trong nhà gần nhất trong **bán kính 5 km**, **ưu tiên gọi PostGIS RPC `find_nearest_indoor`** (1 truy vấn DB, kiểm giờ mở cửa trong DB); nếu Supabase lỗi → fallback quét haversine trên JSON cục bộ.
- Chống trùng: không cho 2 điểm ngoài trời đổi về cùng 1 điểm trong nhà; không gợi ý điểm người dùng đã có.
- Tính lại các chặng bị ảnh hưởng (`_recalculate_leg`).

**(b) Gián đoạn MRT → định tuyến lại sang bus** (`_reroute_mrt_legs`, chiến lược "post-filter + retry")
1. Gọi OneMap PT bình thường (OTP có thể đã tự tránh tuyến lỗi).
2. *Hậu kiểm* các sub-leg: nếu vẫn dùng tuyến lỗi (so prefix mã tuyến: EW, NS, CC, DT, TE, NE) → gọi lại ép `transit_modes="BUS"`.
3. Nếu bus cũng không có → giữ chặng cũ + đánh dấu `is_estimated=True` để UI cảnh báo.
- *Lưu ý bẫy:* tên trạm bus ở Singapore hay chứa mã MRT (vd "Bugis Stn Exit B EW12"); hàm `_leg_uses_disrupted_line` kiểm `mode=="METRO"` **trước** rồi mới xét prefix để không nhầm bus thành MRT.

**Cơ chế chạy & cảnh báo:**
- **Tự động:** `APScheduler` chạy `poll_lta_alerts` (mỗi 2'), `poll_weather_alerts` (mỗi 30') → chỉ xét trip `HAPPENING_TODAY` → `insert` vào bảng `lta_alerts` (có **dedup 10 phút**).
- **Theo yêu cầu:** `check_alerts_for_trip` cho trip `UPCOMING` (khi người dùng mở chuyến cho ngày mai); `check_lta_proximity` khi người dùng ở ≤1km điểm lên tàu MRT.
- **Ngưỡng mưa cảnh báo:** rain_probability > **70%** và trip có điểm ngoài trời.

**Quy trình đồng thuận (User Consent Flow):** `adapt_trip` chỉ trả *đề xuất* (lưu vào `_pending_swaps`), **không ghi DB**. Chỉ khi người dùng gọi `accept-swap` thì `commit_adaptation` mới ghi thật + đánh dấu alert đã resolve.

## 7. Memory Agent — học sở thích (chỉ user đăng nhập)
File: `backend/app/agents/memory_agent.py`.
- **Tường minh (explicit):** lưu rating/comment vào bảng `trip_feedback`.
- **Ngầm định (implicit):** mỗi lần đổi phương tiện, router ghi 1 feedback `implicit` (vd "BUS → METRO"). Khi quét thấy:
  - **≥2** lần "BUS → MRT" → bật `prefer_mrt = True`.
  - **≥2** lần "→ WALK" → tăng `max_walk_minutes += 5`.
  - Ngưỡng `_IMPLICIT_CHANGE_THRESHOLD = 2`.
- Yêu cầu `user_id` hợp lệ dạng UUID.

## 8. Chat Agent — chatbot function-calling 2 bước
File: `backend/app/agents/chat_agent.py`.
- Tự lái vòng lặp gọi công cụ của Gemini **trong tiến trình** (tắt automatic function calling), tối đa **4 lượt** (`_MAX_TURNS`).
- **READ tools** (chạy ngay, trả kết quả cho model): `get_current_trip`, `list_my_trips`, `search_places`, `get_curated_places`, `compare_routes`, `get_bus_arrivals`, `get_trip_alerts`, `get_weather`.
- **WRITE tools** (KHÔNG tự sửa — chỉ tạo *pending action* + bản xem trước): `add_place`, `remove_place`, `reorder_places`, `change_leg_mode`, `switch_leg_now`, `add_day`, `remove_day`, `optimize_trip`.
- Người dùng phải gọi `POST /chat/confirm` thì pending action mới được thực thi — **qua đúng các handler trong `routers/trips.py`** (không lặp lại logic).
- **Bảo mật:** bắt buộc đăng nhập; nếu nhắc trip theo tên → buộc gọi `list_my_trips(name_filter=...)` trước; chỉ gợi ý điểm có trong tập tuyển chọn (không bịa).
- **State** giữ trong bộ nhớ theo `session_id` (lịch sử hội thoại, pending action, trip context) — mất khi restart.

## 9. Các hằng số/ngưỡng đáng nhớ (tra cứu nhanh)
| Hằng số | Giá trị | Ý nghĩa |
|---|---|---|
| Ngày tham quan | 09:00–17:00 (mềm), 17:30 (cứng) | 540 / 1020 / 1050 phút |
| Tốc độ ước lượng | 0.25 km/phút (MRT-bias) | dùng cho haversine khi xếp lịch |
| Tối thiểu mỗi chặng | 10 phút | chờ + đi bộ tới trạm |
| Mưa nhẹ / nặng | ≥2.5 / ≥7.5 mm/h | đổi trọng số chấm điểm |
| Giờ cao điểm | 7:30–9:30 & 17:00–20:00 | tăng trọng số ít chuyển tuyến |
| Cảnh báo mưa | rain_probability > 70% | + có điểm ngoài trời |
| Dedup cảnh báo | 10 phút | tránh alert trùng |
| Bán kính tìm điểm trong nhà | 5 km | weather swap |
| Gemini rate limit | 1 call / 4 giây (≤15 RPM) | guard chung |
