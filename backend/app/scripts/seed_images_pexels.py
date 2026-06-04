#!/usr/bin/env python3
"""
Seed script: fetches Pexels landscape image URLs for all 499 Singapore POIs.

Overwrites ALL image_url values (existing Wikipedia/Unsplash URLs are broken).
Saves after every POI — safe to interrupt and resume with --resume flag.

Run from backend/:
    cd backend && python -m app.scripts.seed_images_pexels
    cd backend && python -m app.scripts.seed_images_pexels --resume        # skip already-set
    cd backend && python -m app.scripts.seed_images_pexels --limit 20      # first 20 only
    cd backend && python -m app.scripts.seed_images_pexels --dry-run       # no writes

Rate: Pexels free tier = 200 req/hr → 18 s between requests → ~150 min for 499 POIs.
After this script, sync to Supabase:
    cd backend && python -m app.scripts.seed_db
"""

import argparse
import json
import logging
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# ── Path resolution ────────────────────────────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parents[2]
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
        "  cd backend && python -m app.scripts.seed_images_pexels"
    )

# ── Constants ─────────────────────────────────────────────────────────────────

_PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search"
_PEXELS_DELAY      = 18.5   # seconds — 200 req/hr budget with small buffer

# ── Query overrides ───────────────────────────────────────────────────────────
# For POIs whose names are ambiguous, contain special characters, or need extra
# context to get a relevant photo. All other POIs default to "{name} Singapore".

