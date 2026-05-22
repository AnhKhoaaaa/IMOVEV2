# Dev 1 — Phase 1: Database Schema + Connection Test

## Tình trạng hiện tại

File `supabase/migrations/001_initial_schema.sql` đã tồn tại với 6 bảng:
`trips`, `trip_places`, `route_legs`, `lta_alerts`, `trip_feedback`, `user_preferences`

---

## Vấn đề phát hiện qua Explore

Schema hiện tại có 3 bảng **thiếu RLS** dù chứa dữ liệu nhạy cảm của user:

| Bảng | Vấn đề |
|------|--------|
| `route_legs` | Không có RLS — client có thể đọc legs của người khác |
| `trip_places` | Không có RLS — tương tự |
| `trip_feedback` | Không có RLS — feedback cá nhân không được bảo vệ |

Ngoài ra, `route_legs` thiếu `created_at` (cần cho Realtime subscription sort).

---

## Việc sẽ làm

### Task 1 — Patch schema: thêm RLS + cột còn thiếu

**File:** `supabase/migrations/002_rls_patch.sql` *(file mới, không sửa 001)*

Nội dung:
1. Thêm `created_at timestamptz default now()` vào `route_legs`
2. Bật RLS cho `route_legs`, `trip_places`, `trip_feedback`
3. Thêm policy cho 3 bảng này (truy cập qua `trip_id` → check owner trên `trips`)

### Task 2 — Test kết nối Supabase

**File mới:** `backend/tests/test_database.py`

Test duy nhất: `test_supabase_connection` — gọi một query đơn giản lên Supabase (ví dụ: `select 1`) và assert không có exception. Dùng service_role key từ `settings` (qua `.env`).

---

## Files cần tạo

| File | Hành động |
|------|-----------|
| `supabase/migrations/002_rls_patch.sql` | Tạo mới |
| `backend/tests/test_database.py` | Tạo mới |
| `backend/tests/__init__.py` | Tạo mới (empty, cần cho pytest) |

---

## Verification

```bash
# Chạy test kết nối (yêu cầu .env đã có SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
pytest backend/tests/test_database.py -v
```

Test pass = Supabase connection hoạt động đúng.

> **Lưu ý:** SQL migration phải được apply thủ công lên Supabase dashboard
> (SQL Editor → paste nội dung → Run) hoặc qua `supabase db push` nếu đã cài CLI.

---

# Dev 1 — Phase 2A: Services Implementation

> **Status:** 2A.1 `onemap.py` — DONE (5/5 tests pass)

## Bước 2A.1 — `backend/app/services/onemap.py`

### Phân tích

- `httpx` đã có trong `requirements.txt` — không cần dep mới
- `settings.onemap_email` / `settings.onemap_password` là required fields trong `config.py`
- OneMap yêu cầu Bearer token (POST email+password, token hết hạn sau 3 ngày)
- `get_route()` trả `dict` raw; Planning Agent sẽ map sang `RouteLeg` (không làm ở đây)

### Token management

```python
_TOKEN_CACHE = {"token": None, "expires_at": 0.0}

async def _get_token() -> str:
    # If cached and valid (>60s margin), return it
    # Else POST to auth endpoint, cache token + expires_at
```

- Cache in-memory, thread-safe đủ cho single-process FastAPI
- Margin 60s để tránh race condition gần hết hạn

### `geocode(place_name: str) -> dict`

**Endpoint:** `GET https://www.onemap.gov.sg/api/common/elastic/search`  
**Params:** `searchVal`, `returnGeom=Y`, `getAddrDetails=Y`, `pageNum=1`

**Return:**
```python
{"lat": float, "lng": float, "address": str}
```

**Error:** raise `ValueError(f"No results for '{place_name}'")` nếu `found = "0"` hoặc results rỗng

### `get_route(from_lat, from_lng, to_lat, to_lng, mode) -> dict`

