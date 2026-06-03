#!/usr/bin/env python3
"""
Enrich singapore_places.json using the Google Places API (New).

Three resumable phases:
  Phase 1 — Text Search Pro        : discover google_place_id, update lat/lng
  Phase 2 — Place Details Enterprise: update opening_hours, close_days, rating, formatted_address
  Phase 3 — Place Details Photos    : download photo → Supabase Storage → image_url (always replaces)

After Phase 1: POIs with business_status=CLOSED_PERMANENTLY are auto-removed from the JSON.

Run from backend/:
    cd backend && python -m app.scripts.enrich_places_google --phase all
    cd backend && python -m app.scripts.enrich_places_google --phase 1 --limit 10 --dry-run

Output files written to backend/:
    closed_permanently.txt   — audit log of auto-removed venues
    unmatched_places.txt     — POIs with confidence=low|no_match (need manual follow-up)
"""

import argparse
import json
import logging
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path

# ── Path resolution ────────────────────────────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parents[2]   # backend/
_DATA_FILE   = _BACKEND_DIR / "app" / "data" / "singapore_places.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

try:
    from app.config import settings
except ImportError as exc:
    sys.exit(
        f"Import error: {exc}\n"
        "Run from backend/ with deps installed:\n"
        "  cd backend && python -m app.scripts.enrich_places_google"
    )

# ── Constants ──────────────────────────────────────────────────────────────────

_BASE_URL = "https://places.googleapis.com/v1"

_DAY_NAMES = {
    0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday",
    4: "Thursday", 5: "Friday", 6: "Saturday",
}

_REQUEST_DELAY = 0.3   # seconds between API calls (≈ 3 req/s)

# Confidence thresholds
_HIGH_NAME_SIM  = 0.80   # SequenceMatcher ratio
_MED_NAME_SIM   = 0.60
_HIGH_DIST_M    = 200    # metres
_MED_DIST_M     = 500


# ══════════════════════════════════════════════════════════════════════════════
# Section 1 — HTTP helpers
# ══════════════════════════════════════════════════════════════════════════════

def _get(url: str, api_key: str, field_mask: str, timeout: int = 10) -> dict:
    """GET request with Google API key + field mask headers. Returns parsed JSON."""
    req = urllib.request.Request(url)
    req.add_header("X-Goog-Api-Key", api_key)
    req.add_header("X-Goog-FieldMask", field_mask)
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _post(url: str, api_key: str, field_mask: str, body: dict, timeout: int = 10) -> dict:
    """POST request with JSON body + Google API key + field mask headers."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Goog-Api-Key", api_key)
    req.add_header("X-Goog-FieldMask", field_mask)
    req.add_header("Accept", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _download_bytes(url: str, api_key: str, timeout: int = 20) -> bytes | None:
    """Download raw bytes (for photo media). Follows redirects. Returns None on failure."""
    req = urllib.request.Request(url)
    req.add_header("X-Goog-Api-Key", api_key)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except (urllib.error.URLError, OSError) as exc:
        log.warning("Photo download failed: %s", exc)
        return None


def _retry(fn, retries: int = 3, base_wait: float = 5.0):
    """Call fn(); retry up to `retries` times on HTTP 429 or transient errors."""
    for attempt in range(retries):
        try:
            return fn()
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                wait = float(exc.headers.get("Retry-After", base_wait * (2 ** attempt)))
                log.warning("HTTP 429 — sleeping %.0fs (attempt %d/%d)", wait, attempt + 1, retries)
                time.sleep(wait)
            elif exc.code in (500, 502, 503):
                log.warning("HTTP %d — retrying in %.0fs", exc.code, base_wait)
                time.sleep(base_wait)
            else:
                raise
    raise RuntimeError(f"Max retries ({retries}) exhausted")


# ══════════════════════════════════════════════════════════════════════════════
# Section 2 — Geo helpers
# ══════════════════════════════════════════════════════════════════════════════

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in metres."""
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ══════════════════════════════════════════════════════════════════════════════
# Section 3 — Phase 1: Text Search → place_id
# ══════════════════════════════════════════════════════════════════════════════

