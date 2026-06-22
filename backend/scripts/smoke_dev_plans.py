"""Smoke test thủ công cho dev22 / dev23 / dev24 — gọi API backend THẬT.

Cách chạy:
  1. Bật backend (terminal khác):  cd backend && uvicorn app.main:app --reload
  2. (Tuỳ chọn) đã apply migration 019 trên Supabase để kiểm tra lưu/khôi phục menu.
  3. Chạy script:                   cd backend && python scripts/smoke_dev_plans.py
     - Đổi URL nếu cần:             API_BASE=http://localhost:8000 python scripts/smoke_dev_plans.py

Script sẽ:
  - Tạo + plan 1 trip (optimize_order=True → tuyến THẬT từ OneMap)
  - In từng chặng: mode gợi ý, giá, các phương án (alternatives) + vé + cờ ước tính
  - Kiểm tra 3 plan:  dev22 (luôn có WALK/CYCLE/GRAB) · dev24 (có transit) · dev23 (vé transit > 0)
  - Đổi mode 1 chặng (PATCH) rồi GET lại để xem alternatives còn nguyên
  - Lặp lại với optimize_order=False (đường ước tính) để xem dev22 + vé METRO ước tính

In ra [PASS]/[CHECK] để bạn đối chiếu bằng mắt — KHÔNG thay thế việc bấm thử trên UI.
"""
import os
import sys
import json
import httpx

API_BASE = os.environ.get("API_BASE", "http://localhost:8000").rstrip("/")
SESSION_ID = "smoke-session-dev2224"

# Điểm cách xa nhau để buộc ra transit thật (Zoo ở bắc, USS ở nam-tây).
PLACE_IDS = [
    "merlion-park",
    "gardens-by-the-bay-supertree-grove",
    "singapore-zoo",
    "universal-studios-singapore",
]
HOTEL = {"hotel_name": "Marina Bay Hotel", "hotel_lat": 1.2830, "hotel_lng": 103.8607}

ALWAYS = {"WALK", "CYCLE", "GRAB"}
TRANSIT = {"BUS", "METRO"}


def _line(c="─"):
    print(c * 78)


def _alt_str(mode, a):
    est = "~est" if a.get("is_estimated") else "real"
    return f"{mode}: {a.get('duration_minutes')}min  S${a.get('cost_sgd'):.2f}  {est}"