**Endpoint:** `GET https://www.onemap.gov.sg/api/public/routingsvc/route`  
**mode values:** `"pt"` (public transit), `"walk"`, `"drive"`, `"cycle"`  
**Params PT:** `routeType=pt`, `token=...`, `date=YYYY-MM-DD`, `time=HH:MM:SS`, `mode=TRANSIT`, `numItineraries=1`

**Return (normalized):**
```python
{
    "duration_minutes": int,
    "fare_sgd": float,       # 0.0 nếu không có trong response
    "legs": [
        {"mode": str, "duration_minutes": int, "instruction": str}
    ]
}
```

**Error:** raise `NoRouteError` nếu response thiếu `plan.itineraries` hoặc itineraries rỗng

---

## Verification

```bash
pytest backend/tests/test_services/test_onemap.py -v
```

Test cases (mock HTTP, không cần real API key):
1. `test_geocode_returns_lat_lng` — mock search response → assert lat/lng/address
2. `test_geocode_no_results_raises` — mock empty results → assert `ValueError`
3. `test_get_route_pt_success` — mock route response → assert `duration_minutes` + `legs`
4. `test_get_route_no_route_raises` — mock empty itineraries → assert `NoRouteError`
5. `test_get_route_token_cached` — 2 calls → assert HTTP auth endpoint called only once

> **Status:** 2A.1 `onemap.py` — DONE (5/5 tests pass)

---

## Bước 2A.2 — `backend/app/services/lta.py`

### Phân tích

- **Auth:** API key trong request header `AccountKey: {settings.lta_api_key}` — không có token flow
- **Consumer:** `adaptation_agent.poll_lta_alerts()` gọi `get_train_alerts()` mỗi 2 phút
- **Khác OneMap:** Phải bắt `httpx.HTTPStatusError` + `httpx.RequestError` → re-raise thành `LTAUnavailableError` (không để lộ HTTP error ra agent layer)
- **Dep:** `httpx` + `settings.lta_api_key` đã có — không cần thêm

### APIs cần gọi

| Hàm | Endpoint | Ghi chú |
|-----|----------|---------|
| `get_bus_arrival` | `GET https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode={code}` | Trả danh sách service + thời gian đến |
| `get_train_alerts` | `GET https://datamall2.mytransport.sg/ltaodataservice/TrainServiceAlerts` | Status 1 = bình thường, 2 = gián đoạn |

### `get_bus_arrival(bus_stop_code: str) -> list[dict]`

**Return:**
```python
[
    {
        "service_no": str,
        "next_arrival_minutes": int,   # tính từ EstimatedArrival ISO timestamp
        "next_arrival_2_minutes": int,
        "load": str,                   # "SEA" / "SDA" / "LSD"
    }
]
```

- `EstimatedArrival` là ISO 8601 string (`2024-01-01T12:05:00+08:00`) → tính delta giây → chia 60 → round
- Nếu `NextBus.EstimatedArrival` rỗng hoặc không có → `next_arrival_minutes = -1`
- **Error:** `except (httpx.HTTPStatusError, httpx.RequestError)` → raise `LTAUnavailableError`

### `get_train_alerts() -> list[dict]`

**Return:**
```python
[
    {
        "status": int,         # 1 = normal, 2 = disruption
        "affected_line": str,  # "North South Line" etc
        "message": str,
    }
]
```

- Nếu `Status == 1` (bình thường) → trả `[]`
- Nếu `Status == 2` → một entry per `AffectedSegments` item
- **Error:** `except (httpx.HTTPStatusError, httpx.RequestError)` → raise `LTAUnavailableError`

---

### Verification

```bash
pytest backend/tests/test_services/test_lta.py -v
```

