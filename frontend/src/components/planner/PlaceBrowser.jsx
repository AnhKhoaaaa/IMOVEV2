import { useState, useEffect } from 'react'
import {
  Search, Check, Leaf, Landmark, MapPin,
  Sparkles, Utensils, ShoppingBag, LayoutGrid,
  Star, Award
} from 'lucide-react'
import { api } from '../../services/api'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { useT } from '../../contexts/LanguageContext'

const CATEGORY_GROUPS = [
  { id: 'all',           label: 'Tất cả',              icon: LayoutGrid, categories: null },
  { id: 'culture',       label: 'Văn hoá',              icon: Landmark,   categories: ['museum', 'heritage'] },
  { id: 'landmark',      label: 'Tham quan',            icon: MapPin,     categories: ['landmark', 'viewpoint', 'attraction'] },
  { id: 'nature',        label: 'Thiên nhiên',          icon: Leaf,       categories: ['nature'] },
  { id: 'entertainment', label: 'Giải trí',             icon: Sparkles,   categories: ['entertainment'] },
  { id: 'food',          label: 'Ẩm thực & Mua sắm',   icon: Utensils,   categories: ['food', 'shopping'] },
]

const ICON_BY_CATEGORY = {
  museum:        Landmark,
  heritage:      Landmark,
  landmark:      MapPin,
  viewpoint:     MapPin,
  attraction:    MapPin,
  nature:        Leaf,
  entertainment: Sparkles,
  food:          Utensils,
  shopping:      ShoppingBag,
}

const SPECIAL_BADGES = {
  'gardens by the bay':             ["Editor's Pick 2026", "UNESCO World Heritage"],
  'marina bay sands':               ["Global 100 Night Attractions", "Top Luxury Destination"],
  'universal studios':              ["Theme Park Award 2025", "Must-Visit"],
  'singapore zoo':                  ["Asia's Best Zoo 2025", "Wildlife Award"],
  'night safari':                   ["Global 100 Night Attractions", "Unique Experience"],
  'river wonders':                  ["Best Aquatic Attraction", "Family Favorite"],
  'artscience museum':              ["Architecture Award 2025", "Top Cultural Venue"],
  'national museum':                ["Best Museum Singapore", "Heritage Listed"],
  'singapore botanic gardens':      ["UNESCO World Heritage", "Free Entry"],
  'sentosa':                        ["Top Island Destination", "Family Favorite"],
  'orchard road':                   ["Asia's Shopping Capital", "Iconic Landmark"],
  'chinatown':                      ["Cultural Heritage District", "Editor's Pick 2026"],
  'little india':                   ["Cultural Heritage District", "Hidden Gem"],
  'clarke quay':                    ["Top Nightlife Destination", "Waterfront Dining"],
  'fort canning':                   ["Historical Heritage Park", "Green Oasis"],
  'esplanade':                      ["World-Class Arts Venue", "Iconic Architecture"],
  'merlion':                        ["Iconic Singapore Symbol", "Top Photo Spot"],
  'haw par villa':                  ["Hidden Gem Singapore", "Unique Experience"],
  'east coast park':                ["Best Outdoor Recreation", "Local Favourite"],
  'mount faber':                    ["Scenic Viewpoint", "Cable Car Experience"],
  'pulau ubin':                     ["Off the Beaten Path", "Eco-Adventure"],
  'jewel changi':                   ["World's Best Airport Attraction", "Rain Vortex"],
  'cloud forest':                   ["Top Nature Attraction", "Global 100 Night Attractions"],
  'flower dome':                    ["Guinness Record Glasshouse", "Editor's Pick 2026"],
  'arab street':                    ["Cultural Heritage District", "Local Favourite"],
  'tiong bahru':                    ["Trendiest Neighbourhood 2025", "Hidden Gem"],
  'national gallery':               ["Best Museum Singapore", "Free on Fridays"],
  'science centre':                 ["Best Educational Attraction", "Family Favorite"],
  'zoo':                            ["Asia's Best Zoo 2025"],
  'safari':                         ["Global 100 Night Attractions"],
}

function getSpecialBadges(name) {
  if (!name) return []
  const lower = name.toLowerCase()
  for (const [key, badges] of Object.entries(SPECIAL_BADGES)) {
    if (lower.includes(key)) return badges
  }
  return []
}

