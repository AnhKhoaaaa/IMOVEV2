#!/usr/bin/env python3
"""
Seed script: fetches and stores image_url for all 499 Singapore POIs.

Accuracy policy (per dev9 plan):
  ATTRACTION + HERITAGE  → Wikipedia only; NULL if not found (manual review)
  FOOD_BEVERAGE/SHOPPING → Wikipedia → Unsplash → category illustrative fallback

Run from backend/:
    cd backend && python -m app.scripts.seed_images

Output:
  backend/app/data/singapore_places.json  updated in-place (image_url field added)
  Supabase places.image_url              upserted (migration 009 must be applied first)
  missing_images.txt                     ATTRACTION/HERITAGE without any image found

The script is resumable: POIs that already have image_url set in the JSON are skipped.
"""

import json
import logging
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_DATA_FILE   = _BACKEND_DIR / "app" / "data" / "singapore_places.json"
_MISSING_OUT = Path("missing_images.txt")   # written to CWD (backend/)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

try:
    from app.config import settings
    from supabase import create_client
except ImportError as exc:
    sys.exit(
        f"Import error: {exc}\n"
        "Run from backend/ with deps installed:\n"
        "  cd backend && python -m app.scripts.seed_images"
    )

# ── Constants ─────────────────────────────────────────────────────────────────

_ACCURATE_CATEGORIES     = {"ATTRACTION", "HERITAGE"}
_ILLUSTRATIVE_CATEGORIES = {"FOOD_BEVERAGE", "SHOPPING"}

_WIKI_DELAY      = 0.25   # seconds between Wikipedia requests
_UNSPLASH_DELAY  = 73.0   # 50 req/hr demo key → 72 s/req + 1 s buffer

_FALLBACK_QUERIES = {
    "FOOD_BEVERAGE": "Singapore hawker food",
    "SHOPPING":      "Singapore Orchard Road shopping mall",
}

_BATCH_SIZE = 50   # Supabase upsert batch size

# ── Wikipedia ─────────────────────────────────────────────────────────────────

def _wiki_fetch(title: str) -> str | None:
    """Fetch Wikipedia page thumbnail URL for *title*. Returns None on miss."""
    encoded = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded}"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "IMOVEV2-image-seeder/1.0 (educational project)"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                return None
            data = json.loads(resp.read())
            thumb = data.get("thumbnail", {}).get("source")
            if not thumb:
                return None
            # Upscale: e.g. /320px- or /200px- → /800px-
            return re.sub(r"/\d+px-", "/800px-", thumb)
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return None


def fetch_wikipedia(name: str) -> str | None:
    """Try Wikipedia with bare name, then 'name Singapore'."""
    url = _wiki_fetch(name)
    time.sleep(_WIKI_DELAY)
    if url:
        return url
    url = _wiki_fetch(f"{name} Singapore")
    time.sleep(_WIKI_DELAY)
    return url


# ── Unsplash ──────────────────────────────────────────────────────────────────

def _unsplash_search(query: str, key: str, count: int = 1) -> list[str]:
    """Search Unsplash. Returns up to *count* regular-size image URLs."""
    encoded = urllib.parse.quote(query)
    url = (
        f"https://api.unsplash.com/search/photos"
        f"?query={encoded}&per_page={count}&orientation=landscape"
    )
    try:
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Client-ID {key}",
                "Accept-Version": "v1",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status != 200:
                return []
            data = json.loads(resp.read())
            return [r["urls"]["regular"] for r in data.get("results", []) if r.get("urls")]
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        log.warning("Unsplash search failed for %r: %s", query, exc)
        return []


# ── Main ──────────────────────────────────────────────────────────────────────