def search_place(
    name: str, lat: float, lng: float, api_key: str
) -> dict:
    """
    Text Search Pro for one POI.

    Returns:
        {
          "place_id":              str | None,
          "confidence":            "high" | "medium" | "low" | "no_match",
          "lat":                   float | None,   # Google's coords
          "lng":                   float | None,
          "is_closed_permanently": bool,
        }
    """
    url  = f"{_BASE_URL}/places:searchText"
    mask = "places.id,places.displayName,places.location,places.businessStatus"
    body = {
        "textQuery": f"{name} Singapore",
        "locationBias": {
            "circle": {
                "center":  {"latitude": lat, "longitude": lng},
                "radius":  500.0,
            }
        },
    }

    try:
        data = _retry(lambda: _post(url, api_key, mask, body))
    except (urllib.error.URLError, OSError, RuntimeError) as exc:
        log.warning("search_place(%r) network error: %s", name, exc)
        return {"place_id": None, "confidence": "no_match", "lat": None, "lng": None, "is_closed_permanently": False}

    places = data.get("places", [])
    if not places:
        return {"place_id": None, "confidence": "no_match", "lat": None, "lng": None, "is_closed_permanently": False}

    hit    = places[0]
    gplace_id  = hit.get("id") or hit.get("name", "").split("/")[-1] or None
    glat       = hit.get("location", {}).get("latitude")
    glng       = hit.get("location", {}).get("longitude")
    g_name     = hit.get("displayName", {}).get("text", "")
    biz_status = hit.get("businessStatus", "")

    # ── Confidence scoring ─────────────────────────────────────────────────
    name_sim = SequenceMatcher(None, name.lower(), g_name.lower()).ratio()
    dist_m   = _haversine_m(lat, lng, glat, glng) if (glat and glng) else 9999.0

    if name_sim >= _HIGH_NAME_SIM and dist_m < _HIGH_DIST_M:
        confidence = "high"
    elif name_sim >= _MED_NAME_SIM or dist_m < _MED_DIST_M:
        confidence = "medium"
    else:
        confidence = "low"

    return {
        "place_id":              gplace_id,
        "confidence":            confidence,
        "lat":                   glat,
        "lng":                   glng,
        "is_closed_permanently": biz_status == "CLOSED_PERMANENTLY",
    }


# ══════════════════════════════════════════════════════════════════════════════
# Section 4 — Phase 2: opening_hours converter
# ══════════════════════════════════════════════════════════════════════════════

def convert_opening_hours(periods: list[dict] | None) -> tuple[list[str], list[str]]:
    """
    Convert Google regularOpeningHours.periods → (opening_hours, close_days).

    opening_hours : list of "HH:MM-HH:MM" strings (unique slots across all days)
    close_days    : list of day names absent from any period's open.day

    Edge cases:
    - 24/7 place (single period, open Sunday 00:00, no close) → ["00:00-23:59"], []
    - periods=None / [] → (["00:00-23:59"], []) — fail-open matches app default
    """
    if not periods:
        return ["00:00-23:59"], []

    # Detect 24/7: one period, opens Sunday 00:00, no close key
    if len(periods) == 1:
        p = periods[0]
        op = p.get("open", {})
        if op.get("day") == 0 and op.get("hour") == 0 and op.get("minute") == 0 and "close" not in p:
            return ["00:00-23:59"], []

    # Collect unique time slots and active day numbers
    slots: list[str] = []
    seen_slots: set[str] = set()
    active_days: set[int] = set()

    for period in periods:
        op = period.get("open", {})
        cl = period.get("close", {})
        open_day = op.get("day")
        if open_day is not None:
            active_days.add(open_day)

        if op and cl:
            slot = (
                f"{op.get('hour', 0):02d}:{op.get('minute', 0):02d}"
                f"-"
                f"{cl.get('hour', 0):02d}:{cl.get('minute', 0):02d}"
            )
            if slot not in seen_slots:
                seen_slots.add(slot)
                slots.append(slot)

    if not slots:
        return ["00:00-23:59"], []

    # Close days = day numbers 0–6 not present in any open.day
    all_days  = set(range(7))
    close_day_nums = all_days - active_days
    close_days = [_DAY_NAMES[d] for d in sorted(close_day_nums)]

    return slots, close_days