function getExtendedCategory(place) {
  const cat = place.category?.toLowerCase() || ''
  if (cat === 'food_beverage' || cat === 'food') return 'food'
  if (cat === 'shopping') return 'shopping'
  if (cat === 'heritage' || cat === 'museum') return 'heritage'
  
  if (cat !== 'attraction') return cat
  
  const name = place.name?.toLowerCase() || ''
  const keywords = (place.search_keywords || []).map(k => k.toLowerCase())
  
  const isNature = (name.includes('garden') || name.includes('park') || name.includes('reserve') || name.includes('nature') || name.includes('beach') || name.includes('island') || name.includes('safari') || name.includes('zoo') || name.includes('reservoir') || keywords.includes('nature') || keywords.includes('park') || keywords.includes('wildlife')) 
    && !name.includes('merlion') 
    && !name.includes('skypark')
  
  if (isNature) return 'nature'
  
  const isEntertainment = name.includes('studio') || name.includes('universal') || name.includes('adventure') || name.includes('resort') || name.includes('flyer') || name.includes('cable car') || name.includes('skyline') || name.includes('show') || name.includes('nightlife') || keywords.includes('entertainment') || keywords.includes('theme park') || keywords.includes('thrill')
  
  if (isEntertainment) return 'entertainment'
  
  return 'attraction'
}

export default function PlaceBrowser({ selectedIds = [], onToggle }) {
  const { lang } = useT()
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeGroup, setActiveGroup] = useState('all')
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(20)

  useEffect(() => {
    api.getCuratedPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]))
      .finally(() => setLoading(false))
  }, [])

  // Reset limit when search or group changes
  useEffect(() => {
    setVisibleCount(20)
  }, [activeGroup, search])

  const filtered = places.filter((p) => {
    const group = CATEGORY_GROUPS.find((g) => g.id === activeGroup)
    if (!group?.categories) return !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
    const extCat = getExtendedCategory(p)
    const matchesGroup = group.categories.includes(extCat)
    const matchesSearch =
      !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
    return matchesGroup && matchesSearch
  })

  const visiblePlaces = filtered.slice(0, visibleCount)

  const getPlaceholder = () => (lang === 'vi' ? 'Tìm địa điểm...' : 'Search places...')
  const getSearchAriaLabel = () => (lang === 'vi' ? 'Tìm địa điểm' : 'Search places')
  const getFilterAriaLabel = () => (lang === 'vi' ? 'Lọc theo loại' : 'Filter by category')
  const getLoadingAriaLabel = () => (lang === 'vi' ? 'Đang tải địa điểm' : 'Loading places')
  const getEmptyMessage = () => (lang === 'vi' ? 'Không có địa điểm nào' : 'No places found')
  const getDwellTimeLabel = (mins) => (lang === 'vi' ? `~${mins} phút` : `~${mins} mins`)
  const getGroupLabel = (group) => {
    if (lang === 'vi') return group.label
    switch (group.id) {
      case 'all': return 'All'
      case 'culture': return 'Culture'
      case 'landmark': return 'Attractions'
      case 'nature': return 'Nature'
      case 'entertainment': return 'Entertainment'
      case 'food': return 'Food & Shopping'
      default: return group.label
    }
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={getPlaceholder()}
          className="pl-9"
          aria-label={getSearchAriaLabel()}
        />
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={getFilterAriaLabel()}>
        {CATEGORY_GROUPS.map((group) => {
          const { id, icon: Icon } = group
          return (
            <button
              key={id}
              onClick={() => setActiveGroup(id)}
              aria-pressed={activeGroup === id}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeGroup === id
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Icon className="h-3 w-3" />
              {getGroupLabel(group)}
            </button>
          )
        })}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2" aria-label={getLoadingAriaLabel()}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">{getEmptyMessage()}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {visiblePlaces.map((place) => {
              const isSelected = selectedIds.includes(place.id)
              const Icon = ICON_BY_CATEGORY[getExtendedCategory(place)] ?? MapPin
              const specialBadges = getSpecialBadges(place.name)
              return (
                <button
                  key={place.id}
                  onClick={() => onToggle(place)}
                  aria-pressed={isSelected}
                  aria-label={place.name}
                  className={`relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
                    isSelected
                      ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'
                      : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50'
                  }`}
                >
                  {isSelected && (
                    <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500">
                      <Check className="h-2.5 w-2.5 text-white" />
                    </span>
                  )}
                  <Icon
                    className={`h-4 w-4 shrink-0 ${isSelected ? 'text-sky-500' : 'text-slate-400'}`}
                  />
                  <span
                    className={`text-xs font-semibold leading-tight mt-1 ${
                      isSelected ? 'text-sky-700' : 'text-slate-700'
                    }`}
                  >
                    {place.name}
                  </span>
                  <span className="text-[11px] text-slate-400 mt-0.5">{getDwellTimeLabel(place.dwell_minutes)}</span>

                  {specialBadges.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {specialBadges.map((badge) => (
                        <span
                          key={badge}
                          className="inline-flex items-center gap-0.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700"
                        >
                          {badge.includes("Pick") || badge.includes("Best") || badge.includes("Top") || badge.includes("100")
                            ? <Star size={7} className="shrink-0" />
                            : <Award size={7} className="shrink-0" />
                          }
                          {badge}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {filtered.length > visibleCount && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + 20)}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95"
              >
                {lang === 'vi' ? 'Xem thêm' : 'Show more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
