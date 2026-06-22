import { useState, useEffect, useMemo } from 'react'
import {
  Search, Check, Leaf, Landmark, MapPin,
  Sparkles, Utensils, ShoppingBag, LayoutGrid,
  Star, Clock3
} from 'lucide-react'
import { api } from '../../services/api'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { useT } from '../../contexts/LanguageContext'

const CATEGORY_GROUPS = [
  { id: 'all', label: 'Tất cả', icon: LayoutGrid, categories: null },
  { id: 'culture', label: 'Văn hoá', icon: Landmark, categories: ['museum', 'heritage'] },
  { id: 'landmark', label: 'Tham quan', icon: MapPin, categories: ['landmark', 'viewpoint', 'attraction'] },
  { id: 'nature', label: 'Thiên nhiên', icon: Leaf, categories: ['nature'] },
  { id: 'entertainment', label: 'Giải trí', icon: Sparkles, categories: ['entertainment'] },
  { id: 'food', label: 'Ẩm thực & Mua sắm', icon: Utensils, categories: ['food', 'shopping'] },
]

const ICON_BY_CATEGORY = {
  museum: Landmark,
  heritage: Landmark,
  landmark: MapPin,
  viewpoint: MapPin,
  attraction: MapPin,
  nature: Leaf,
  entertainment: Sparkles,
  food: Utensils,
  shopping: ShoppingBag,
}