# ══════════════════════════════════════════════════════════════════════════════
# Section 5 — Phase 2: Place Details fetch
# ══════════════════════════════════════════════════════════════════════════════

def fetch_place_details(place_id: str, api_key: str) -> dict | None:
    """
    Place Details Enterprise for one place_id.

    Field mask: regularOpeningHours, rating, formattedAddress
    (websiteUri intentionally excluded — not used by the app)

    Returns dict with keys: opening_hours, close_days, rating, formatted_address
    Returns None on HTTP 404 (stale place_id) or network error.
    """
    url  = f"{_BASE_URL}/places/{urllib.parse.quote(place_id, safe='')}"
    mask = "regularOpeningHours,rating,formattedAddress"

    try:
        data = _retry(lambda: _get(url, api_key, mask))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            log.warning("fetch_place_details: 404 for place_id=%r (stale)", place_id)
        else:
            log.warning("fetch_place_details HTTP %d for %r", exc.code, place_id)
        return None
    except (urllib.error.URLError, OSError, RuntimeError) as exc:
        log.warning("fetch_place_details network error for %r: %s", place_id, exc)
        return None

    periods = data.get("regularOpeningHours", {}).get("periods")
    opening_hours, close_days = convert_opening_hours(periods)

    rating = data.get("rating")
    if rating is not None:
        rating = round(float(rating), 1)

    return {
        "opening_hours":    opening_hours,
        "close_days":       close_days,
        "rating":           rating,
        "formatted_address": data.get("formattedAddress"),
    }


# ══════════════════════════════════════════════════════════════════════════════
# Section 6 — Phase 3: Photo pipeline
# ══════════════════════════════════════════════════════════════════════════════

def fetch_photo_name(place_id: str, api_key: str) -> str | None:
    """
    Fetch the resource name of the first photo for a place.
    Returns "places/{id}/photos/{ref}" or None.
    """
    url  = f"{_BASE_URL}/places/{urllib.parse.quote(place_id, safe='')}"
    mask = "photos"

    try:
        data = _retry(lambda: _get(url, api_key, mask))
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, RuntimeError) as exc:
        log.warning("fetch_photo_name failed for %r: %s", place_id, exc)
        return None

    photos = data.get("photos", [])
    if not photos:
        return None
    return photos[0].get("name")


def download_photo(photo_name: str, api_key: str, max_width: int = 800) -> bytes | None:
    """
    Download a photo by its resource name. Returns JPEG bytes or None.
    """
    encoded = urllib.parse.quote(photo_name, safe="")
    url = f"{_BASE_URL}/{encoded}/media?maxWidthPx={max_width}&skipHttpRedirect=false"
    return _download_bytes(url, api_key)


def upload_to_supabase(place_id: str, jpeg_bytes: bytes) -> str | None:
    """
    Upload JPEG bytes to Supabase Storage bucket 'poi-images'.
    Object key: {place_id}.jpg  (overwrites on re-run — idempotent).
    Returns the permanent public URL or None on failure.
    """
    try:
        from supabase import create_client
    except ImportError:
        log.error("supabase-py not installed — cannot upload photos")
        return None

    url = settings.supabase_url
    key = settings.supabase_service_role_key
    if not url or not key:
        log.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in .env")
        return None

    try:
        client = create_client(url, key)
        bucket = "poi-images"

        # Ensure bucket exists (public read)
        existing = [b.name for b in client.storage.list_buckets()]
        if bucket not in existing:
            client.storage.create_bucket(bucket, options={"public": True})
            log.info("Created Supabase Storage bucket: %s", bucket)

        object_path = f"{place_id}.jpg"
        client.storage.from_(bucket).upload(
            path=object_path,
            file=jpeg_bytes,
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )
        return f"{url}/storage/v1/object/public/{bucket}/{object_path}"

    except Exception as exc:
        log.warning("upload_to_supabase failed for %r: %s", place_id, exc)
        return None