def plan_and_inspect(client, optimize_order):
    label = "optimize_order=True (tuyến THẬT)" if optimize_order else "optimize_order=False (ƯỚC TÍNH)"
    _line("═")
    print(f"KỊCH BẢN: {label}")
    _line("═")

    # 1) tạo trip
    r = client.post(f"{API_BASE}/trips", json={
        "session_id": SESSION_ID, "num_days": 2, "budget_sgd": 999.0, "name": "smoke",
    })
    r.raise_for_status()
    trip_id = r.json()["trip_id"]
    print(f"trip_id = {trip_id}")

    # 2) plan
    body = {"place_ids": PLACE_IDS, "optimize_order": optimize_order, **HOTEL}
    r = client.post(f"{API_BASE}/trips/{trip_id}/plan", json=body)
    if r.status_code != 200:
        print(f"[LỖI] plan trả về {r.status_code}: {r.text[:400]}")
        return None
    plan = r.json()

    # 3) in từng chặng + thu thập số liệu kiểm tra
    dev22_ok = True
    dev24_has_transit = False
    dev23_has_priced_transit = False
    first_switchable = None   # (leg_id, current_mode, target_mode)

    for day in plan["days"]:
        print(f"\n  ── Ngày {day['day']} ──")
        for leg in day["legs"]:
            alts = leg.get("alternatives", {}) or {}
            keys = set(alts.keys())
            print(f"  • {leg['from_place_id']} → {leg['to_place_id']}")
            print(f"      gợi ý: {leg['transport_mode']}  |  giá S${leg['cost_sgd']:.2f}  |  "
                  f"{'ước tính' if leg['is_estimated'] else 'thật'}  |  {leg.get('distance_km')} km")
            print(f"      phương án ({len(keys)}): " + "  ".join(_alt_str(m, alts[m]) for m in keys))

            # dev22: luôn có WALK/CYCLE/GRAB
            if not ALWAYS.issubset(keys):
                dev22_ok = False
                print(f"      [CHECK] thiếu always-mode: {ALWAYS - keys}")
            # dev24: có ít nhất 1 phương án transit (hoặc mode gợi ý là transit)
            if keys & TRANSIT or leg["transport_mode"] in TRANSIT:
                dev24_has_transit = True
            # dev23: vé transit > 0
            for m in keys & TRANSIT:
                if alts[m].get("cost_sgd", 0) > 0:
                    dev23_has_priced_transit = True
            # tìm 1 chặng có thể đổi mode (sang 1 always-mode khác mode hiện tại)
            if first_switchable is None:
                cur = leg["transport_mode"]
                cand = next((m for m in ("WALK", "CYCLE", "GRAB", "BUS", "METRO")
                             if m in keys and m != cur), None)
                if cand:
                    first_switchable = (leg["id"], cur, cand)

    print()
    _line()
    print(f"  [{'PASS' if dev22_ok else 'CHECK'}] dev22 — mọi chặng đều có WALK/CYCLE/GRAB")
    print(f"  [{'PASS' if dev24_has_transit else 'CHECK'}] dev24 — có phương án transit xuất hiện")
    if optimize_order:
        print(f"  [{'PASS' if dev23_has_priced_transit else 'CHECK'}] dev23 — có vé transit > 0 "
              f"(tuyến thật; nếu OneMap trả vé thì giữ vé thật, nếu không thì ước tính PTC)")
    else:
        # đường ước tính: chặng xa là METRO với vé PTC ước tính
        print(f"  [{'PASS' if dev23_has_priced_transit else 'CHECK'}] dev23 — METRO ước tính có vé PTC > 0")
    _line()

    # 4) đổi mode 1 chặng
    if first_switchable:
        leg_id, cur, target = first_switchable
        print(f"\n  ĐỔI MODE: chặng {leg_id[:8]}…  {cur} → {target}")
        r = client.patch(f"{API_BASE}/trips/{trip_id}/legs/{leg_id}",
                         json={"transport_mode": target})
        if r.status_code == 200:
            res = r.json()
            ul = res["updated_leg"]
            print(f"      → mode mới: {ul['transport_mode']}  S${ul['cost_sgd']:.2f}  "
                  f"{ul['duration_minutes']}min  | tổng trip S${res['trip_cost_sgd']:.2f}")
            print(f"      → còn {len(ul.get('alternatives', {}))} phương án (phải >0 để đổi tiếp được)")
            if res.get("warnings"):
                print(f"      → cảnh báo: {res['warnings']}")
        else:
            print(f"      [LỖI] PATCH {r.status_code}: {r.text[:300]}")

    # 5) GET lại — alternatives phải còn (lưu ý: GET đọc in-memory trước; muốn test
    #    đúng đường DB reload thì phải RESTART backend rồi GET lại trip_id này)
    r = client.get(f"{API_BASE}/trips/{trip_id}")
    if r.status_code == 200:
        plan2 = r.json()
        leg0 = plan2["days"][0]["legs"][0]
        n = len(leg0.get("alternatives", {}) or {})
        print(f"\n  GET lại trip: chặng đầu có {n} phương án "
              f"({'OK' if n >= 1 else 'CHECK'})")
        print(f"  → Để kiểm tra dev22 P2 (sống sót reload): RESTART uvicorn rồi mở GET {API_BASE}/trips/{trip_id}")
    return trip_id


def main():
    try:
        with httpx.Client(timeout=60.0) as client:
            # health check
            try:
                client.get(f"{API_BASE}/health", timeout=5.0)
            except Exception:
                print(f"[LỖI] Không gọi được {API_BASE}. Backend đã chạy chưa? "
                      f"(cd backend && uvicorn app.main:app --reload)")
                sys.exit(1)
            plan_and_inspect(client, optimize_order=True)
            plan_and_inspect(client, optimize_order=False)
    except httpx.HTTPError as e:
        print(f"[LỖI HTTP] {e}")
        sys.exit(1)
    print("\nXong. Đối chiếu các dòng [PASS]/[CHECK] ở trên.")


if __name__ == "__main__":
    main()