Test cases (mock HTTP, không cần real API key):
1. `test_get_bus_arrival_success` — mock response → assert parsed service list + `next_arrival_minutes`
2. `test_get_bus_arrival_api_down_raises` — mock HTTP 500 → assert `LTAUnavailableError`
3. `test_get_train_alerts_normal_returns_empty` — mock Status=1 → assert `[]`
4. `test_get_train_alerts_disruption_returns_list` — mock Status=2 + segments → assert list có đúng `affected_line`
5. `test_get_train_alerts_network_error_raises` — mock `RequestError` → assert `LTAUnavailableError`

> **Status:** 2A.2 `lta.py` — DONE (5/5 tests pass)

---

## Bước 2A.3 — `backend/app/services/gemini.py`

### Phân tích

- Rate-limit guard (4s / call) đã có sẵn trong stub — **không đụng**
- SDK: `google-generativeai` (đã trong `requirements.txt`)
- Model: `gemini-2.5-flash` (theo TechStack)
- Pattern: `_model` khởi tạo ở module level, dùng `generate_content_async` để không block event loop
- Không cần typed exception — SDK error propagate tự nhiên; Planning Agent xử lý ở layer trên

### Khởi tạo SDK (module level)

```python
import google.generativeai as genai
genai.configure(api_key=settings.gemini_api_key)
_model = genai.GenerativeModel("gemini-2.5-flash")
```

Chỉ set global config + model object — không gọi network khi import.

### `parse_places_input(raw_text: str) -> list[str]`

**Prompt:**
```
Extract all Singapore tourist place names from the text below.
Return ONLY a JSON array of strings. No explanation, no code block.
If no places found, return [].

Text: {raw_text}
```

**Parse response:**
- Strip markdown code fences nếu Gemini wrap trong ```json...```
- `json.loads(text)` → `list[str]`

### Verification (test cases)

```bash
pytest backend/tests/test_services/test_gemini.py -v
```

1. `test_parse_places_returns_list` — patch `_model.generate_content_async` → mock `'["Marina Bay Sands"]'` → assert list
2. `test_rate_limit_guard_triggers_sleep` — patch `asyncio.sleep` + 2 rapid calls → assert `sleep` called once với value ≤ 4

---

## Bước 2A.4 — `backend/app/services/openweather.py`

### Phân tích

- **Không trong TechStack chính** — optional soft-error path cho Adaptation Agent
- `openweather_api_key` là `Optional[str] = None` trong config
- Nếu key không có → raise `WeatherUnavailableError` ngay lập tức (không gọi HTTP)
- Dùng **OpenWeather One Call API 3.0** — free up to 1000 calls/ngày với "One Call by Call" plan
- Error wrapping: `HTTPStatusError` + `RequestError` → `WeatherUnavailableError`

### `get_forecast(date: str) -> dict` — `date` là `"YYYY-MM-DD"`

**Endpoint:** `GET https://api.openweathermap.org/data/3.0/onecall`
**Params:** `lat=1.3521`, `lon=103.8198`, `appid={key}`, `units=metric`, `exclude=current,minutely,hourly,alerts`

**Logic:**
1. `openweather_api_key` is None → raise `WeatherUnavailableError("not configured")`
2. Fetch daily forecast (8 ngày tới)
3. Tìm entry có `datetime.fromtimestamp(dt, utc).date() == date.fromisoformat(date_str)`
4. Map → `{date, condition, rain_probability (% int), temp_max, temp_min}`
5. Không tìm thấy ngày → raise `WeatherUnavailableError("beyond 8-day window")`

**Return:**
```python
{"date": str, "condition": str, "rain_probability": int, "temp_max": float, "temp_min": float}
```

### Verification (test cases)

```bash
pytest backend/tests/test_services/test_openweather.py -v
```

1. `test_get_forecast_returns_dict` — mock HTTP daily response → assert tất cả fields
2. `test_get_forecast_rain_probability_as_percent` — `pop=0.82` → `rain_probability=82`
3. `test_get_forecast_date_not_found_raises` — mock response không có ngày tương ứng → assert `WeatherUnavailableError`
4. `test_get_forecast_no_key_raises` — patch `settings.openweather_api_key = None` → assert `WeatherUnavailableError`
5. `test_get_forecast_api_down_raises` — mock HTTP 500 → assert `WeatherUnavailableError`