# ══════════════════════════════════════════════════════════════════════════════
# Section 7 — Batch runner
# ══════════════════════════════════════════════════════════════════════════════

def _load_json() -> list[dict]:
    return json.loads(_DATA_FILE.read_text(encoding="utf-8"))


def _save_json(data: list[dict]) -> None:
    _DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _progress(current: int, total: int, phase: int, label: str) -> None:
    bar_w  = 28
    filled = int(bar_w * current / max(total, 1))
    bar    = "█" * filled + "░" * (bar_w - filled)
    print(
        f"\r  [{bar}] {current:3d}/{total}  Phase {phase} — {label[:48]:<48}",
        end="", flush=True,
    )


def _run_phase1(places: list[dict], api_key: str, limit: int, dry_run: bool) -> list[dict]:
    """Phase 1: Text Search → place_id, lat, lng. Auto-removes CLOSED_PERMANENTLY."""
    pending    = [p for p in places if not p.get("google_place_id")][:limit]
    closed_ids: list[tuple[str, str]] = []   # (id, name)
    unmatched : list[tuple[str, str]] = []   # (id, name)

    log.info("Phase 1: %d POIs to search (already done: %d)", len(pending), len(places) - len(pending))

    for i, place in enumerate(pending, 1):
        _progress(i, len(pending), 1, place["name"])
        result = search_place(place["name"], place["lat"], place["lng"], api_key)
        time.sleep(_REQUEST_DELAY)

        if dry_run:
            log.info(
                "  [DRY] %s → place_id=%s confidence=%s closed=%s",
                place["id"], result["place_id"], result["confidence"], result["is_closed_permanently"],
            )
            continue

        place["google_place_id"]         = result["place_id"]
        place["google_match_confidence"] = result["confidence"]

        if result["is_closed_permanently"]:
            closed_ids.append((place["id"], place["name"]))

        elif result["confidence"] in ("high", "medium") and result["lat"] and result["lng"]:
            place["lat"] = result["lat"]
            place["lng"] = result["lng"]

        if result["confidence"] in ("low", "no_match"):
            unmatched.append((place["id"], place["name"]))

        _save_json(places)

    print()  # newline after progress bar

    if dry_run:
        return places

    # ── Post-phase: remove CLOSED_PERMANENTLY ─────────────────────────────
    if closed_ids:
        closed_id_set = {pid for pid, _ in closed_ids}
        places = [p for p in places if p["id"] not in closed_id_set]
        _save_json(places)

        out = _BACKEND_DIR / "closed_permanently.txt"
        lines = ["id\tname"] + [f"{pid}\t{name}" for pid, name in closed_ids]
        out.write_text("\n".join(lines), encoding="utf-8")
        log.warning("Removed %d CLOSED_PERMANENTLY POIs → %s", len(closed_ids), out)

    # ── Write unmatched report ─────────────────────────────────────────────
    if unmatched:
        out = _BACKEND_DIR / "unmatched_places.txt"
        lines = ["id\tname\tconfidence"] + [
            f"{pid}\t{name}\t{next((p['google_match_confidence'] for p in places if p['id'] == pid), 'no_match')}"
            for pid, name in unmatched
        ]
        out.write_text("\n".join(lines), encoding="utf-8")
        log.warning("%d POIs with low/no_match confidence → %s", len(unmatched), out)

    return places


def _run_phase2(places: list[dict], api_key: str, limit: int, dry_run: bool) -> list[dict]:
    """Phase 2: Place Details Enterprise → opening_hours, close_days, rating, formatted_address."""
    eligible = [
        p for p in places
        if p.get("google_place_id")
        and p.get("google_match_confidence") in ("high", "medium")
        and p.get("rating") is None   # resume: skip if already enriched
    ][:limit]

    log.info("Phase 2: %d POIs to enrich", len(eligible))

    for i, place in enumerate(eligible, 1):
        _progress(i, len(eligible), 2, place["name"])
        details = fetch_place_details(place["google_place_id"], api_key)
        time.sleep(_REQUEST_DELAY)

        if details is None:
            continue

        if dry_run:
            log.info(
                "  [DRY] %s → hours=%s close=%s rating=%s",
                place["id"], details["opening_hours"], details["close_days"], details["rating"],
            )
            continue

        place["opening_hours"]    = details["opening_hours"]
        place["close_days"]       = details["close_days"]
        place["rating"]           = details["rating"]
        if details["formatted_address"]:
            place["formatted_address"] = details["formatted_address"]

        _save_json(places)

    print()
    return places