def seed() -> None:
    # ── Validate env & load data ──────────────────────────────────────────────
    if not _DATA_FILE.exists():
        sys.exit(f"Data file not found: {_DATA_FILE}")

    raw: list[dict] = json.loads(_DATA_FILE.read_text(encoding="utf-8"))
    log.info("Loaded %d POIs from %s", len(raw), _DATA_FILE.name)

    unsplash_key: str = settings.unsplash_access_key or ""
    if not unsplash_key:
        log.warning(
            "UNSPLASH_ACCESS_KEY not set — "
            "FOOD_BEVERAGE/SHOPPING fallback will be skipped (image_url=None for misses)"
        )

    client = None
    if settings.supabase_url and settings.supabase_service_role_key:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        log.info("Supabase client ready")
    else:
        log.warning("Supabase credentials missing — will update JSON only")

    # ── Count resumable skips ─────────────────────────────────────────────────
    already_done = [p for p in raw if p.get("image_url") is not None]
    pending      = [p for p in raw if p.get("image_url") is None]
    if already_done:
        log.info("Resuming: %d already have image_url, %d pending", len(already_done), len(pending))
    else:
        pending = list(raw)

    # ── Pre-fetch category fallback pool (2 Unsplash calls at startup) ────────
    fallback_pool: dict[str, list[str]] = {cat: [] for cat in _ILLUSTRATIVE_CATEGORIES}
    if unsplash_key:
        log.info("Pre-fetching category fallback pools …")
        for cat, query in _FALLBACK_QUERIES.items():
            urls = _unsplash_search(query, unsplash_key, count=10)
            fallback_pool[cat] = urls
            log.info("  %-16s → %d fallback images", cat, len(urls))
            time.sleep(_UNSPLASH_DELAY)

    fallback_idx: dict[str, int] = {cat: 0 for cat in _ILLUSTRATIVE_CATEGORIES}
    results: dict[str, str | None] = {p["id"]: p.get("image_url") for p in raw}

    # ── Phase 1: Wikipedia pass (all pending POIs) ────────────────────────────
    log.info("\n── Phase 1: Wikipedia (%d POIs) ──", len(pending))
    wiki_hits = 0
    for i, place in enumerate(pending, 1):
        pid  = place["id"]
        name = place["name"]
        _progress(i, len(pending), f"Wikipedia: {name}")
        url = fetch_wikipedia(name)
        if url:
            results[pid] = url
            wiki_hits += 1

    _clear_progress()
    log.info("Wikipedia found %d / %d", wiki_hits, len(pending))

    # ── Phase 2: Unsplash + fallback for FOOD_BEVERAGE / SHOPPING misses ──────
    misses = [
        p for p in pending
        if not results[p["id"]]
        and p["category"] in _ILLUSTRATIVE_CATEGORIES
    ]
    log.info("\n── Phase 2: Unsplash (%d FOOD_BEVERAGE/SHOPPING misses) ──", len(misses))
    if misses and unsplash_key:
        log.info("ETA with demo key (50 req/hr): ~%.0f min", len(misses) * _UNSPLASH_DELAY / 60)

    unsplash_hits = 0
    fallback_used = 0
    for i, place in enumerate(misses, 1):
        pid  = place["id"]
        name = place["name"]
        cat  = place["category"]
        _progress(i, len(misses), f"Unsplash: {name}")

        url = None
        if unsplash_key:
            hits = _unsplash_search(f"{name} Singapore", unsplash_key, count=1)
            url  = hits[0] if hits else None
            time.sleep(_UNSPLASH_DELAY)

        if url:
            unsplash_hits += 1
        else:
            # Illustrative category fallback (round-robin from pre-fetched pool)
            pool = fallback_pool.get(cat, [])
            if pool:
                url = pool[fallback_idx[cat] % len(pool)]
                fallback_idx[cat] += 1
                fallback_used += 1

        results[pid] = url

    _clear_progress()
    log.info("Unsplash found %d, fallback used %d", unsplash_hits, fallback_used)

    # ── Phase 3: Collect ATTRACTION/HERITAGE with no image ────────────────────
    missing_entries: list[str] = []
    for place in pending:
        if not results[place["id"]] and place["category"] in _ACCURATE_CATEGORIES:
            missing_entries.append(
                f"{place['category']}\t{place['id']}\t{place['name']}"
            )
    if missing_entries:
        log.warning(
            "%d ATTRACTION/HERITAGE POIs have no image — see %s",
            len(missing_entries), _MISSING_OUT,
        )

    # ── Phase 4: Write updated JSON ───────────────────────────────────────────
    log.info("\n── Writing singapore_places.json ──")
    for place in raw:
        place["image_url"] = results[place["id"]]
    _DATA_FILE.write_text(
        json.dumps(raw, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    log.info("Saved %s", _DATA_FILE)

    # ── Phase 5: Upsert image_url to Supabase ─────────────────────────────────
    if client:
        log.info("\n── Upserting to Supabase ──")
        upsert_rows = [{"id": p["id"], "image_url": results[p["id"]]} for p in raw]
        supabase_errors: list[str] = []
        for start in range(0, len(upsert_rows), _BATCH_SIZE):
            batch = upsert_rows[start : start + _BATCH_SIZE]
            try:
                client.table("places").upsert(batch, on_conflict="id").execute()
            except Exception as exc:
                supabase_errors.append(f"batch {start}: {exc}")
                log.warning("Supabase batch %d failed: %s", start, exc)
            _progress(
                min(start + _BATCH_SIZE, len(upsert_rows)),
                len(upsert_rows),
                "Supabase upsert",
            )
            time.sleep(0.1)
        _clear_progress()
        if supabase_errors:
            log.error("%d Supabase batch(es) failed", len(supabase_errors))
        else:
            log.info("Supabase upsert complete")

    # ── Phase 6: Write missing list ───────────────────────────────────────────
    if missing_entries:
        _MISSING_OUT.write_text(
            "\n".join(["category\tid\tname"] + missing_entries),
            encoding="utf-8",
        )

    # ── Summary ───────────────────────────────────────────────────────────────
    total_with_image = sum(1 for v in results.values() if v)
    print()
    log.info("═══ Seed complete ═══")
    log.info("Total POIs       : %d", len(raw))
    log.info("With image_url   : %d", total_with_image)
    log.info("Missing (manual) : %d ATTRACTION/HERITAGE", len(missing_entries))
    if missing_entries:
        log.info("See              : %s", _MISSING_OUT.resolve())
    if fallback_used:
        log.info("Illustrative     : %d FOOD_BEVERAGE/SHOPPING used category fallback", fallback_used)

    if missing_entries or (client and supabase_errors):
        sys.exit(1)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _progress(current: int, total: int, label: str) -> None:
    bar_width = 30
    filled = int(bar_width * current / max(total, 1))
    bar = "#" * filled + "." * (bar_width - filled)
    print(
        f"  [{bar}] {current:3d}/{total}  {label[:50]:<50}",
        end="\r",
        flush=True,
    )


def _clear_progress() -> None:
    print(" " * 100, end="\r")


if __name__ == "__main__":
    seed()