> **Status:** 2A.3 `gemini.py` + 2A.4 `openweather.py` — DONE (8/8 tests pass)

---

## Bước 2A.5 — `backend/app/routers/places.py`

### Phân tích

- 2 endpoint: `GET /places/curated` và `GET /places/search?q=...`
- Data: `backend/app/data/places.json` — static file, load một lần vào memory khi module import
- `Place` model đã có (`models/place.py`) — dùng để validate và serialize
- **Search logic:** case-insensitive substring match trên `name` trong curated dataset
  - Không gọi OneMap cho search MVP (5 POI, name search đủ dùng)
  - Gọi OneMap sẽ là enhancement sau khi curated dataset lớn hơn
- **`GET /curated`**: trả toàn bộ list, load từ file lúc module init

### Data loading (module level)

```python
import json, pathlib
from app.models.place import Place

_PLACES_PATH = pathlib.Path(__file__).parent.parent / "data" / "places.json"
_CURATED: list[Place] = [Place(**p) for p in json.loads(_PLACES_PATH.read_text())]
```

Load một lần khi module import — thread-safe, không I/O trên mỗi request.

### `GET /places/curated` → `list[Place]`

Trả `_CURATED` trực tiếp.

### `GET /places/search?q=...` → `list[Place]`

Filter `_CURATED` theo `q.lower() in place.name.lower()`. Trả list (có thể rỗng).

### Verification

```bash
pytest backend/tests/test_routers/test_places.py -v
```

Test cases (dùng FastAPI `TestClient` — sync, không cần asyncio):
1. `test_curated_returns_all_places` — GET /places/curated → status 200, len == 5
2. `test_curated_place_has_required_fields` — assert mỗi place có `id`, `lat`, `lng`, `dwell_minutes`
3. `test_search_finds_by_name` — q=marina → có "Marina Bay Sands"
4. `test_search_case_insensitive` — q=GARDENS → có "Gardens by the Bay"
5. `test_search_no_match_returns_empty_list` — q=xyzzy → `[]`

---

## System fixes — E2E stability (2026-05-20)

Kế hoạch triển khai: đồng bộ Supabase schema với backend persist, sửa contract frontend `trip_id`, adapt flow + error messages.

### Đã làm

| Hạng mục | File |
|----------|------|
| Migration 004 | `supabase/migrations/004_schema_code_alignment.sql` |
| Persist/fetch | `backend/app/routers/trips.py` |
| Poll active trips | `backend/app/agents/adaptation_agent.py` |
| API errors | `frontend/src/services/api.js` |
| Adapt + refresh | `AlertBanner.jsx`, `Trip.jsx`, `DayPlan.jsx`, `RouteCard.jsx` |
| Tests | `Planner.test.jsx`, `AlertBanner.test.jsx` |

### Thao tác thủ công (team)

1. Supabase SQL Editor: chạy `004_schema_code_alignment.sql` (sau 001–003).
2. Dashboard → Replication → bật Realtime cho `lta_alerts`.
3. Restart backend sau khi apply migration.

### E2E checklist

| # | Kiểm tra | Kỳ vọng |
|---|----------|---------|
| 1 | Tạo kế hoạch 3 POI | `/trip/{uuid}` có legs |
| 2 | Refresh trang Trip | Vẫn load từ DB |
| 3 | Backend log sau plan | Không `Supabase persist failed` |
| 4 | PATCH leg | 200 |
| 5 | INSERT `lta_alerts` + Adapt | 200, UI refresh |
| 6 | Budget quá thấp | Message lỗi rõ |

### Automated gate

```bash
cd backend && pytest tests/ -v --ignore=tests/test_database.py
cd frontend && npm test
```

Kết quả: 88 backend + 124 frontend tests pass.