def _run_phase3(places: list[dict], api_key: str, limit: int, dry_run: bool) -> list[dict]:
    """Phase 3: Photos → download → Supabase Storage → image_url (always replaces)."""
    eligible = [
        p for p in places
        if p.get("google_place_id")
        and p.get("google_match_confidence") in ("high", "medium")
    ][:limit]

    log.info("Phase 3: %d POIs to fetch photos for (always replaces image_url)", len(eligible))

    for i, place in enumerate(eligible, 1):
        _progress(i, len(eligible), 3, place["name"])

        photo_name = fetch_photo_name(place["google_place_id"], api_key)
        time.sleep(_REQUEST_DELAY)

        if not photo_name:
            log.warning("  No photo found for %s", place["id"])
            continue

        if dry_run:
            log.info("  [DRY] %s → photo_name=%s", place["id"], photo_name[:60])
            continue

        jpeg = download_photo(photo_name, api_key)
        if not jpeg or len(jpeg) < 10_000:
            log.warning("  Photo download empty/tiny for %s — skipping", place["id"])
            continue

        pub_url = upload_to_supabase(place["id"], jpeg)
        if pub_url:
            place["image_url"] = pub_url
            _save_json(places)
        else:
            log.warning("  Supabase upload failed for %s", place["id"])

    print()
    return places


# ══════════════════════════════════════════════════════════════════════════════
# Section 8 — CLI entry point
# ══════════════════════════════════════════════════════════════════════════════

def enrich(phase: str = "all", limit: int = 0, dry_run: bool = False) -> None:
    """Main entry point. phase: "1"|"2"|"3"|"all"."""
    api_key = settings.google_places_api_key
    if not api_key:
        sys.exit(
            "GOOGLE_PLACES_API_KEY not set in backend/.env\n"
            "Add it and re-run."
        )

    if not _DATA_FILE.exists():
        sys.exit(f"Data file not found: {_DATA_FILE}")

    places   = _load_json()
    total_in = len(places)
    log.info("Loaded %d POIs from %s", total_in, _DATA_FILE.name)

    if dry_run:
        log.info("*** DRY RUN — no files will be written ***")

    effective_limit = limit if limit > 0 else len(places)

    if phase in ("1", "all"):
        places = _run_phase1(places, api_key, effective_limit, dry_run)

    if phase in ("2", "all"):
        places = _run_phase2(places, api_key, effective_limit, dry_run)

    if phase in ("3", "all"):
        places = _run_phase3(places, api_key, effective_limit, dry_run)

    # ── Final summary ─────────────────────────────────────────────────────
    total_out   = len(places)
    with_pid    = sum(1 for p in places if p.get("google_place_id"))
    with_img    = sum(1 for p in places if p.get("image_url"))
    with_rating = sum(1 for p in places if p.get("rating") is not None)
    removed     = total_in - total_out

    print()
    log.info("=== Enrichment complete ===")
    log.info("POIs in    : %d", total_in)
    log.info("POIs out   : %d  (-%d CLOSED_PERMANENTLY removed)", total_out, removed)
    log.info("place_id   : %d / %d", with_pid, total_out)
    log.info("image_url  : %d / %d", with_img, total_out)
    log.info("rating     : %d / %d", with_rating, total_out)
    log.info("Next step  : cd backend && python -m app.scripts.seed_db")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich singapore_places.json using Google Places API (New)"
    )
    parser.add_argument(
        "--phase", choices=["1", "2", "3", "all"], default="all",
        help="Which phase(s) to run (default: all)",
    )
    parser.add_argument(
        "--limit", type=int, default=0, metavar="N",
        help="Process only first N POIs per phase (0 = all)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print planned changes without writing anything",
    )
    args = parser.parse_args()
    enrich(phase=args.phase, limit=args.limit, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
