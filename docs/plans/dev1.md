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
