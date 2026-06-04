#!/usr/bin/env python3
"""
Seed script: upserts singapore_places.json into the Supabase `places` table.

Prerequisites:
  1. Migration 007_places_postgis.sql must be applied in Supabase.
  2. backend/.env must contain SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

Run from the backend/ directory (so pydantic_settings finds .env):
    cd backend && python -m app.scripts.seed_db
"""

import json
import sys
import time
from pathlib import Path

# ── Path resolution ───────────────────────────────────────────────────────────
# __file__ = backend/app/scripts/seed_db.py
# parents[2]  = backend/
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_DATA_FILE   = _BACKEND_DIR / "app" / "data" / "singapore_places.json"

# ── Dependencies (require running from backend/ so .env is found) ─────────────
try:
    from supabase import create_client, Client
    from app.config import settings
except ImportError as exc:
    sys.exit(
        f"Import error: {exc}\n"
        "Make sure you are running from backend/ and deps are installed:\n"
        "  cd backend && pip install -r requirements.txt\n"
        "  python -m app.scripts.seed_db"
    )

_BATCH_SIZE = 50   # rows per upsert — safe for Supabase free-tier payload limits


def _to_row(place: dict) -> dict:
    """Transform a JSON record into a Supabase-ready DB row.

    Key transformations:
    - coords: built as EWKT so PostgREST casts it to GEOGRAPHY(Point, 4326).
      Format is SRID=4326;POINT(lng lat) — note X=longitude, Y=latitude.
    - dwell_minutes: JSON uses suggested_duration_minutes; DB column is dwell_minutes.
    - opening_hours / close_days: default to [] instead of NULL for simpler SQL checks.
    """
    lat = float(place["lat"])
    lng = float(place["lng"])
    dwell = int(
        place.get("dwell_minutes")
        or place.get("suggested_duration_minutes")
        or 60
    )
    return {
        "id":                          place["id"],
        "name":                        place["name"],
        "lat":                         lat,
        "lng":                         lng,
        "coords":                      f"SRID=4326;POINT({lng} {lat})",
        "category":                    place.get("category", ""),
        "is_outdoor":                  bool(place.get("is_outdoor", False)),
        "dwell_minutes":               dwell,
        "best_time_start":             place.get("best_time_start", "00:00"),
        "best_time_end":               place.get("best_time_end", "23:59"),
        "opening_hours":               place.get("opening_hours") or [],
        "close_days":                  place.get("close_days") or [],
        "description":                 place.get("description"),
        "formatted_address":           place.get("formatted_address"),
        "search_keywords":             place.get("search_keywords") or [],
        "suggested_duration_minutes":  place.get("suggested_duration_minutes"),
        "is_audited":                  place.get("is_audited"),
        "offset_over_1km":             place.get("offset_over_1km"),
        "image_url":                   place.get("image_url"),
    }


def _validate_env() -> tuple[str, str]:
    url = settings.supabase_url
    key = settings.supabase_service_role_key
    if not url or not key:
        sys.exit(
            "Missing Supabase credentials in backend/.env\n"
            "Required keys: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY"
        )
    return url, key


def seed() -> None:
    url, key = _validate_env()

    if not _DATA_FILE.exists():
        sys.exit(f"Data file not found: {_DATA_FILE}")

    print(f"Reading {_DATA_FILE} …")
    raw: list[dict] = json.loads(_DATA_FILE.read_text(encoding="utf-8"))
    rows = [_to_row(p) for p in raw]
    total = len(rows)
    print(f"  {total} places loaded.\n")

    client: Client = create_client(url, key)

    inserted = 0
    errors: list[str] = []

    for start in range(0, total, _BATCH_SIZE):
        batch = rows[start : start + _BATCH_SIZE]
        batch_end = min(start + _BATCH_SIZE, total)
        try:
            client.table("places").upsert(batch, on_conflict="id").execute()
            inserted += len(batch)
        except Exception as exc:
            ids = [r["id"] for r in batch]
            errors.append(f"Batch {start}–{batch_end}: {exc}")
            print(f"\n  [WARN] Batch {start}–{batch_end} failed: {exc}")
            print(f"         Failed IDs: {ids[:5]}{'…' if len(ids) > 5 else ''}")

        print(f"  Progress: {min(batch_end, total)}/{total} rows processed …", end="\r")
        time.sleep(0.1)  # avoid hitting Supabase free-tier rate limits

    print(f"\n\nSeed complete.")
    print(f"  Upserted : {inserted}/{total}")
    if errors:
        print(f"  Errors   : {len(errors)} batch(es) failed — check output above.")
        sys.exit(1)
    else:
        print(f"  Status   : All rows OK")


if __name__ == "__main__":
    seed()
