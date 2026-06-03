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
  missing_images.txt                      ATTRACTION/HERITAGE without any image found

Supabase sync: run seed_db.py AFTER this script — it does a full-row upsert
that includes image_url.  seed_images.py only writes JSON; it does NOT touch
the DB directly (partial-column upsert against a NOT NULL table is unsafe).

The script is resumable: POIs whose image_url is already set in JSON are skipped.
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
except ImportError as exc:
    sys.exit(
        f"Import error: {exc}\n"
        "Run from backend/ with deps installed:\n"
        "  cd backend && python -m app.scripts.seed_images"
    )

# ── Constants ─────────────────────────────────────────────────────────────────

_ACCURATE_CATEGORIES     = {"ATTRACTION", "HERITAGE"}
_ILLUSTRATIVE_CATEGORIES = {"FOOD_BEVERAGE", "SHOPPING"}

# Wikipedia — Wikimedia UA policy requires a contact address
_WIKI_UA          = "IMOVEV2-image-seeder/1.0 (khoaradequa@gmail.com)"
_WIKI_DELAY       = 1.5    # seconds between successful Wikipedia requests
_WIKI_MAX_RETRIES = 3      # retries per title variant on HTTP 429
_WIKI_RETRY_WAIT  = 65     # base seconds to sleep on 429 (overridden by Retry-After)

_UNSPLASH_DELAY   = 73.0   # 50 req/hr demo key → 72 s/req + 1 s buffer

_FALLBACK_QUERIES = {
    "FOOD_BEVERAGE": "Singapore hawker food",
    "SHOPPING":      "Singapore Orchard Road shopping mall",
}

_BATCH_SIZE = 50

# ── Wikipedia ─────────────────────────────────────────────────────────────────

class _WikiThrottle(Exception):
    """Raised when Wikipedia returns HTTP 429 (rate-limited)."""
    def __init__(self, retry_after: int):
        self.retry_after = retry_after


def _wiki_fetch(title: str) -> str | None:
    """
    Fetch Wikipedia page thumbnail for *title*.

    Returns:
        URL string on hit, None on genuine miss (404 / no thumbnail).
    Raises:
        _WikiThrottle if HTTP 429 — caller should back off then retry.
    """
    encoded = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded}"
    req = urllib.request.Request(url, headers={"User-Agent": _WIKI_UA})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            thumb = data.get("thumbnail", {}).get("source")
            if not thumb:
                return None
            # Upscale: replace any /NNNpx- token with /800px-
            return re.sub(r"/\d+px-", "/800px-", thumb)
    except urllib.error.HTTPError as e:
        if e.status == 429:
            # Honour Retry-After header when present; fall back to _WIKI_RETRY_WAIT
            retry_after = int(e.headers.get("Retry-After", str(_WIKI_RETRY_WAIT)))
            raise _WikiThrottle(retry_after)
        # 404, 301 to disambiguation, 5xx transient — treat as miss
        return None
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        # DNS / connection / decode error — treat as miss, don't abort the run
        return None