_QUERY_OVERRIDES: dict[str, str] = {
    # ── ATTRACTION ──────────────────────────────────────────────────────────
    "marina-bay-sands-skypark":          "Marina Bay Sands SkyPark observation deck Singapore",
    "esplanade-theatres-on-the-bay":     "Esplanade Theatres Bay Singapore durian building",
    "gardens-by-the-bay-supertree-grove":"Gardens by the Bay Supertree Grove Singapore night lights",
    "gardens-by-the-bay-flower-dome":    "Gardens by the Bay Flower Dome conservatory Singapore",
    "gardens-by-the-bay-cloud-forest":   "Gardens by the Bay Cloud Forest waterfall Singapore",
    "gardens-by-the-bay-ocbc-skyway":    "OCBC Skyway Gardens by the Bay aerial walkway Singapore",
    "suntec-fountain-of-wealth":         "Suntec City Fountain of Wealth Singapore",
    "chinatown-street-market":           "Chinatown Pagoda Street market Singapore colorful",
    "ann-siang-hill":                    "Ann Siang Hill Club Street Singapore shophouses",
    "haji-lane-arab-street":             "Haji Lane Arab Street Singapore colorful murals",
    "national-library-singapore":        "National Library Singapore Lee Kong Chian modern",
    "sea-aquarium-sentosa":              "Singapore SEA Aquarium Sentosa underwater",
    "wings-of-time-sentosa":             "Wings of Time Sentosa Singapore laser water show night",
    "ifly-singapore-sentosa":            "indoor skydiving Sentosa Singapore",
    "trick-eye-museum-sentosa":          "Trick Eye Museum optical illusion Singapore",
    "sentosa-cable-car":                 "Sentosa cable car Singapore Mount Faber gondola",
    "resorts-world-sentosa-casino":      "Resorts World Sentosa Singapore casino hotel",
    "sentosa-boardwalk":                 "Sentosa boardwalk Singapore sea walkway",
    "skyline-luge-sentosa":              "Skyline Luge Sentosa cart track Singapore",
    "art-science-museum-future-world":   "ArtScience Museum Future World teamLab Singapore",
    "henderson-waves-bridge":            "Henderson Waves bridge Singapore forest walk",
    "southern-ridges-trail":             "Southern Ridges trail Singapore forest walk",
    "macritchie-treetop-walk":           "MacRitchie TreeTop Walk suspension bridge Singapore",
    "singapore-sports-hub":              "Singapore Sports Hub National Stadium architecture",
    "coney-island-park":                 "Coney Island Pulau Serangoon Singapore nature park",
    "chek-jawa-wetlands":                "Chek Jawa wetlands Pulau Ubin Singapore mangrove",
    "sisters-islands-marine-park":       "Sisters Islands marine park Singapore coral reef",
    "palawan-beach-southernmost-point":  "Palawan Beach southernmost point Asia Sentosa",
    "the-promontory-mbay":              "Marina Bay promontory Singapore waterfront events",
    "esplanade-outdoor-theatre":         "Esplanade outdoor theatre Singapore waterfront",
    "jewel-changi-rain-vortex":          "Jewel Changi Airport Rain Vortex indoor waterfall Singapore",
    "canopy-park-jewel":                 "Canopy Park Jewel Changi Airport Singapore sky garden",
    "changi-airport-terminal-3":         "Changi Airport Terminal 3 Singapore butterfly garden",
    "changi-airport-terminal-2":         "Changi Airport Terminal 2 Singapore sunflower garden",
    "changi-airport-jewel-canopy":       "Changi Airport Terminal 1 Singapore heritage",
    "bukit-batok-little-guilin":         "Bukit Batok Little Guilin quarry lake Singapore",
    "bukit-merah-view-park":             "Mount Faber Singapore cable car viewpoint",
    "mandai-wildlife-bridge":            "Mandai Wildlife Bridge Singapore green eco crossing",
    "mandai-wildlife-wonders-play":      "Mandai Wildlife Reserve Singapore dinosaurs show",
    "pulau-ubin":                        "Pulau Ubin Singapore island village cycling",
    "pulau-ubin-cycling":                "Pulau Ubin cycling trail Singapore island",
    "sungei-buloh-wetland-reserve":      "Sungei Buloh Wetland Reserve Singapore migratory birds",
    "lorong-halus-wetland":              "Lorong Halus Wetland Singapore boardwalk",
    "macritchie-reservoir-park":         "MacRitchie Reservoir Park Singapore forest trail",
    "central-catchment-nature-reserve":  "Central Catchment Nature Reserve Singapore forest",
    "singapore-botanic-gardens":         "Singapore Botanic Gardens UNESCO heritage",
    "national-orchid-garden":            "National Orchid Garden Singapore Botanic Gardens",
    "jacob-ballas-childrens-garden":     "Jacob Ballas Children Garden Singapore Botanic",
    "chinese-garden-jurong":             "Chinese Garden Jurong Singapore pagoda lake",
    "japanese-garden-jurong":            "Japanese Garden Jurong Singapore stone lantern",
    "jurong-lake-gardens":               "Jurong Lake Gardens Singapore nature park",
    "hortpark":                          "HortPark Singapore garden theme park",
    "one-north-park":                    "one-north Park Singapore high-tech campus green",
    "one-north-biopolis":                "Biopolis one-north Singapore science hub architecture",
    "sprout-hub-agri":                   "urban farm Singapore rooftop garden",
    "orchard-road-belt":                 "Orchard Road Singapore shopping street decorated",
    "jewel-changi-airport":              "Jewel Changi Airport Singapore atrium waterfall",
    "singapore-expo":                    "Singapore EXPO Convention Exhibition Centre",
    "singapore-wake-park":               "Singapore Wake Park cable wakeboarding Punggol",
    "pasir-ris-horse-riding":            "horse riding Singapore Gallop Stable",
    "jurong-lake-district":              "Jurong Lake District Singapore urban development",
    "singapore-s-e-a-aquarium-new":      "Singapore Oceanarium Resorts World Sentosa aquarium",
    "institute-of-contemporary-arts":    "LASALLE College Arts Singapore contemporary gallery",
    "singapore-cable-car-harbourfront":  "Singapore cable car HarbourFront station gondola",
    "gillman-barracks":                  "Gillman Barracks Singapore contemporary art gallery",
    "night-festival-bras-basah":         "Singapore Night Festival Bras Basah light projection",
    "kranji-marshes-reservoir":          "Kranji Marshes Singapore birdwatching wetland",
    "funan-rooftop-farm":                "Funan mall Singapore rooftop urban farm climbing wall",
    "marina-bay-food-festival":          "Marina Bay Waterfront Promenade Singapore outdoor event",
    "sentosa-express":                   "Sentosa Express monorail Singapore cable car",
    "east-coast-cycling-rental":         "East Coast Park cycling Singapore beach bicycle",
    "lower-pierce-reservoir":            "Lower Pierce Reservoir Singapore secondary forest",
    "punggol-north-shore":               "Punggol Northshore Singapore waterfront HDB",
    "harbourfront-ferry-terminal-trip":  "HarbourFront Ferry Terminal Singapore Batam Bintan",
    "marina-bay-sands-event-plaza":      "Marina Bay Sands outdoor event plaza Singapore",
    "the-star-theatre":                  "The Star Theatre Singapore Buona Vista venue",
    "admiralty-park-playground":         "Admiralty Park mega playground Singapore",
    "tiong-bahru-yong-siak-street":      "Yong Siak Street Tiong Bahru Singapore cafe",
    "singapore-duck-tours":              "Singapore DUCKtours amphibious vehicle Marina",
    "east-coast-kayak":                  "East Coast Park kayaking Singapore sea sports",
    "dhoby-ghaut-park":                  "Dhoby Ghaut Green Singapore MRT park",
    "singaporean-food-tour-chinatown":   "Chinatown Singapore food tour heritage walk",
    "singapore-tyler-print":             "Singapore Tyler Print Institute art print workshop",
    "marine-parade-library":             "Marine Parade Library Singapore community",
    "marina-mandarin-corridor":          "Marina Mandarin Singapore atrium hotel interior",
    "sports-hub-community":              "ActiveSG sports centre Singapore swimming pool",
    "geylang-east-library":              "Geylang East Library Singapore neighbourhood",
    "library-esplanade":                 "Esplanade Library Singapore arts books",
    "kallang-theatre":                   "Kallang Theatre Singapore performing arts",
    "tuas-second-link":                  "Tuas Second Link Singapore Malaysia bridge",
    "bintan-batam-ferry":                "Tanah Merah Ferry Terminal Singapore Bintan",
    "night-safari-singapore":            "Night Safari Singapore animals nocturnal tram",
    "singapore-night-safari-creatures":  "Night Safari Creatures of the Night show Singapore",
    "sentosa-golfclub":                  "Sentosa Golf Club Serapong Course Singapore sea view",
    "upper-seletar-reservoir":           "Seletar Reservoir Park Singapore nature tranquil",
    "jurong-hill-tower":                 "Jurong Hill Singapore panoramic view tower",
    "punggol-point-crab-hut":            "Punggol Point Park Singapore coastline",
    "east-coast-rec-club":               "East Coast Recreation Centre Singapore park",
    "woodlands-civic-centre":            "Causeway Point Woodlands Singapore mall",
    "metta-welfare-community-hub":       "Tiong Bahru Community Centre Singapore",
    "bedok-swimming-complex":            "Bedok Swimming Complex Singapore Olympic pool",
    "stf-mandai-lake-road":              "Mandai Wildlife Reserve Singapore conservation campus",
    "bedok-reservoir":                   "Bedok Reservoir Park Singapore jogging water",
    "punggol-beach-walk":                "Punggol Beach Singapore coastal walk sunset",
    "east-coast-park-cycling":           "East Coast Park Singapore cycling beach recreation",
    "singapore-indoor-stadium":          "Singapore Indoor Stadium Kallang sports concert",
    "bishan-ang-mo-kio-park":            "Bishan Ang Mo Kio Park Singapore river nature",
    "punggol-waterway-park":             "Punggol Waterway Park Singapore canal boardwalk",
    "sengkang-riverside-park":           "Sengkang Riverside Park Singapore riverside walk",
    "sembawang-park":                    "Sembawang Park Singapore beachfront park",
    "woodlands-waterfront-park":         "Woodlands Waterfront Park Singapore Johor Strait view",
    "sembawang-hot-spring-park":         "Sembawang Hot Spring Park Singapore natural spring",
    "labrador-nature-reserve":           "Labrador Nature Reserve Singapore coastal fort",
    "labrador-park-coastal-walk":        "Labrador Park Singapore coastal walk WWII",
    "labrador-secret-passage":           "Labrador Secret Passage WWII tunnels Singapore",
    "west-coast-park":                   "West Coast Park Singapore family recreational",
    "kent-ridge-park":                   "Kent Ridge Park Singapore forest canopy walk",
    "telok-blangah-hill-park":           "Telok Blangah Hill Park Singapore hilltop forest",
    "mount-faber-park":                  "Mount Faber Park Singapore cable car hillside",
    "bukit-timah-nature-reserve":        "Bukit Timah Nature Reserve Singapore primary forest hill",
    "dairy-farm-nature-park":            "Dairy Farm Nature Park Singapore old quarry",
    "hindhede-nature-park":              "Hindhede Nature Park Singapore Bukit Timah",
    "bukit-batok-nature-park":           "Bukit Batok Nature Park Singapore hilltop",
    "admiralty-park":                    "Admiralty Park Singapore mangrove nature",
    "pasir-ris-mangrove":                "Pasir Ris Park mangrove boardwalk Singapore",
    "pasir-ris-park":                    "Pasir Ris Park Singapore beach playground",
    "changi-beach-park":                 "Changi Beach Park Singapore sea view rustic",
    "east-coast-park":                   "East Coast Park Singapore seaside parkway cyclists",
    "bird-paradise-mandai":              "Bird Paradise Mandai Singapore colourful parrots",
    "river-wonders-singapore":           "River Wonders Singapore Amazon giant panda",
    "snow-city-singapore":               "Snow City Singapore indoor snow play",
    "singapore-discovery-centre":        "Singapore Discovery Centre Jurong military interactive",
    "haw-par-villa":                     "Haw Par Villa Singapore mythological statues colourful",
    "science-centre-singapore":          "Science Centre Singapore exhibition interactive",
    "marina-bay-golf-course":            "Marina Bay Golf Course Singapore night driving range",
    "bishan-park-playarea":              "Bishan Ang Mo Kio Park Singapore community play",
    "punggol-hawker-farmway":            "Kranji farm Singapore countryside",
    "woodlands-theme-park-area":         "Woodlands Town Garden Singapore green space",
    "queensway-cc-hawker":               "Queenstown Singapore community space",

    # ── HERITAGE ────────────────────────────────────────────────────────────
    "victoria-theatre-concert-hall":     "Victoria Theatre Concert Hall Singapore colonial waterfront",
    "the-arts-house":                    "Arts House Old Parliament House Singapore heritage",
    "fullerton-hotel-singapore":         "Fullerton Hotel Singapore neoclassical waterfront",
    "old-hill-street-police-station":    "Old Hill Street Police Station Singapore colorful windows",
    "battlebox-fort-canning":            "Fort Canning Battlebox WWII underground Singapore",
    "battle-box-expanded":               "Battle Box WWII Command Centre Fort Canning Singapore",
    "nagore-durgha-shrine":              "Nagore Dargah Singapore heritage mosque Telok Ayer",
    "masjid-jamae-chulia":               "Masjid Jamae Chulia Singapore Chinatown mosque",
    "thian-hock-keng-temple":            "Thian Hock Keng Temple Singapore Hokkien Taoist oldest",
    "chinatown-heritage-centre":         "Chinatown Heritage Centre Singapore shophouse Peranakan",
    "tiong-bahru-estate-walk":           "Tiong Bahru estate Singapore art deco heritage walk",
    "baba-house":                        "Baba House Singapore Peranakan terrace heritage",
    "sultan-mosque":                     "Sultan Mosque Singapore Kampong Glam golden dome",
    "kampong-glam-heritage-trail":       "Kampong Glam Singapore heritage trail Malay Arab",
    "sri-veeramakaliamman-temple":       "Sri Veeramakaliamman Temple Little India Singapore colourful",
    "sri-srinivasa-perumal-temple":      "Sri Srinivasa Perumal Temple Singapore Hindu gopuram",
    "sakya-muni-buddha-gaya-temple":     "Sakya Muni Buddha Gaya Temple 1000 lights Singapore",
    "kwan-im-thong-hood-cho-temple":     "Kwan Im Temple Singapore Waterloo Street Goddess of Mercy",
    "armenian-church-singapore":         "Armenian Church St Gregory Singapore oldest Christian",
    "joo-chiat-katong-heritage":         "Joo Chiat Katong Peranakan shophouses Singapore colourful",
    "reflections-at-bukit-chandu":       "Reflections Bukit Chandu Singapore WWII Malay Regiment",
    "kranji-war-memorial":               "Kranji War Memorial Singapore Commonwealth cemetery",
    "sun-yat-sen-memorial-hall":         "Sun Yat Sen Memorial Hall Singapore heritage villa",
    "former-ford-factory-museum":        "Former Ford Factory Singapore WWII surrender museum",
    "lian-shan-shuang-lin-temple":       "Lian Shan Shuang Lin Temple Singapore Buddhist pagoda",
    "nus-baba-house":                    "NUS Baba House Neil Road Singapore Peranakan heritage",
    "intan-peranakan-home":              "Peranakan home museum Singapore antique collection",
    "seletar-heritage-trail":            "Seletar Aerospace Singapore colonial black-and-white bungalow",
    "kampung-gelam-malay-heritage":      "Malay Heritage Centre Istana Kampong Glam Singapore",
    "fuk-tak-chi-museum":                "Fuk Tak Chi Museum Far East Square Singapore Chinese temple",
    "hwa-chong-heritage":                "Hwa Chong Mansion Singapore heritage colonial building",
    "pasir-panjang-power-station":       "Pasir Panjang Power District Singapore heritage industrial",
    "maritime-experiential-museum":      "Maritime Experiential Museum Resorts World Sentosa ship",
    "woodlands-checkpoint-heritage":     "Singapore Johor Causeway viewpoint Malaysia bridge",
    "sungei-road-thieves-market":        "Sungei Road flea market Singapore historical",
    "telok-ayer-street-heritage-walk":   "Telok Ayer Street Singapore heritage trail Chinatown",
    "eu-yan-sang-heritage":              "Eu Yan Sang heritage building Singapore traditional Chinese medicine",
    "masjid-hajjah-fatimah":             "Masjid Hajjah Fatimah Singapore leaning minaret mosque",
    "fort-siloso":                       "Fort Siloso Sentosa Singapore WWII coastal guns",
    "images-of-singapore-live":          "Images of Singapore LIVE Sentosa history show",
    "lee-kong-chian-nhb":                "Lee Kong Chian Natural History Museum NUS Singapore specimens",
    "wessex-estate":                     "Wessex Estate Colbar Singapore colonial black-white bungalow",
    "thomson-road-heritage":             "Thomson Road Singapore colonial heritage medical",
    "goodwood-park-hotel":               "Goodwood Park Hotel Singapore heritage colonial tower",
    "ntu-campus-heritage":               "NTU Heritage Campus Yunnan Garden Singapore",
    "chinese-heritage-centre-ntu":       "Chinese Heritage Centre NTU Singapore",
    "lian-shan-pagoda-view":             "Toa Payoh Dragon Playground Singapore heritage",
    "keramat-iskandar-shah":             "Keramat Iskandar Shah Fort Canning Singapore Malay",
    "nagore-heritage-centre":            "Nagore Dargah Indian Muslim Heritage Centre Singapore",
    "malay-heritage-trail-geylang":      "Geylang Malay heritage walk Singapore kampung",
    "singaporeriver-heritage-walk":      "Singapore River heritage walk Clarke Quay Boat Quay",
    "singapore-city-gallery":            "Singapore City Gallery urban planning model",
    "singapore-maritime-gallery":        "Singapore Maritime Gallery port ships harbour",
    "tanglin-halt-community-club":       "Tanglin Halt Singapore HDB heritage facade",
    "hong-san-see-temple":               "Hong San See Temple Singapore Hokkien heritage",
    "tan-si-chong-su-temple":            "Tan Si Chong Su Temple Singapore clan association",
    "masjid-omar-kampung-melaka":        "Masjid Omar Kampong Melaka Singapore oldest mosque",
    "peranakan-museum":                  "Peranakan Museum Singapore Baba Nyonya heritage",
    "national-museum-of-singapore":      "National Museum of Singapore colonial rotunda heritage",
    "singapore-art-museum":              "Singapore Art Museum SAM contemporary gallery",
    "national-gallery-singapore":        "National Gallery Singapore Supreme Court City Hall",
    "asian-civilisations-museum":        "Asian Civilisations Museum Singapore Empress Place",
    "cavenagh-bridge":                   "Cavenagh Bridge Singapore oldest suspension bridge",
    "raffles-hotel-singapore":           "Raffles Hotel Singapore colonial heritage iconic",
    "raffles-landing-site":              "Raffles Landing Site Singapore Boat Quay statue",
    "cathedral-of-the-good-shepherd":    "Cathedral of the Good Shepherd Singapore Gothic",
    "st-andrews-cathedral":              "St Andrew's Cathedral Singapore Gothic colonial white",
    "chijmes":                           "CHIJMES Singapore chapel courtyard heritage dining",
    "the-istana-singapore":              "Istana Singapore presidential palace colonial grounds",
    "sri-mariamman-temple":              "Sri Mariamman Temple Singapore oldest Hindu gopuram",
    "buddha-tooth-relic-temple":         "Buddha Tooth Relic Temple Museum Singapore Chinatown",
    "indian-heritage-centre":            "Indian Heritage Centre Singapore Little India cultural",
    "chinaman-scholar-gallery":          "Chinaman Scholar Gallery Geylang Singapore antique",
    "cathedral-of-good-shepherd-heritage":"Cathedral Good Shepherd Singapore heritage gallery",

    # ── FOOD_BEVERAGE ────────────────────────────────────────────────────────
    "gardens-by-the-bay-satay-by-the-bay": "Satay by the Bay Singapore hawker outdoor garden",
    "lau-pa-sat-festival-market":          "Lau Pa Sat festival market Singapore Victorian cast iron",
    "lau-pa-sat-satay-street":             "Lau Pa Sat satay street Singapore hawker stalls night",
    "rasapura-masters-marina-bay-sands":   "Rasapura Masters food court Marina Bay Sands Singapore",
    "ce-la-vi-sky-bar":                    "Ce La Vi rooftop bar Marina Bay Singapore skyline",
    "newton-food-centre":                  "Newton Food Centre Singapore hawker night stalls",
    "maxwell-food-centre":                 "Maxwell Food Centre Singapore hawker Tian Tian chicken rice",
    "tian-tian-chicken-rice-maxwell":      "Hainanese chicken rice Singapore hawker stall",
    "geylang-road-durian-stalls":          "Geylang durian Singapore thorn fruit stalls night",
    "katong-laksa-eastcoast":              "Katong laksa Singapore Peranakan spicy coconut noodle",
    "geylang-lor-9-fresh-frog-porridge":   "frog porridge Singapore Geylang hawker late night",
    "geylang-lor-24-frog-porridge":        "frog porridge Geylang Singapore hawker",
    "springleaf-prata-place":              "roti prata Singapore Indian flatbread hawker",
    "jalan-kayu-prata-street":             "Jalan Kayu prata Singapore roti Indian breakfast",
    "raffles-hotel-long-bar":              "Raffles Hotel Long Bar Singapore Sling cocktail colonial",
    "atlas-bar-singapore":                 "Atlas Bar Singapore art deco cocktail grand hotel lobby",
    "1-altitude-gallery":                  "1-Altitude rooftop bar Singapore skyline night view",
    "swisshotel-bar":                      "New Asia Bar Swissotel Stamford Singapore rooftop panorama",
    "la-terraza-ibis":                     "Level 33 craft brewery Marina Bay Singapore rooftop beer",
    "punggol-settlement":                  "Punggol Settlement Singapore waterfront dining restaurants",
    "kranji-farmmart":                     "Kranji Countryside Farmers Market Singapore organic farm",
    "colbar-wessex":                       "Colbar Wessex Estate Singapore colonial outdoor cafe",
    "singapore-zoo-breakfast":             "Singapore Zoo Jungle Breakfast wildlife animals morning",
    "one-fullerton-restaurants":           "One Fullerton Singapore waterfront restaurants Marina Bay",
    "geylang-serai-bazaar":                "Geylang Serai Ramadan Bazaar Singapore Malay festive food",
    "tiong-bahru-bakery":                  "Tiong Bahru Bakery Singapore croissant artisan bread",
    "song-fa-bak-kut-teh":                 "Bak Kut Teh Singapore pork rib herb soup hawker",
    "ya-kun-kaya-toast":                   "Ya Kun Kaya Toast Singapore breakfast coffee kaya",
    "ya-kun-kaya-toast-fep":               "Ya Kun Kaya Toast Singapore kaya butter toast coffee",
    "tiong-bahru-social-club":             "40 Hands Coffee Tiong Bahru Singapore specialty coffee",
    "keong-saik-bakery":                   "Keong Saik Bakery Singapore artisan bread Tanjong Pagar",
    "tiong-bahru-mian-jia":                "noodles Singapore hawker market food centre",
    "sprmrkt-robertson":                   "Robertson Walk Singapore cafe waterfront dining",
    "po-kitchen-tanjong-pagar":            "Neon Pigeon Singapore izakaya Tanjong Pagar",
    "empress-jade-restaurant":             "Jade restaurant Fullerton Hotel Singapore Chinese fine dining",
    "golden-peony-westin":                 "Golden Peony Conrad Singapore Chinese fine dining",
    "imperial-treasure-nan-bei":           "Imperial Treasure Chinese restaurant Orchard Singapore",
    "crystal-jade-la-mian":                "Crystal Jade Orchard Singapore dim sum xiao long bao",
    "paradise-dynasty-ifc":                "Paradise Dynasty ION Orchard Singapore colourful xiao long bao",
    "nam-kee-pau":                         "Nam Kee pau Singapore steamed bun hawker",
    "whampoa-keng-fish-head":              "fish head steamboat Singapore hawker seafood",
    "swee-choon-dim-sum":                  "Swee Choon dim sum Singapore late night hawker",
    "jumbo-seafood-clarke-quay":           "Jumbo Seafood Singapore chilli crab Clarke Quay",
    "jumbo-seafood-riverside":             "Jumbo Seafood Singapore chilli crab seafood restaurant",
    "punggol-end-seafood":                 "seafood Singapore restaurant riverside",
    "no-signboard-seafood":                "No Signboard Seafood Esplanade Singapore white pepper crab",
    "long-beach-seafood-dempsey":          "Long Beach Seafood Dempsey Singapore black pepper crab",
    "mellben-seafood":                     "Mellben Seafood Ang Mo Kio Singapore crab bee hoon",
    "pince-and-pints":                     "Pince and Pints Singapore lobster Duxton Hill",
    "gluttons-bay":                        "Gluttons Bay Esplanade Singapore hawker outdoor waterfront",
    "roland-restaurant":                   "Roland Restaurant Singapore chilli crab Telok Blangah",
    "ce-la-vi-sky-bar":                    "Ce La Vi Singapore rooftop infinity pool bar Marina Bay",
    "tanjong-beach-club":                  "Tanjong Beach Club Sentosa Singapore beach bar pool",
    "the-knolls-capella":                  "The Knolls Capella Singapore Sentosa luxury resort dining",
    "boat-quay":                           "Boat Quay Singapore riverside restaurants night",
    "robertson-quay":                      "Robertson Quay Singapore riverside dining bars night",
    "clarke-quay":                         "Clarke Quay Singapore riverside bar nightlife colourful",
    "dempsey-hill":                        "Dempsey Hill Singapore colonial bungalow dining",
    "east-coast-seafood-centre":           "East Coast Seafood Centre Singapore chilli crab sea",
    "east-coast-lagoon-food-village":      "East Coast Lagoon Food Village Singapore hawker beach",
    "chomp-chomp-food-centre":             "Chomp Chomp Food Centre Singapore barbecue hawker night",
    "old-airport-road-food-centre":        "Old Airport Road Food Centre Singapore famous hawker",
    "geylang-serai-market":                "Geylang Serai Market Singapore Malay food centre",
    "bedok-85-fengshan-market":            "Bedok 85 Fengshan Market Singapore hawker famous BBQ",
    "upper-thomson-road-food":             "Upper Thomson Road Singapore cafe food prata",
    "tiong-bahru-market":                  "Tiong Bahru Market Singapore hawker kopitiam",
    "tekka-market":                        "Tekka Market Zhu Jiao Singapore Little India hawker",
    "kopitiam-habourfront":                "Kopitiam VivoCity Singapore food court harbour view",
    "esplanade-food-court":                "Esplanade Mall Food Court Singapore arts waterfront",
    "marine-cove-east-coast":              "Marine Cove East Coast Park Singapore family dining",
    "parkland-green-east-coast":           "Parkland Green East Coast Park Singapore waterfront cafe",
    "island-creamery":                     "Island Creamery Singapore local ice cream durian",
    "nassim-hill-bakery":                  "Nassim Hill Bakery Singapore upscale neighbourhood cafe",
    "timbre-plus-oneNorth":                "Timbre+ one-north Singapore outdoor hawker music",
    "seletar-country-club":                "Seletar Country Club Singapore colonial golf club dining",
    "sembawang-hot-spring-food":           "Bottle Tree Park Sembawang Singapore outdoor nature cafe",
    "tang-tea-house":                      "Tang Tea House Chinatown Singapore Chinese tea dim sum",
    "bengawan-solo-centrepoint":           "Bengawan Solo Singapore kueh Peranakan cake pastry",
    "lim-chee-guan":                       "Lim Chee Guan Bak Kwa Singapore Chinatown barbecue pork",
    "bistro-du-vin":                       "Bistro Du Vin Singapore French wine bistro Orchard",
    "portsdown-avenue-restaurant":         "Rider's Cafe Bukit Timah Singapore countryside cafe",
    "xo-fish-head-bee-hoon":               "fish head bee hoon Singapore hawker noodle soup",
    "hajah-maimunah":                      "Hajah Maimunah Singapore Malay nasi padang restaurant",
    "dempsey-original-sin":                "Original Sin Dempsey Hill Singapore Mediterranean vegetarian",
    "harbour-front-ferry-bintan":          "Resorts World Sentosa Singapore casino membership resort",
    "china-square-food-centre":            "China Square Food Centre Singapore CBD hawker",
    "whampoa-drive-makan-place":           "Whampoa Drive Makan Place Singapore local hawker",
    "din-tai-fung-paragon":                "Din Tai Fung Singapore xiao long bao dumplings",
    "food-republic-ion-orchard":           "Food Republic ION Orchard Singapore food court",
    "teochew-restaurant-chinatown":        "Chui Huay Lim Teochew Singapore seafood claypot",
    "one-northeast-business-park":         "Rochester Park one-north Singapore lifestyle dining colonial",
    "bedok-603-coffee-shop":               "Singapore coffeeshop satay barbecue hawker",
    "serangoon-garden-circus":             "Serangoon Garden Way Singapore eateries neighbourhood",

    # ── SHOPPING ────────────────────────────────────────────────────────────
    "shoppes-at-marina-bay-sands":         "Shoppes Marina Bay Sands luxury mall Singapore canal",
    "ngee-ann-city-takashimaya":           "Ngee Ann City Takashimaya Orchard Road Singapore mall",
    "313-somerset":                        "313 Somerset Orchard Road Singapore mall entrance",
    "peoples-park-complex":                "People's Park Complex Chinatown Singapore",
    "peoples-park-centre":                 "People's Park Centre Chinatown Singapore",
    "golden-mile-complex":                 "Golden Mile Complex Beach Road Singapore Brutalist architecture",
    "sim-lim-square":                      "Sim Lim Square electronics Singapore technology gadgets",
    "sim-lim-tower":                       "Sim Lim Tower Singapore electronics wholesale",
    "imm-jurong-east":                     "IMM Jurong East Singapore outlet shopping mall",
    "jem-jurong-east":                     "JEM Jurong East Mall Singapore shopping",
    "suntec-city-mall":                    "Suntec City Singapore convention mall Fountain of Wealth",
    "suntec-city-north-wing":              "Suntec City Singapore north east wing shopping",
    "clarke-quay-centralMall":             "Clarke Quay Central Singapore mall riverside",
    "jcube-jurong-east":                   "JCube Jurong East Singapore ice rink mall",
    "dfs-galleria-scotts":                 "DFS Galleria Singapore luxury duty-free Scotts Walk",
    "ion-orchard":                         "ION Orchard Singapore luxury mall underground Orchard Road",
    "vivocity":                            "VivoCity Singapore largest mall HarbourFront rooftop",
    "jewel-changi-airport":                "Jewel Changi Airport Singapore mall rain vortex atrium",
    "funan-mall":                          "Funan Singapore tech creative mall climbing wall",
    "bugis-junction":                      "Bugis Junction Singapore glass-roofed mall heritage",
    "mustafa-centre":                      "Mustafa Centre Little India Singapore 24-hour shopping",
    "little-india-arcade":                 "Little India Arcade Singapore colourful shops Indian goods",
    "orchard-road-belt":                   "Orchard Road Singapore Christmas decorated shopping belt",
    "harbourfront-centre":                 "HarbourFront Centre Singapore waterfront mall",
    "tanglin-mall":                        "Tanglin Mall Singapore expatriate upscale shopping",
    "holland-road-shopping-centre":        "Holland Village Singapore lifestyle shopping centre",
    "paragon-orchard":                     "Paragon Orchard Singapore luxury mall",
    "far-east-plaza":                      "Far East Plaza Singapore youth street fashion Orchard",
    "lucky-plaza-orchard":                 "Lucky Plaza Singapore Filipino Orchard shopping",
    "forum-the-shopping-mall":             "Forum The Shopping Mall Singapore Orchard children toys",
    "scotts-square":                       "Scotts Square Singapore luxury boutique Orchard",
    "wisma-atria":                         "Wisma Atria Singapore Orchard Road shopping",
    "wheelock-place":                      "Wheelock Place Singapore Orchard Road mall glass pyramid",
    "shaw-centre":                         "Shaw Centre Singapore Orchard Road cinemas shopping",
    "great-world-city":                    "Great World Singapore mall Kim Seng",
    "raffles-city-shopping-centre":        "Raffles City Singapore luxury mall City Hall MRT",
    "marina-square":                       "Marina Square Singapore waterfront mall Suntec area",
    "millenia-walk":                       "Millenia Walk Singapore lifestyle mall Suntec",
    "one-raffles-place-mall":              "One Raffles Place Singapore CBD mall office tower",
    "orchard-gateway":                     "Orchard Gateway Singapore mall underground tunnel",
    "palais-renaissance":                  "Palais Renaissance Singapore luxury boutique Orchard",
    "tangs-orchard":                       "TANGS Orchard Singapore department store iconic",
    "cathay-cineleisure-orchard":          "The Cathay Singapore Dhoby Ghaut cinema heritage",
    "capitol-piazza":                      "Capitol Piazza Singapore heritage colonial mall",
    "queensway-shopping-centre":           "Queensway Shopping Centre Singapore sports goods",
    "tanglin-shopping-centre":             "Tanglin Shopping Centre Singapore antiques art",
    "waterway-point-punggol":              "Waterway Point Punggol Singapore waterfront mall",
    "amk-hub":                             "AMK Hub Ang Mo Kio Singapore suburban mall",
    "nex-serangoon":                       "NEX Serangoon Singapore mall hub",
    "beauty-world-centre":                 "Beauty World Centre Singapore Bukit Timah beauty",
    "bukit-timah-shopping-centre":         "Bukit Timah Shopping Centre Singapore neighbourhood",
    "novena-square-velocity":              "Velocity Novena Square Singapore sports mall",
    "kallang-wave-mall":                   "Kallang Wave Mall Singapore Sports Hub",
    "chinatown-point":                     "Chinatown Point Singapore mall pagoda street",
    "tiong-bahru-plaza":                   "Tiong Bahru Plaza Singapore neighbourhood mall",
    "bugis-plus":                          "Bugis+ Singapore youth fashion mall street art",
    "city-square-mall":                    "City Square Mall Singapore eco-friendly garden mall",
    "plaza-singapura":                     "Plaza Singapura Singapore Dhoby Ghaut Orchard mall",
    "plaza-singapura-lvb":                 "Plaza Singapura Singapore entertainment bowling games",
    "the-centrepoint":                     "The Centrepoint Singapore Orchard neighbourhood mall",
    "orchard-central":                     "Orchard Central Singapore vertical mall art Orchard",
    "jurong-point":                        "Jurong Point Singapore largest suburban mall",
    "the-star-vista":                      "The Star Vista Buona Vista Singapore concert mall",
    "junction-8-bishan":                   "Junction 8 Bishan Singapore mall community",
    "thomson-plaza":                       "Thomson Plaza Singapore neighbourhood family mall",
    "hougang-mall":                        "Hougang Mall Singapore neighbourhood",
    "bukit-panjang-plaza":                 "Bukit Panjang Plaza Singapore LRT mall",
    "lot-one-shoppers-mall":               "Lot One Shoppers Mall Choa Chu Kang Singapore",
    "sembawang-shopping-centre":           "Sembawang Shopping Centre Singapore north waterfront",
    "northpoint-city":                     "Northpoint City Singapore largest north mall",
    "causeway-point":                      "Causeway Point Woodlands Singapore largest north mall",
    "rivervale-mall":                      "Rivervale Mall Sengkang Singapore Rivervale",
    "eastpoint-mall-simei":                "Eastpoint Mall Simei Singapore neighbourhood",
    "tampines-1-mall":                     "Tampines 1 Singapore mall shopping",
    "tampines-mall":                       "Tampines Mall Singapore east hub shopping",
    "century-square":                      "Century Square Tampines Singapore mall",
    "changi-city-point":                   "Changi City Point Singapore business park mall",
    "westgate-mall":                       "Westgate Singapore Jurong East mall retail",
    "the-clementi-mall":                   "The Clementi Mall Singapore MRT integrated",
    "i12-katong":                          "i12 Katong Singapore lifestyle shopping East Coast",
    "parkway-parade":                      "Parkway Parade Marine Parade Singapore shopping",
    "white-sands-mall":                    "White Sands Pasir Ris Singapore mall beach side",
    "elias-mall-pasir-ris":                "Elias Mall Pasir Ris Singapore neighbourhood",
    "westmall-bukit-batok":                "WestMall Bukit Batok Singapore west suburban mall",
    "united-square-novena":                "United Square Novena Singapore children education mall",
    "novena-square2":                      "Square 2 Novena Singapore neighbourhood mall",
    "square-2-novena":                     "Square 2 Novena Singapore mall",
    "sengkang-grand-mall":                 "Sengkang Grand Mall Singapore integrated development",
    "bedok-mall":                          "Bedok Mall Singapore east MRT integrated shopping",
    "the-woodleigh-mall":                  "The Woodleigh Mall Singapore new integrated mall",
}