const SPECIAL_BADGES = {
  'gardens by the bay': ["Editor's Pick 2026", "UNESCO World Heritage"],
  'marina bay sands': ["Global 100 Night Attractions", "Top Luxury Destination"],
  'universal studios': ["Theme Park Award 2025", "Must-Visit"],
  'singapore zoo': ["Asia's Best Zoo 2025", "Wildlife Award"],
  'night safari': ["Global 100 Night Attractions", "Unique Experience"],
  'river wonders': ["Best Aquatic Attraction", "Family Favorite"],
  'artscience museum': ["Architecture Award 2025", "Top Cultural Venue"],
  'national museum': ["Best Museum Singapore", "Heritage Listed"],
  'singapore botanic gardens': ["UNESCO World Heritage", "Free Entry"],
  'sentosa': ["Top Island Destination", "Family Favorite"],
  'orchard road': ["Asia's Shopping Capital", "Iconic Landmark"],
  'chinatown': ["Cultural Heritage District", "Editor's Pick 2026"],
  'little india': ["Cultural Heritage District", "Hidden Gem"],
  'clarke quay': ["Top Nightlife Destination", "Waterfront Dining"],
  'fort canning': ["Historical Heritage Park", "Green Oasis"],
  'esplanade': ["World-Class Arts Venue", "Iconic Architecture"],
  'merlion': ["Iconic Singapore Symbol", "Top Photo Spot"],
  'haw par villa': ["Hidden Gem Singapore", "Unique Experience"],
  'east coast park': ["Best Outdoor Recreation", "Local Favourite"],
  'mount faber': ["Scenic Viewpoint", "Cable Car Experience"],
  'pulau ubin': ["Off the Beaten Path", "Eco-Adventure"],
  'jewel changi': ["World's Best Airport Attraction", "Rain Vortex"],
  'cloud forest': ["Top Nature Attraction", "Global 100 Night Attractions"],
  'flower dome': ["Guinness Record Glasshouse", "Editor's Pick 2026"],
  'arab street': ["Cultural Heritage District", "Local Favourite"],
  'tiong bahru': ["Trendiest Neighbourhood 2025", "Hidden Gem"],
  'national gallery': ["Best Museum Singapore", "Free on Fridays"],
  'science centre': ["Best Educational Attraction", "Family Favorite"],
  'zoo': ["Asia's Best Zoo 2025"],
  'safari': ["Global 100 Night Attractions"],
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

export default function PlaceBrowser({ selectedIds = [], onToggle, places: suppliedPlaces, loading: suppliedLoading }) {
  const { lang } = useT()
  const usesSuppliedPlaces = Array.isArray(suppliedPlaces)
  const [fetchedPlaces, setFetchedPlaces] = useState([])
  const [fetchLoading, setFetchLoading] = useState(!usesSuppliedPlaces)
  const [activeGroup, setActiveGroup] = useState('all')
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(20)
  const places = usesSuppliedPlaces ? suppliedPlaces : fetchedPlaces
  const loading = usesSuppliedPlaces ? Boolean(suppliedLoading) : fetchLoading

  useEffect(() => {
    if (usesSuppliedPlaces) return undefined
    api.getCuratedPlaces()
      .then(setFetchedPlaces)
      .catch(() => setFetchedPlaces([]))
      .finally(() => setFetchLoading(false))
    return undefined
  }, [usesSuppliedPlaces])

  // Reset limit when search or group changes
  useEffect(() => {
    setVisibleCount(20)
  }, [activeGroup, search])

  const filtered = useMemo(() => places.filter((p) => {
    const group = CATEGORY_GROUPS.find((g) => g.id === activeGroup)
    if (!group?.categories) return !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
    const extCat = getExtendedCategory(p)
    const matchesGroup = group.categories.includes(extCat)
    const matchesSearch =
      !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
    return matchesGroup && matchesSearch
  }), [activeGroup, places, search])

  const visiblePlaces = filtered.slice(0, visibleCount)

  const getPlaceholder = () => (lang === 'vi' ? 'Tìm địa điểm...' : 'Search places...')
  const getSearchAriaLabel = () => (lang === 'vi' ? 'Tìm địa điểm' : 'Search places')
  const getFilterAriaLabel = () => (lang === 'vi' ? 'Lọc theo loại' : 'Filter by category')
  const getLoadingAriaLabel = () => (lang === 'vi' ? 'Đang tải địa điểm' : 'Loading places')
  const getEmptyMessage = () => (lang === 'vi' ? 'Không có địa điểm nào' : 'No places found')
  const getDwellTimeLabel = (mins) => (lang === 'vi' ? `~${mins} phút` : `~${mins} mins`)
  const getSelectedCountLabel = () => (
    lang === 'vi' ? `${selectedIds.length} địa điểm đã chọn` : `${selectedIds.length} places selected`
  )
  const getCategoryLabel = (place) => {
    const category = getExtendedCategory(place)
    const group = CATEGORY_GROUPS.find((item) => item.categories?.includes(category))
    return group ? getGroupLabel(group) : place.category
  }
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
    <div className="space-y-4">
      {/* Search */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={getPlaceholder()}
            className="h-11 rounded-xl border-slate-200 bg-white pl-9 focus-visible:ring-slate-300"
            aria-label={getSearchAriaLabel()}
          />
        </div>
        <span className="w-fit shrink-0 rounded-full bg-blue-600 px-3 py-2 text-[10px] font-extrabold text-white">
          {getSelectedCountLabel()}
        </span>
      </div>

      {/* Category filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={getFilterAriaLabel()}>
        {CATEGORY_GROUPS.map((group) => {
          const { id, icon: Icon } = group
          return (
            <button
              key={id}
              onClick={() => setActiveGroup(id)}
              aria-pressed={activeGroup === id}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[10px] font-extrabold transition-colors ${activeGroup === id
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-slate-900'
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={getLoadingAriaLabel()}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">{getEmptyMessage()}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visiblePlaces.map((place) => {
              const isSelected = selectedIds.includes(place.id)
              const Icon = ICON_BY_CATEGORY[getExtendedCategory(place)] ?? MapPin
              const specialBadges = getSpecialBadges(place.name)
              const primaryBadge = specialBadges[0]
              return (
                <button
                  key={place.id}
                  onClick={() => onToggle(place)}
                  aria-pressed={isSelected}
                  aria-label={place.name}
                  className={`group relative min-w-0 overflow-hidden rounded-2xl border bg-white text-left shadow-[0_5px_18px_-15px_rgba(15,23,42,0.3)] transition-[transform,box-shadow,border-color] duration-200 will-change-transform hover:z-10 hover:scale-[1.025] hover:border-slate-400 hover:shadow-[0_20px_38px_-27px_rgba(15,23,42,0.58)] ${isSelected
                      ? 'border-blue-600 ring-1 ring-blue-600'
                      : 'border-slate-200'
                    }`}
                >
                  <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-blue-100 via-violet-50 to-emerald-100">
                    <div className="absolute inset-0 grid place-items-center text-slate-400">
                      <Icon className="h-7 w-7" />
                    </div>
                    {place.image_url && (
                      <img
                        src={place.image_url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.055]"
                        onError={(event) => { event.currentTarget.style.display = 'none' }}
                      />
                    )}
                    <span className={`absolute right-2.5 top-2.5 z-10 grid h-7 w-7 place-items-center rounded-lg border border-white/80 shadow-sm transition ${isSelected ? 'bg-blue-600 text-white' : 'bg-white/90 text-slate-400'
                      }`}>
                      {isSelected ? <Check className="h-3.5 w-3.5" /> : <span className="text-base font-medium leading-none">+</span>}
                    </span>
                  </div>

                  <div className="p-3">
                    <span className="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
                      <Icon className="h-3 w-3" />
                      {getCategoryLabel(place)}
                    </span>
                    <span className="mt-1.5 line-clamp-2 min-h-9 text-[13px] font-extrabold leading-[1.35] text-slate-900">
                      {place.name}
                    </span>

                    {place.rating != null && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-slate-600">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        {Number(place.rating).toFixed(1)}
                      </span>
                    )}

                    <p className="mt-1.5 line-clamp-2 min-h-8 text-[10px] leading-[1.55] text-slate-500">
                      {place.description || place.formatted_address || (lang === 'vi' ? 'Khám phá địa điểm nổi bật tại Singapore.' : 'Discover a standout place in Singapore.')}
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-slate-600">
                        <Clock3 className="h-3.5 w-3.5" />
                        {getDwellTimeLabel(place.dwell_minutes ?? place.suggested_duration_minutes ?? 60)}
                      </span>
                      {primaryBadge && (
                        <span
                          className="max-w-[145px] truncate rounded-full bg-amber-50 px-2.5 py-1.5 text-[10px] font-extrabold text-amber-700"
                          title={primaryBadge}
                        >
                          {primaryBadge}
                        </span>
                      )}
                    </div>
                  </div>
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