def fetch_wikipedia(name: str) -> str | None:
    """
    Try Wikipedia with bare name, then 'name Singapore'.
    Retries up to _WIKI_MAX_RETRIES times per variant on HTTP 429.
    """
    for variant in (name, f"{name} Singapore"):
        for attempt in range(_WIKI_MAX_RETRIES):
            try:
                url = _wiki_fetch(variant)
                time.sleep(_WIKI_DELAY)
                if url:
                    return url
                break  # genuine miss on this variant — try next variant
            except _WikiThrottle as t:
                wait = t.retry_after + 5   # add small buffer above Retry-After
                log.warning(
                    "Wikipedia 429 on %r — sleeping %ds (attempt %d/%d)",
                    variant, wait, attempt + 1, _WIKI_MAX_RETRIES,
                )
                time.sleep(wait)
                if attempt == _WIKI_MAX_RETRIES - 1:
                    log.error("Wikipedia: max retries exhausted for %r — skipping", variant)
    return None


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
            headers={"Authorization": f"Client-ID {key}", "Accept-Version": "v1"},
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
    # ── Load data ─────────────────────────────────────────────────────────────
    if not _DATA_FILE.exists():
        sys.exit(f"Data file not found: {_DATA_FILE}")

    raw: list[dict] = json.loads(_DATA_FILE.read_text(encoding="utf-8"))
    log.info("Loaded %d POIs from %s", len(raw), _DATA_FILE.name)

    unsplash_key: str = settings.unsplash_access_key or ""
    if not unsplash_key:
        log.warning(
            "UNSPLASH_ACCESS_KEY not set — "
            "FOOD_BEVERAGE/SHOPPING fallback will be skipped (image_url stays None)"
        )

    # ── Resume: skip POIs that already have a real URL ────────────────────────
    # image_url=null in JSON → Python None → treated as pending (re-fetched)
    # image_url="https://..." in JSON → kept as-is (skipped)
    already_done = [p for p in raw if p.get("image_url")]
    pending      = [p for p in raw if not p.get("image_url")]
    if already_done:
        log.info("Resuming: %d already have image_url, %d pending", len(already_done), len(pending))

    # ── Pre-fetch category fallback pool (2 Unsplash calls at startup) ────────
    fallback_pool: dict[str, list[str]] = {cat: [] for cat in _ILLUSTRATIVE_CATEGORIES}
    if unsplash_key:
        log.info("Pre-fetching category fallback pools ...")
        for cat, query in _FALLBACK_QUERIES.items():
            urls = _unsplash_search(query, unsplash_key, count=10)
            fallback_pool[cat] = urls
            log.info("  %-16s -> %d fallback images", cat, len(urls))
            time.sleep(_UNSPLASH_DELAY)

    fallback_idx: dict[str, int] = {cat: 0 for cat in _ILLUSTRATIVE_CATEGORIES}
    # Initialise results from current JSON state (preserves already-done entries)
    results: dict[str, str | None] = {p["id"]: p.get("image_url") or None for p in raw}

    # ── Phase 1: Wikipedia pass ───────────────────────────────────────────────
    log.info("\n-- Phase 1: Wikipedia (%d POIs) --", len(pending))
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
    log.info("\n-- Phase 2: Unsplash (%d FOOD_BEVERAGE/SHOPPING misses) --", len(misses))
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
            pool = fallback_pool.get(cat, [])
            if pool:
                url = pool[fallback_idx[cat] % len(pool)]
                fallback_idx[cat] += 1
                fallback_used += 1

        results[pid] = url

    _clear_progress()
    log.info("Unsplash found %d, fallback used %d", unsplash_hits, fallback_used)

    # ── Phase 3: Log ATTRACTION/HERITAGE with no image ────────────────────────
    missing_entries: list[str] = []
    for place in pending:
        if not results[place["id"]] and place["category"] in _ACCURATE_CATEGORIES:
            missing_entries.append(
                f"{place['category']}\t{place['id']}\t{place['name']}"
            )
    if missing_entries:
        log.warning(
            "%d ATTRACTION/HERITAGE POIs have no image -- see %s",
            len(missing_entries), _MISSING_OUT,
        )

    # ── Phase 4: Write updated JSON ───────────────────────────────────────────
    log.info("\n-- Writing singapore_places.json --")
    for place in raw:
        place["image_url"] = results[place["id"]]
    _DATA_FILE.write_text(
        json.dumps(raw, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    log.info("Saved %s", _DATA_FILE)

    # ── Phase 5: Write missing list ───────────────────────────────────────────
    if missing_entries:
        _MISSING_OUT.write_text(
            "\n".join(["category\tid\tname"] + missing_entries),
            encoding="utf-8",
        )

    # ── Summary ───────────────────────────────────────────────────────────────
    total_with_image = sum(1 for v in results.values() if v)
    print()
    log.info("=== Seed complete ===")
    log.info("Total POIs        : %d", len(raw))
    log.info("With image_url    : %d", total_with_image)
    log.info("Missing (manual)  : %d ATTRACTION/HERITAGE", len(missing_entries))
    if missing_entries:
        log.info("See               : %s", _MISSING_OUT.resolve())
    if fallback_used:
        log.info("Illustrative      : %d FOOD_BEVERAGE/SHOPPING used category fallback", fallback_used)
    log.info("")
    log.info("Next step: sync to Supabase")
    log.info("  cd backend && python -m app.scripts.seed_db")

    if missing_entries:
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