# ── Pexels API ─────────────────────────────────────────────────────────────────

def _fetch_pexels(query: str, api_key: str, per_page: int = 3) -> str | None:
    """
    Search Pexels for landscape photos matching *query*.

    Returns the large2x (or large) URL of the first result, or None on miss/error.
    """
    params = urllib.parse.urlencode({
        "query":       query,
        "orientation": "landscape",
        "per_page":    per_page,
        "size":        "large",
    })
    url = f"{_PEXELS_SEARCH_URL}?{params}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": api_key},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status != 200:
                log.warning("Pexels HTTP %d for query %r", resp.status, query)
                return None
            data = json.loads(resp.read())
            photos = data.get("photos", [])
            if not photos:
                return None
            src = photos[0].get("src", {})
            return src.get("large2x") or src.get("large")
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            retry = int(exc.headers.get("Retry-After", 65))
            log.warning("Pexels 429 — sleeping %ds", retry)
            time.sleep(retry)
        else:
            log.warning("Pexels HTTP %d for %r", exc.code, query)
        return None
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        log.warning("Pexels request error for %r: %s", query, exc)
        return None


def _build_query(place: dict) -> str:
    """Return the best Pexels search query for a POI."""
    pid = place["id"]
    if pid in _QUERY_OVERRIDES:
        return _QUERY_OVERRIDES[pid]

    name = place["name"]
    cat  = place.get("category", "")

    # Strip special characters that appear in names (–, →, •, ')
    clean = (
        name.replace("→", "")   # →
            .replace("–", "")   # –
            .replace("—", "")   # —
            .replace("•", "")   # •
            .replace("’", "'")  # '
            .replace("(", "")
            .replace(")", "")
            .strip()
    )

    if cat == "FOOD_BEVERAGE":
        return f"{clean} Singapore food"
    elif cat == "HERITAGE":
        return f"{clean} Singapore heritage"
    else:
        return f"{clean} Singapore"


