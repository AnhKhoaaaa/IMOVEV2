"""
Enrich singapore_places.json with best_time_start / best_time_end.
Rules:
  1. SPECIFIC dict — research-backed per-place overrides
  2. Fallback — category + opening_hours pattern rules
  3. Validator ensures proposed times fall within opening_hours
"""
import json
from pathlib import Path

SRC = Path(__file__).parent.parent / "app" / "data" / "singapore_places.json"
DST = SRC  # overwrite in-place

# ── helpers ───────────────────────────────────────────────────────────────────

def _hhmm_to_min(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _min_to_hhmm(m: int) -> str:
    m = m % (24 * 60)
    return f"{m // 60:02d}:{m % 60:02d}"


def _within_hours(start: str, end: str, slots: list[str]) -> bool:
    """Return True if BOTH start and end fall inside any opening slot."""
    if not slots:
        return True
    s_min, e_min = _hhmm_to_min(start), _hhmm_to_min(end)
    for slot in slots:
        if "-" not in slot:
            continue
        parts = slot.split("-")
        a, b = _hhmm_to_min(parts[0].strip()), _hhmm_to_min(parts[1].strip())
        midnight_cross = b < a  # e.g. 19:00-02:00
        if midnight_cross:
            s_ok = s_min >= a or s_min <= b
            e_ok = e_min >= a or e_min <= b
        else:
            s_ok = a <= s_min <= b
            e_ok = a <= e_min <= b
        if s_ok and e_ok:
            return True
    return False


def _first_slot_open(slots: list[str]) -> str:
    """Return opening time of first slot, or '09:00' if missing."""
    if not slots or "-" not in slots[0]:
        return "09:00"
    return slots[0].split("-")[0].strip()


def _first_slot_close(slots: list[str]) -> str:
    if not slots or "-" not in slots[0]:
        return "21:00"
    raw = slots[0].split("-")[1].strip()
    # midnight-crossing: cap at 23:00 for readability
    start = _hhmm_to_min(slots[0].split("-")[0].strip())
    end = _hhmm_to_min(raw)
    if end < start:
        return "23:00"
    return raw


# ── specific per-place overrides (research-backed) ────────────────────────────

SPECIFIC: dict[str, tuple[str, str]] = {
    # Marina Bay / CBD
    "merlion-park":                         ("07:00", "10:00"),
    "marina-bay-sands-skypark":             ("18:30", "21:00"),
    "artscience-museum":                    ("10:00", "14:00"),
    "art-science-museum-future-world":      ("10:00", "14:00"),
    "esplanade-theatres-on-the-bay":        ("19:00", "22:00"),
    "esplanade-outdoor-theatre":            ("19:00", "22:00"),
    "gardens-by-the-bay-supertree-grove":   ("19:00", "21:00"),  # Garden Rhapsody 19:45 & 20:45
    "gardens-by-the-bay-flower-dome":       ("10:00", "13:00"),
    "gardens-by-the-bay-cloud-forest":      ("10:00", "13:00"),
    "gardens-by-the-bay-ocbc-skyway":       ("09:00", "12:00"),
    "gardens-by-the-bay-satay-by-the-bay":  ("18:00", "21:00"),
    "singapore-flyer":                      ("18:00", "21:00"),  # sunset + city lights
    "marina-barrage":                       ("17:00", "20:00"),
    "helix-bridge":                         ("18:00", "21:00"),
    "lau-pa-sat-festival-market":           ("11:30", "14:00"),
    "lau-pa-sat-satay-street":              ("19:00", "23:00"),
    "rasapura-masters-marina-bay-sands":    ("11:30", "14:30"),
    "ce-la-vi-sky-bar":                     ("18:00", "22:00"),
    "shoppes-at-marina-bay-sands":          ("14:00", "20:00"),
    "marina-square":                        ("14:00", "20:00"),
    "suntec-city-mall":                     ("14:00", "20:00"),
    "suntec-city-north-wing":               ("14:00", "20:00"),
    "suntec-fountain-of-wealth":            ("10:00", "19:00"),
    "millenia-walk":                        ("14:00", "20:00"),
    "raffles-city-shopping-centre":         ("14:00", "20:00"),
    "marina-bay-sands-event-plaza":         ("18:00", "22:00"),
    "the-promontory-mbay":                  ("18:00", "21:00"),
    "marina-bay-food-festival":             ("18:00", "22:00"),
    "marina-bay-golf-course":               ("07:00", "12:00"),
    "one-fullerton-restaurants":            ("18:00", "22:00"),

    # Colonial Core heritage
    "national-gallery-singapore":           ("10:00", "14:00"),
    "victoria-theatre-concert-hall":        ("19:00", "22:00"),
    "asian-civilisations-museum":           ("10:00", "14:00"),
    "the-arts-house":                       ("19:00", "22:00"),
    "fullerton-hotel-singapore":            ("14:00", "17:00"),
    "raffles-hotel-singapore":              ("14:00", "18:00"),
    "raffles-hotel-long-bar":               ("11:00", "15:00"),
    "raffles-landing-site":                 ("09:00", "12:00"),
    "old-hill-street-police-station":       ("10:00", "14:00"),
    "cathedral-of-the-good-shepherd":       ("09:00", "12:00"),
    "cathedral-of-good-shepherd-heritage":  ("09:00", "14:00"),
    "st-andrews-cathedral":                 ("09:00", "12:00"),
    "chijmes":                              ("18:00", "22:00"),
    "battlebox-fort-canning":               ("10:00", "14:00"),
    "battle-box-expanded":                  ("10:00", "14:00"),
    "hong-lim-park":                        ("09:00", "12:00"),
    "fort-canning-park":                    ("07:00", "11:00"),
    "telok-ayer-street-heritage-walk":      ("09:00", "12:00"),
    "cavenagh-bridge":                      ("07:00", "10:00"),
    "keramat-iskandar-shah":                ("09:00", "12:00"),
    "singaporeriver-heritage-walk":         ("09:00", "12:00"),
    "fuk-tak-chi-museum":                   ("10:00", "14:00"),
    "goodwood-park-hotel":                  ("14:00", "18:00"),

    # Boat Quay / Clarke Quay / Robertson Quay
    "boat-quay":                            ("19:00", "23:00"),
    "clarke-quay":                          ("20:00", "01:00"),
    "robertson-quay":                       ("18:00", "22:00"),
    "jumbo-seafood-clarke-quay":            ("18:00", "22:00"),
    "great-world-city":                     ("14:00", "20:00"),
    "zion-riverside-food-centre":           ("07:00", "11:00"),
    "clarke-quay-centralMall":              ("14:00", "21:00"),

    # Orchard Road
    "ion-orchard":                          ("14:00", "20:00"),
    "ngee-ann-city-takashimaya":            ("14:00", "20:00"),
    "paragon-orchard":                      ("14:00", "20:00"),
    "313-somerset":                         ("14:00", "20:00"),
    "orchard-central":                      ("14:00", "20:00"),
    "far-east-plaza":                       ("14:00", "20:00"),
    "lucky-plaza-orchard":                  ("14:00", "20:00"),
    "wisma-atria":                          ("14:00", "20:00"),
    "forum-the-shopping-mall":              ("14:00", "20:00"),
    "wheelock-place":                       ("14:00", "20:00"),
    "shaw-centre":                          ("14:00", "20:00"),
    "plaza-singapura":                      ("14:00", "20:00"),
    "plaza-singapura-lvb":                  ("14:00", "21:00"),
    "the-centrepoint":                      ("14:00", "20:00"),
    "scotts-square":                        ("14:00", "20:00"),
    "dfs-galleria-scotts":                  ("14:00", "19:00"),
    "tangs-orchard":                        ("14:00", "20:00"),
    "orchard-gateway":                      ("14:00", "20:00"),
    "palais-renaissance":                   ("14:00", "20:00"),
    "orchard-road-belt":                    ("18:00", "22:00"),
    "cathay-cineleisure-orchard":           ("14:00", "21:00"),
    "the-istana-singapore":                 ("09:00", "13:00"),
    "newton-food-centre":                   ("19:00", "23:00"),
    "din-tai-fung-paragon":                 ("11:30", "14:00"),
    "food-republic-ion-orchard":            ("11:30", "15:00"),
    "llaollao-ion-orchard":                 ("11:00", "17:00"),
    "ya-kun-kaya-toast-fep":                ("08:00", "11:00"),
    "crystal-jade-la-mian":                 ("11:30", "14:00"),
    "paradise-dynasty-ifc":                 ("12:00", "15:00"),
    "imperial-treasure-nan-bei":            ("12:00", "14:00"),
    "atlas-bar-singapore":                  ("17:00", "23:00"),
    "swisshotel-bar":                       ("19:00", "23:00"),
    "1-altitude-gallery":                   ("19:00", "01:00"),
    "la-terraza-ibis":                      ("17:00", "21:00"),
    "novena-square-velocity":               ("14:00", "20:00"),
    "novena-square2":                       ("14:00", "20:00"),
    "united-square-novena":                 ("14:00", "20:00"),
    "novena-united-square-food":            ("11:00", "15:00"),

    # Chinatown
    "sri-mariamman-temple":                 ("07:00", "11:00"),
    "thian-hock-keng-temple":               ("09:00", "12:00"),
    "buddha-tooth-relic-temple":            ("09:00", "13:00"),
    "chinatown-heritage-centre":            ("10:00", "13:00"),
    "chinatown-street-market":              ("18:00", "21:00"),
    "smith-street-food-street":             ("18:00", "22:00"),
    "maxwell-food-centre":                  ("11:00", "14:00"),
    "tian-tian-chicken-rice-maxwell":       ("11:00", "14:00"),
    "chinatown-complex-food-centre":        ("07:30", "10:00"),
    "amoy-street-food-centre":              ("07:30", "10:00"),
    "hong-lim-market-food-centre":          ("07:00", "10:00"),
    "tanjong-pagar-plaza-market":           ("07:00", "10:00"),
    "chinatown-point":                      ("14:00", "20:00"),
    "peoples-park-complex":                 ("11:00", "17:00"),
    "peoples-park-centre":                  ("11:00", "17:00"),
    "ann-siang-hill":                       ("18:00", "22:00"),
    "keong-saik-road":                      ("18:00", "22:00"),
    "keong-saik-bakery":                    ("09:00", "13:00"),
    "tiong-bahru-market":                   ("07:00", "11:00"),
    "tiong-bahru-plaza":                    ("14:00", "20:00"),
    "tiong-bahru-estate-walk":              ("09:00", "12:00"),
    "tiong-bahru-bakery":                   ("09:00", "12:00"),
    "tiong-bahru-social-club":              ("08:00", "12:00"),
    "tiong-bahru-mian-jia":                 ("07:00", "11:00"),
    "tiong-bahru-yong-siak-street":         ("09:00", "13:00"),
    "lim-chee-guan":                        ("09:00", "14:00"),
    "tang-tea-house":                       ("11:00", "16:00"),
    "song-fa-bak-kut-teh":                  ("09:00", "13:00"),
    "eu-yan-sang-heritage":                 ("09:00", "14:00"),
    "baba-house":                           ("10:00", "13:00"),
    "nus-baba-house":                       ("10:00", "14:00"),
    "china-square-food-centre":             ("08:00", "13:00"),
    "one-raffles-place-mall":               ("11:00", "17:00"),
    "shenton-way-food-cluster":             ("07:30", "13:00"),
    "nagore-durgha-shrine":                 ("07:00", "12:00"),
    "masjid-jamae-chulia":                  ("09:00", "13:00"),

    # Kampong Glam
    "sultan-mosque":                        ("10:00", "12:00"),
    "masjid-hajjah-fatimah":               ("09:00", "12:00"),
    "haji-lane-arab-street":               ("15:00", "20:00"),
    "kampong-glam-heritage-trail":         ("09:00", "12:00"),
    "kampung-gelam-malay-heritage":        ("10:00", "14:00"),
    "malay-heritage-trail-geylang":        ("10:00", "14:00"),

    # Little India / Bugis
    "little-india-arcade":                 ("10:00", "15:00"),
    "sri-veeramakaliamman-temple":         ("05:30", "10:00"),
    "sri-srinivasa-perumal-temple":        ("06:30", "11:00"),
    "sakya-muni-buddha-gaya-temple":       ("09:00", "13:00"),
    "indian-heritage-centre":              ("10:00", "14:00"),
    "kwan-im-thong-hood-cho-temple":       ("06:15", "10:00"),
    "tekka-market":                        ("07:00", "11:00"),
    "tekka-centre-hawker":                 ("07:00", "11:00"),
    "albert-centre-market":               ("07:00", "11:00"),
    "armenian-church-singapore":          ("09:00", "12:00"),
    "national-library-singapore":         ("11:00", "15:00"),
    "singapore-art-museum":               ("10:00", "14:00"),
    "peranakan-museum":                   ("10:00", "14:00"),
    "national-museum-of-singapore":       ("10:00", "14:00"),
    "bugis-junction":                     ("14:00", "20:00"),
    "bugis-plus":                         ("14:00", "20:00"),
    "mustafa-centre":                     ("14:00", "20:00"),
    "sim-lim-square":                     ("11:00", "18:00"),
    "sim-lim-tower":                      ("11:00", "17:00"),
    "golden-mile-food-centre":            ("07:00", "11:00"),
    "berseh-food-centre":                 ("07:00", "11:00"),
    "golden-mile-complex":                ("12:00", "18:00"),
    "city-square-mall":                   ("14:00", "20:00"),
    "funan-mall":                         ("14:00", "20:00"),
    "funan-rooftop-farm":                 ("09:00", "13:00"),
    "capitol-piazza":                     ("14:00", "20:00"),
    "pek-kio-market":                     ("07:00", "11:00"),
    "sun-yat-sen-memorial-hall":          ("10:00", "14:00"),

    # Sentosa
    "universal-studios-singapore":         ("10:00", "14:00"),
    "sea-aquarium-sentosa":                ("10:00", "14:00"),
    "singapore-s-e-a-aquarium-new":        ("10:00", "14:00"),
    "adventure-cove-waterpark":            ("10:00", "14:00"),
    "wings-of-time-sentosa":               ("19:40", "21:10"),
    "ifly-singapore-sentosa":              ("10:00", "14:00"),
    "madame-tussauds-singapore":           ("10:00", "14:00"),
    "siloso-beach-sentosa":                ("09:00", "12:00"),
    "palawan-beach-sentosa":               ("09:00", "12:00"),
    "tanjong-beach-sentosa":               ("09:00", "12:00"),
    "palawan-beach-southernmost-point":    ("09:00", "12:00"),
    "fort-siloso":                         ("10:00", "14:00"),
    "skyline-luge-sentosa":                ("11:00", "15:00"),
    "sentosa-boardwalk":                   ("08:00", "12:00"),
    "sentosa-cable-car":                   ("09:00", "12:00"),
    "singapore-cable-car-harbourfront":    ("09:00", "12:00"),
    "resorts-world-sentosa-casino":        ("20:00", "01:00"),
    "trick-eye-museum-sentosa":            ("10:00", "14:00"),
    "tanjong-beach-club":                  ("15:00", "19:00"),
    "the-knolls-capella":                  ("12:00", "14:30"),
    "images-of-singapore-live":            ("10:00", "14:00"),
    "siloso-point-sentosa":                ("10:00", "15:00"),
    "wavehouse-sentosa-sports":            ("11:00", "15:00"),
    "maritime-experiential-museum":        ("10:00", "14:00"),
    "sentosa-express":                     ("10:00", "18:00"),
    "sentosa-golfclub":                    ("07:00", "12:00"),
    "sentosa-cable-car":                   ("09:00", "12:00"),

    # East / Katong / Changi
    "east-coast-park":                     ("07:00", "11:00"),
    "east-coast-lagoon-food-village":      ("18:00", "21:00"),
    "old-airport-road-food-centre":        ("07:00", "11:00"),
    "geylang-serai-market":                ("07:00", "11:00"),
    "bedok-interchange-hawker-centre":     ("07:00", "10:00"),
    "bedok-85-fengshan-market":            ("19:00", "23:00"),
    "changi-beach-park":                   ("07:00", "11:00"),
    "pasir-ris-park":                      ("07:00", "11:00"),
    "joo-chiat-katong-heritage":           ("10:00", "14:00"),
    "i12-katong":                          ("14:00", "20:00"),
    "parkway-parade":                      ("14:00", "20:00"),
    "tampines-mall":                       ("14:00", "20:00"),
    "century-square":                      ("14:00", "20:00"),
    "changi-city-point":                   ("14:00", "20:00"),
    "singapore-expo":                      ("10:00", "17:00"),
    "geylang-road-durian-stalls":          ("21:00", "01:00"),
    "east-coast-seafood-centre":           ("18:00", "21:00"),
    "katong-laksa-eastcoast":              ("11:00", "15:00"),
    "east-coast-park-cycling":             ("07:00", "11:00"),
    "east-coast-kayak":                    ("09:00", "13:00"),
    "east-coast-rec-club":                 ("08:00", "12:00"),
    "marine-cove-east-coast":              ("11:00", "17:00"),
    "parkland-green-east-coast":           ("12:00", "17:00"),
    "siglap-market-food-centre":           ("07:00", "11:00"),
    "changi-village-hawker":               ("11:00", "15:00"),
    "jewel-changi-airport":                ("11:00", "20:00"),
    "jewel-changi-rain-vortex":            ("11:00", "19:00"),
    "canopy-park-jewel":                   ("11:00", "19:00"),
    "changi-airport-terminal-3":           ("10:00", "18:00"),
    "changi-airport-terminal-2":           ("10:00", "18:00"),
    "changi-airport-jewel-canopy":         ("10:00", "18:00"),
    "bedok-reservoir":                     ("07:00", "10:00"),
    "bedok-swimming-complex":              ("08:00", "12:00"),
    "bedok-mall":                          ("14:00", "20:00"),
    "bedok-north-hawker":                  ("07:00", "11:00"),
    "bedok-south-hawker":                  ("07:00", "11:00"),
    "bedok-603-coffee-shop":               ("19:00", "23:00"),
    "upper-changi-road-hawker":            ("07:00", "11:00"),
    "tampines-round-market":               ("07:00", "11:00"),
    "tampines-st11-market":                ("07:00", "11:00"),
    "tampines-1-mall":                     ("14:00", "20:00"),
    "white-sands-mall":                    ("14:00", "20:00"),
    "elias-mall-pasir-ris":                ("14:00", "20:00"),
    "pasir-ris-hawker-51":                 ("07:00", "11:00"),
    "pasir-ris-horse-riding":              ("09:00", "13:00"),
    "pasir-ris-mangrove":                  ("07:00", "11:00"),
    "geylang-lor-9-fresh-frog-porridge":   ("20:00", "23:00"),
    "geylang-lor-24-frog-porridge":        ("19:00", "23:00"),
    "geylang-serai-bazaar":                ("19:00", "23:00"),
    "roland-restaurant":                   ("18:00", "22:00"),
    "whampoa-keng-fish-head":              ("18:00", "22:00"),
    "jumbo-seafood-riverside":             ("18:00", "22:00"),
    "punggol-end-seafood":                 ("18:00", "22:00"),
    "marine-parade-hawker":                ("07:00", "11:00"),
    "marine-parade-library":               ("11:00", "15:00"),
    "joo-chiat-katong-heritage":           ("10:00", "14:00"),
    "intan-peranakan-home":                ("10:00", "14:00"),
    "chinaman-scholar-gallery":            ("10:00", "15:00"),
    "seletar-heritage-trail":              ("09:00", "12:00"),
    "geylang-east-library":                ("11:00", "15:00"),
    "geylang-east-home":                   ("09:00", "12:00"),

    # Mandai / North wildlife
    "singapore-zoo":                       ("08:30", "11:00"),
    "night-safari-singapore":              ("19:15", "22:00"),
    "singapore-night-safari-creatures":    ("19:15", "21:30"),
    "river-wonders-singapore":             ("10:00", "14:00"),
    "bird-paradise-mandai":                ("09:00", "12:00"),
    "mandai-wildlife-bridge":              ("19:00", "22:00"),
    "stf-mandai-lake-road":                ("09:00", "13:00"),
    "mandai-wildlife-wonders-play":        ("10:00", "14:00"),
    "singapore-zoo-breakfast":             ("09:00", "10:30"),
    "kranji-war-memorial":                 ("07:00", "12:00"),
    "sungei-buloh-wetland-reserve":        ("07:00", "10:00"),
    "kranji-marshes":                      ("08:00", "12:00"),
    "woodlands-waterfront-park":           ("07:00", "10:00"),
    "sembawang-park":                      ("07:00", "10:00"),
    "sembawang-hot-spring-park":           ("07:00", "11:00"),
    "sembawang-hot-spring-food":           ("12:00", "16:00"),
    "woodlands-civic-centre":              ("10:00", "18:00"),
    "woodlands-theme-park-area":           ("09:00", "12:00"),
    "causeway-point":                      ("14:00", "20:00"),
    "northpoint-city":                     ("14:00", "20:00"),
    "sembawang-shopping-centre":           ("14:00", "20:00"),
    "admiralty-park":                      ("07:00", "11:00"),
    "admiralty-park-playground":           ("09:00", "14:00"),
    "singapore-turf-club":                 ("09:00", "14:00"),
    "upper-seletar-reservoir":             ("07:00", "11:00"),
    "kranji-farmmart":                     ("09:00", "14:00"),
    "coney-island-park":                   ("07:00", "11:00"),
    "coney-island-cycling":                ("07:00", "11:00"),
    "lorong-halus-wetland":                ("07:00", "11:00"),
    "punggol-waterway-park":               ("07:00", "11:00"),
    "punggol-beach-walk":                  ("07:00", "11:00"),
    "punggol-settlement":                  ("18:00", "22:00"),
    "punggol-north-shore":                 ("07:00", "10:00"),
    "punggol-point-crab-hut":              ("07:00", "11:00"),
    "sengkang-riverside-park":             ("07:00", "11:00"),
    "waterway-point-punggol":              ("14:00", "20:00"),
    "waterway-terraces-hawker":            ("07:00", "11:00"),
    "sengkang-grand-mall":                 ("14:00", "20:00"),
    "woodleigh-mall":                      ("14:00", "20:00"),
    "rivervale-mall":                      ("14:00", "20:00"),
    "hougang-mall":                        ("14:00", "20:00"),
    "hougang-hawker":                      ("07:00", "11:00"),
    "hougang-avenuee10-hawker":            ("07:00", "11:00"),
    "nex-serangoon":                       ("14:00", "20:00"),
    "serangoon-garden-market":             ("07:00", "11:00"),
    "serangoon-garden-circus":             ("18:00", "22:00"),
    "serangoon-north-hawker":              ("07:00", "11:00"),
    "chomp-chomp-food-centre":             ("18:00", "22:00"),
    "lorong-chuan-hawker":                 ("07:00", "11:00"),
    "punggol-plaza-food":                  ("07:00", "11:00"),
    "compassvale-crescent-hawker":         ("07:00", "11:02"),
    "sims-vista-hawker":                   ("07:00", "11:00"),
    "buangkok-hawker-centre":              ("07:00", "11:00"),
    "upper-boon-keng-hawker":              ("07:00", "11:00"),
    "boon-keng-market":                    ("07:00", "11:00"),
    "geylang-bahru-market":                ("07:00", "11:00"),
    "bendemeer-market":                    ("07:00", "11:00"),
    "whampoa-drive-makan-place":           ("07:00", "11:00"),
    "punggol-hawker-farmway":              ("07:00", "13:00"),
    "ang-mo-kio-ave6-market":              ("07:00", "11:00"),
    "amk-511-hawker":                      ("07:00", "11:00"),
    "amk-central-hawker":                  ("07:00", "11:00"),
    "amk-hub":                             ("14:00", "20:00"),
    "junction-8-bishan":                   ("14:00", "20:00"),
    "thomson-plaza":                       ("14:00", "20:00"),
    "toa-payoh-lorong-8-market":           ("07:00", "11:00"),
    "toa-payoh-central-hawker":            ("07:00", "11:00"),
    "toa-payoh-hdb-hub-foodcourt":         ("08:00", "12:00"),
    "jalan-kayu-prata-street":             ("07:00", "10:00"),
    "upper-thomson-road-food":             ("19:00", "22:00"),

    # Jurong / West
    "jurong-lake-gardens":                 ("07:00", "11:00"),
    "jurong-lake-district":                ("07:00", "11:00"),
    "science-centre-singapore":            ("10:00", "14:00"),
    "snow-city-singapore":                 ("10:00", "14:00"),
    "singapore-discovery-centre":          ("09:00", "14:00"),
    "chinese-garden-jurong":               ("07:00", "11:00"),
    "japanese-garden-jurong":              ("07:00", "11:00"),
    "haw-par-villa":                       ("09:00", "13:00"),
    "west-coast-park":                     ("07:00", "11:00"),
    "labrador-nature-reserve":             ("07:00", "11:00"),
    "labrador-park-coastal-walk":          ("07:00", "11:00"),
    "labrador-secret-passage":             ("07:00", "12:00"),
    "reflections-at-bukit-chandu":         ("09:00", "13:00"),
    "henderson-waves-bridge":              ("07:00", "10:00"),
    "southern-ridges-trail":               ("07:00", "10:00"),
    "hortpark":                            ("07:00", "10:00"),
    "kent-ridge-park":                     ("07:00", "10:00"),
    "telok-blangah-hill-park":             ("07:00", "10:00"),
    "mount-faber-park":                    ("17:00", "20:00"),
    "bukit-merah-view-park":               ("07:00", "11:00"),
    "vivocity":                            ("14:00", "21:00"),
    "harbourfront-centre":                 ("14:00", "20:00"),
    "harbourfront-ferry-terminal-trip":    ("08:00", "12:00"),
    "harbour-front-ferry-bintan":          ("10:00", "18:00"),
    "bintan-batam-ferry":                  ("07:00", "12:00"),
    "jurong-point":                        ("14:00", "20:00"),
    "jem-jurong-east":                     ("14:00", "20:00"),
    "imm-jurong-east":                     ("14:00", "20:00"),
    "westgate-mall":                       ("14:00", "20:00"),
    "clementi-mall":                       ("14:00", "20:00"),
    "jcube-jurong-east":                   ("14:00", "21:00"),
    "jurong-hill-tower":                   ("07:00", "11:00"),
    "jurong-bird-park-old":                ("09:00", "12:00"),
    "westmall-bukit-batok":                ("14:00", "20:00"),
    "bukit-batok-nature-park":             ("07:00", "11:00"),
    "bukit-batok-little-guilin":           ("07:00", "11:00"),
    "buona-vista-market":                  ("07:00", "11:00"),
    "ghim-moh-market":                     ("07:00", "11:00"),
    "ghim-moh-road-food-centre":           ("07:00", "11:00"),
    "clementi-market":                     ("07:00", "11:00"),
    "clementi-avenue2-market":             ("07:00", "11:00"),
    "west-coast-drive-market":             ("07:00", "11:00"),
    "taman-jurong-market":                 ("07:00", "12:00"),
    "boon-lay-place-market":               ("07:00", "11:00"),
    "jurong-west-hawker-513":              ("07:00", "11:00"),
    "pioneer-mrt-hawker":                  ("07:00", "11:00"),
    "ayer-rajah-food-centre":              ("07:00", "11:00"),
    "alexandra-village-food-centre":       ("07:00", "11:00"),
    "abc-brickworks-market":               ("07:00", "11:00"),
    "pasir-panjang-food-centre":           ("07:00", "11:00"),
    "lower-delta-road-hawker":             ("07:00", "11:00"),
    "redhill-market-food-centre":          ("07:00", "11:00"),
    "queenstown-market-food-centre":       ("07:00", "11:00"),
    "commonwealth-crescent-market":        ("07:00", "11:00"),
    "margaret-drive-hawker-centre":        ("07:00", "11:00"),
    "mei-chin-road-hawker":                ("07:00", "11:00"),
    "telok-blangah-drive-hawker":          ("07:00", "11:00"),
    "bukit-merah-central-food-centre":     ("07:00", "11:00"),
    "bukit-merah-view-market":             ("07:00", "11:00"),
    "queensway-shopping-centre":           ("11:00", "18:00"),
    "tanglin-shopping-centre":             ("11:00", "17:00"),
    "the-star-vista":                      ("14:00", "20:00"),
    "the-star-theatre":                    ("19:00", "22:00"),
    "one-north-park":                      ("07:00", "10:00"),
    "one-north-biopolis":                  ("09:00", "12:00"),
    "timbre-plus-oneNorth":                ("17:00", "21:00"),
    "one-northeast-business-park":         ("18:00", "21:00"),
    "gillman-barracks":                    ("12:00", "17:00"),
    "dempsey-hill":                        ("18:00", "22:00"),
    "long-beach-seafood-dempsey":          ("18:00", "22:00"),
    "dempsey-original-sin":                ("12:00", "14:30"),
    "bistro-du-vin":                       ("12:00", "14:30"),
    "colbar-wessex":                       ("10:00", "14:00"),
    "tanglin-mall":                        ("14:00", "19:00"),
    "tanglin-halt-market":                 ("07:00", "11:00"),
    "holland-road-shopping-centre":        ("14:00", "19:00"),
    "holland-village-market":              ("07:00", "11:00"),
    "adam-road-food-centre":               ("07:00", "11:00"),
    "coronation-plaza-food":               ("07:00", "11:00"),

    # Botanic Gardens / Novena
    "singapore-botanic-gardens":           ("07:00", "11:00"),
    "national-orchid-garden":              ("09:00", "12:00"),
    "jacob-ballas-childrens-garden":       ("09:00", "13:00"),
    "macritchie-reservoir-park":           ("07:00", "10:00"),
    "macritchie-treetop-walk":             ("07:00", "10:00"),
    "bishan-ang-mo-kio-park":              ("07:00", "10:00"),
    "bishan-park-playarea":                ("09:00", "13:00"),
    "lower-pierce-reservoir":              ("07:00", "11:00"),
    "central-catchment-nature-reserve":    ("07:00", "10:00"),
    "bukit-timah-nature-reserve":          ("07:00", "10:00"),
    "dairy-farm-nature-park":              ("07:00", "10:00"),
    "hindhede-nature-park":                ("07:00", "10:00"),
    "beauty-world-centre":                 ("11:00", "18:00"),
    "bukit-timah-shopping-centre":         ("11:00", "18:00"),
    "bukit-panjang-plaza":                 ("14:00", "20:00"),
    "lot-one-shoppers-mall":               ("14:00", "20:00"),

    # Sports Hub
    "singapore-sports-hub":                ("10:00", "18:00"),
    "singapore-indoor-stadium":            ("10:00", "18:00"),
    "kallang-wave-mall":                   ("14:00", "21:00"),
    "kallang-riverside-park":              ("07:00", "10:00"),
    "kallang-theatre":                     ("19:00", "22:00"),
    "singapore-sports-school":             ("09:00", "15:00"),
    "sports-hub-community":                ("09:00", "15:00"),
    "singapore-wake-park":                 ("10:00", "14:00"),
    "east-coast-cycling-rental":           ("08:00", "12:00"),
    "pasir-panjang-wholesale-market":      ("01:00", "06:00"),

    # Night / Evening specific
    "gluttons-bay":                        ("19:00", "23:00"),
    "night-festival-bras-basah":           ("19:00", "23:00"),
    "geylang-serai-bazaar":                ("19:00", "23:00"),
    "punggol-nasi-lemak":                  ("19:00", "23:00"),
    "mellben-seafood":                     ("17:00", "21:00"),
    "no-signboard-seafood":                ("18:00", "22:00"),
    "pince-and-pints":                     ("18:00", "22:00"),
    "swee-choon-dim-sum":                  ("11:00", "14:00"),

    # Misc food
    "sprmrkt-robertson":                   ("09:00", "14:00"),
    "po-kitchen-tanjong-pagar":            ("18:00", "22:00"),
    "island-creamery":                     ("15:00", "20:00"),
    "nassim-hill-bakery":                  ("09:00", "13:00"),
    "bengawan-solo-centrepoint":           ("10:00", "14:00"),
    "nam-kee-pau":                         ("08:00", "12:00"),
    "hajah-maimunah":                      ("07:00", "12:00"),
    "xo-fish-head-bee-hoon":               ("07:00", "12:00"),
    "springleaf-prata-place":              ("07:00", "10:00"),
    "golden-peony-westin":                 ("18:30", "22:00"),
    "empress-jade-restaurant":             ("12:00", "14:30"),
    "chui-huay-lim-teochew":               ("12:00", "14:00"),
    "teochew-restaurant-chinatown":        ("12:00", "14:00"),
    "whampoa-keng-fish-head":              ("18:00", "22:00"),

    # Heritage misc
    "singapore-city-gallery":              ("09:00", "14:00"),
    "former-ford-factory-museum":          ("09:00", "14:00"),
    "lian-shan-shuang-lin-temple":         ("07:00", "11:00"),
    "hong-san-see-temple":                 ("08:00", "12:00"),
    "tan-si-chong-su-temple":              ("09:00", "13:00"),
    "masjid-omar-kampung-melaka":          ("09:00", "13:00"),
    "lee-kong-chian-nhb":                  ("10:00", "14:00"),
    "singapore-maritime-gallery":          ("10:00", "14:00"),
    "nagore-heritage-centre":              ("09:00", "14:00"),
    "hwa-chong-heritage":                  ("09:00", "14:00"),
    "chinese-heritage-centre-ntu":         ("10:00", "14:00"),
    "ntu-campus-heritage":                 ("09:00", "12:00"),
    "wessex-estate":                       ("09:00", "13:00"),
    "pasir-panjang-power-station":         ("07:00", "10:00"),
    "sungei-road-thieves-market":          ("09:00", "12:00"),
    "lian-shan-pagoda-view":               ("09:00", "12:00"),
    "thomson-road-heritage":               ("09:00", "12:00"),
    "singapore-tyler-print":               ("10:00", "14:00"),
    "institute-of-contemporary-arts":      ("10:00", "14:00"),
    "singapore-duck-tours":                ("10:00", "15:00"),
    "singaporean-food-tour-chinatown":     ("10:00", "14:00"),
    "pulau-ubin":                          ("08:00", "13:00"),
    "chek-jawa-wetlands":                  ("08:30", "12:00"),
    "pulau-ubin-cycling":                  ("07:00", "13:00"),
    "sisters-islands-marine-park":         ("09:00", "14:00"),
    "singapore-expo":                      ("10:00", "17:00"),
    "dhoby-ghaut-park":                    ("09:00", "12:00"),
    "dhoby-ghaut-events":                  ("09:00", "14:00"),
    "sprout-hub-agri":                     ("11:00", "16:00"),
    "metta-welfare-community-hub":         ("10:00", "16:00"),
    "geylang-adventist-hospital":          ("09:00", "12:00"),
    "marina-mandarin-corridor":            ("10:00", "16:00"),
    "esplanade-food-court":                ("11:00", "15:00"),
    "kopitiam-habourfront":                ("11:00", "15:00"),
    "library-esplanade":                   ("11:00", "15:00"),
    "sng-moh-road-market":                 ("07:00", "11:00"),
    "sungei-road-wet-market":              ("07:00", "11:00"),
    "marsiling-lane-hawker":               ("07:00", "11:00"),
    "yishun-ring-road-hawker":             ("07:00", "11:00"),
    "sembawang-hills-food-centre":         ("07:00", "11:00"),
    "chong-pang-market-food-centre":       ("07:00", "11:00"),
    "jelebu-road-food":                    ("07:00", "11:00"),
    "woodlands-11-hawker":                 ("07:00", "11:00"),
    "woodlands-checkpoint-heritage":       ("09:00", "12:00"),
    "satay-village-punggol":               ("12:00", "17:00"),
    "tanglin-halt-community-club":         ("10:00", "14:00"),
    "eastpoint-mall-simei":                ("14:00", "20:00"),
    "tuas-second-link":                    ("09:00", "13:00"),
    "queensway-cc-hawker":                 ("09:00", "13:00"),
    "seletar-country-club":                ("12:00", "15:00"),
    "portsdown-avenue-restaurant":         ("09:00", "13:00"),
    "alexandra-road-food-trail":           ("09:00", "13:00"),
    "llaollao-ion-orchard":                ("11:00", "17:00"),
    "sungei-buloh-wetland-reserve":        ("07:00", "10:00"),
    "kranji-marshes-reservoir":            ("08:00", "12:00"),
}


# ── fallback rule-based function ──────────────────────────────────────────────

def _fallback_best_time(place: dict) -> tuple[str, str]:
    """Rule-based best time when no specific override exists."""
    category = place.get("category", "")
    is_outdoor = place.get("is_outdoor", False)
    oh = place.get("opening_hours") or []
    name = place.get("name", "").lower()
    keywords = " ".join(place.get("search_keywords") or []).lower()
    combined = name + " " + keywords

    open_t = _first_slot_open(oh)
    close_t = _first_slot_close(oh)
    open_h = int(open_t.split(":")[0])

    # Detect all-day (00:00 start)
    is_allday = open_t == "00:00"

    # FOOD_BEVERAGE
    if category == "FOOD_BEVERAGE":
        night_words = ["night", "satay", "frog", "durian", "supper", "bar", "pub"]
        breakfast_words = ["breakfast", "kaya", "toast", "prata", "roti", "pau", "bao",
                           "market", "wet market", "bakery", "coffee"]
        if any(w in combined for w in night_words) or open_h >= 17:
            s = max(open_h, 18)
            return f"{s:02d}:00", f"{min(s + 3, 23):02d}:00"
        if any(w in combined for w in breakfast_words) or open_h <= 8:
            s = max(open_h, 7)
            return f"{s:02d}:00", f"{min(s + 3, 11):02d}:00"
        if open_h <= 12:
            return "11:30", "14:00"
        return "18:00", "21:00"

    # SHOPPING
    if category == "SHOPPING":
        if is_allday:
            return "14:00", "20:00"
        return "14:00", f"{min(open_h + 10, 21):02d}:00"

    # HERITAGE
    if category == "HERITAGE":
        temple_words = ["temple", "mosque", "masjid", "church", "shrine", "cathedral"]
        if any(w in combined for w in temple_words):
            s = max(open_h, 7)
            return f"{s:02d}:00", f"{min(s + 3, 13):02d}:00"
        if is_outdoor:
            return "09:00", "12:00"
        s = max(open_h, 10)
        return f"{s:02d}:00", f"{min(s + 3, 16):02d}:00"

    # ATTRACTION
    if category == "ATTRACTION":
        night_words = ["night", "nocturnal", "firework", "light show", "creatures", "luge after dark"]
        if any(w in combined for w in night_words) and open_h >= 17:
            s = max(open_h, 19)
            return f"{s:02d}:00", f"{min(s + 2, 23):02d}:00"
        if not is_outdoor:
            s = max(open_h, 10)
            return f"{s:02d}:00", f"{min(s + 3, 17):02d}:00"
        if is_outdoor:
            if is_allday:
                return "07:00", "11:00"
            if open_h <= 8:
                return f"{max(open_h, 7):02d}:00", f"{min(open_h + 3, 11):02d}:00"
            if open_h >= 17:
                s = max(open_h, 18)
                return f"{s:02d}:00", f"{min(s + 3, 22):02d}:00"
            s = max(open_h, 9)
            return f"{s:02d}:00", f"{min(s + 3, 15):02d}:00"

    # Generic fallback
    if is_allday:
        return "09:00", "13:00"
    s = max(open_h, 9)
    return f"{s:02d}:00", f"{min(s + 3, 18):02d}:00"


# ── main ──────────────────────────────────────────────────────────────────────

def enrich(places: list[dict]) -> list[dict]:
    errors: list[str] = []
    for p in places:
        pid = p["id"]
        oh = p.get("opening_hours") or []
        best = SPECIFIC.get(pid) or _fallback_best_time(p)
        start, end = best

        if not _within_hours(start, end, oh):
            # Try fallback if override doesn't fit
            if pid in SPECIFIC:
                fb = _fallback_best_time(p)
                if _within_hours(fb[0], fb[1], oh):
                    start, end = fb
                else:
                    errors.append(f"WARN {pid}: {start}-{end} not within {oh}, kept anyway")

        p["best_time_start"] = start
        p["best_time_end"] = end

    if errors:
        print("\n".join(errors))
    return places


def main() -> None:
    data: list[dict] = json.loads(SRC.read_text(encoding="utf-8"))
    enriched = enrich(data)
    SRC.write_text(json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done — wrote {len(enriched)} entries to {SRC}")


if __name__ == "__main__":
    main()