# ── Progress bar ───────────────────────────────────────────────────────────────

def _progress(current: int, total: int, label: str) -> None:
    bar_width = 32
    filled = int(bar_width * current / max(total, 1))
    bar = "█" * filled + "░" * (bar_width - filled)
    eta_s  = (total - current) * _PEXELS_DELAY
    eta_m  = eta_s / 60
    print(
        f"\r  [{bar}] {current:3d}/{total}  ETA ~{eta_m:.0f}m  {label[:42]:<42}",
        end="", flush=True,
    )


def _clear_progress() -> None:
    print(" " * 110, end="\r")


# ── Main ───────────────────────────────────────────────────────────────────────

def seed(*, resume: bool = False, limit: int = 0, dry_run: bool = False) -> None:
    # ── Validate key ──────────────────────────────────────────────────────────
    api_key: str = settings.pexels_api_key or ""
    if not api_key:
        sys.exit(
            "PEXELS_API_KEY not set in backend/.env\n"
            "Get a free key at https://www.pexels.com/api/ then add:\n"
            "  PEXELS_API_KEY=<your_key>\n"
            "to backend/.env and re-run."
        )

    # ── Load data ─────────────────────────────────────────────────────────────
    if not _DATA_FILE.exists():
        sys.exit(f"Data file not found: {_DATA_FILE}")

    raw: list[dict] = json.loads(_DATA_FILE.read_text(encoding="utf-8"))
    log.info("Loaded %d POIs from %s", len(raw), _DATA_FILE.name)

    # ── Select pending POIs ───────────────────────────────────────────────────
    if resume:
        pending = [p for p in raw if not p.get("image_url")]
        log.info("--resume: %d POIs already have image_url, %d pending",
                 len(raw) - len(pending), len(pending))
    else:
        pending = list(raw)   # overwrite all — existing URLs are broken
        log.info("Overwrite mode: fetching URLs for all %d POIs", len(pending))

    if limit > 0:
        pending = pending[:limit]
        log.info("--limit %d applied: processing %d POIs", limit, len(pending))

    if dry_run:
        log.info("*** DRY RUN — no files will be written ***")

    eta_min = len(pending) * _PEXELS_DELAY / 60
    log.info("ETA at 200 req/hr: ~%.0f min for %d POIs", eta_min, len(pending))

    # ── Build lookup for in-place update ─────────────────────────────────────
    raw_by_id = {p["id"]: p for p in raw}

    # ── Fetch loop ────────────────────────────────────────────────────────────
    hits = misses = 0
    for i, place in enumerate(pending, 1):
        query = _build_query(place)
        _progress(i, len(pending), place["name"])

        if dry_run:
            log.info("  [DRY] %s → %r", place["id"], query)
            continue

        url = _fetch_pexels(query, api_key)

        if url:
            raw_by_id[place["id"]]["image_url"] = url
            hits += 1
        else:
            # Keep old value (or null) — do not blank a previously working URL
            misses += 1
            log.warning("  No result for %s (%r)", place["id"], query)

        # Save after every POI — script is safe to interrupt and --resume
        _DATA_FILE.write_text(
            json.dumps(raw, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        time.sleep(_PEXELS_DELAY)

    _clear_progress()

    # ── Summary ───────────────────────────────────────────────────────────────
    total_with_url = sum(1 for p in raw if p.get("image_url"))
    log.info("=== Pexels seed complete ===")
    log.info("Processed : %d POIs", len(pending))
    log.info("Hits      : %d", hits)
    log.info("Misses    : %d  (image_url unchanged)", misses)
    log.info("Total with image_url: %d / %d", total_with_url, len(raw))
    if not dry_run:
        log.info("Saved     : %s", _DATA_FILE)
        log.info("")
        log.info("Next step: sync to Supabase")
        log.info("  cd backend && python -m app.scripts.seed_db")


# ── CLI ────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed singapore_places.json with Pexels landscape image URLs"
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Skip POIs that already have a non-null image_url (default: overwrite all)",
    )
    parser.add_argument(
        "--limit", type=int, default=0, metavar="N",
        help="Process only the first N POIs (0 = all, default: 0)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned queries without calling Pexels or writing files",
    )
    args = parser.parse_args()
    seed(resume=args.resume, limit=args.limit, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
