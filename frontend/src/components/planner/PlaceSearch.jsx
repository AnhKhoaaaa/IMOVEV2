import { useState, useEffect } from 'react'
import { Search, Plus, Check, MapPin, Star, Award } from 'lucide-react'
import { api } from '../../services/api'
import { useT } from '../../contexts/LanguageContext'
import { cn } from '../../lib/utils'

/* ── Badge data (placeholder — will be updated with accurate info) ── */
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

const CAT_STYLE = {
  museum:         { bg: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-400',    label: 'Museum' },
  nature:         { bg: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-400', label: 'Nature' },
  landmark:       { bg: 'bg-violet-100 text-violet-700',  dot: 'bg-violet-400',  label: 'Landmark' },
  heritage:       { bg: 'bg-amber-100 text-amber-700',    dot: 'bg-amber-400',   label: 'Heritage' },
  entertainment:  { bg: 'bg-pink-100 text-pink-700',      dot: 'bg-pink-400',    label: 'Entertainment' },
  food:           { bg: 'bg-orange-100 text-orange-700',  dot: 'bg-orange-400',  label: 'Food & Dining' },
  shopping:       { bg: 'bg-indigo-100 text-indigo-700',  dot: 'bg-indigo-400',  label: 'Shopping' },
  beach:          { bg: 'bg-cyan-100 text-cyan-700',      dot: 'bg-cyan-400',    label: 'Beach' },
  park:           { bg: 'bg-lime-100 text-lime-700',      dot: 'bg-lime-400',    label: 'Park' },
}
const DEFAULT_CAT = { bg: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', label: 'Attraction' }

function getCatStyle(category) {
  return CAT_STYLE[category?.toLowerCase()] ?? DEFAULT_CAT
}

function getSpecialBadges(name) {
  if (!name) return []
  const lower = name.toLowerCase()
  for (const [key, badges] of Object.entries(SPECIAL_BADGES)) {
    if (lower.includes(key)) return badges
  }
  return []
}

function normalizePlaces(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.places)) return value.places
  if (Array.isArray(value?.items)) return value.items
  return []
}

function mergePlaces(primary, fallback) {
  const seen = new Set()
  return [...primary, ...fallback].filter((place) => {
    if (!place?.id || seen.has(place.id)) return false
    seen.add(place.id)
    return true
  })
}

/* ── Place card ──────────────────────────────────────────────────── */
function PlaceCard({ place, isAdded, onAdd }) {
  const { t } = useT()
  const cat = getCatStyle(place.category)
  const specialBadges = getSpecialBadges(place.name)
  const canAdd = place.in_curated_dataset !== false

  return (
    <div className={cn(
      'group rounded-xl border bg-white px-3.5 py-3 transition',
      isAdded
        ? 'border-emerald-200 bg-emerald-50/40'
        : 'border-slate-200 hover:border-indigo-200 hover:shadow-sm'
    )}>
      <div className="flex items-start gap-2.5">
        {/* Left: icon */}
        <div className={cn(
          'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg',
          isAdded ? 'bg-emerald-100' : 'bg-slate-100 group-hover:bg-indigo-50'
        )}>
          <MapPin size={14} className={isAdded ? 'text-emerald-600' : 'text-slate-500 group-hover:text-indigo-500'} />
        </div>

        {/* Middle: name + badges */}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13.5px] font-semibold text-slate-900 leading-tight">{place.name}</span>
            {/* Category tag */}
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 h-5 text-[10.5px] font-semibold', cat.bg)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', cat.dot)} />
              {place.category ? (cat.label) : 'Attraction'}
            </span>
            {!canAdd && (
              <span className="rounded-full bg-slate-100 text-slate-500 border border-slate-200 px-2 h-5 text-[10px] font-medium inline-flex items-center">
                {t('limitedData')}
              </span>
            )}
          </div>

          {/* Special badges */}
          {specialBadges.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {specialBadges.map((badge) => (
                <span
                  key={badge}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 h-5 text-[10px] font-semibold text-amber-700"
                >
                  {badge.includes("Pick") || badge.includes("Best") || badge.includes("Top")
                    ? <Star size={8} className="shrink-0" />
                    : <Award size={8} className="shrink-0" />
                  }
                  {badge}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Right: Add button */}
        <button
          type="button"
          disabled={!canAdd || isAdded}
          onClick={() => onAdd(place)}
          className={cn(
            'shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 h-7 text-[12px] font-semibold transition',
            isAdded
              ? 'bg-emerald-100 text-emerald-700 cursor-default'
              : canAdd
                ? 'bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          )}
        >
          {isAdded
            ? <><Check size={11} /> {t('addedBtn')}</>
            : <><Plus size={11} /> {t('addBtn')}</>
          }
        </button>
      </div>
    </div>
  )
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function PlaceSearch({ onAdd, addedIds = new Set() }) {
  const { t } = useT()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [featured, setFeatured] = useState([])
  const [loadingFeatured, setLoadingFeatured] = useState(true)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  // Load curated places on mount for the featured list
  useEffect(() => {
    api.getCuratedPlaces()
      .then(places => setFeatured(normalizePlaces(places)))
      .catch((e) => setSearchError(e.message))
      .finally(() => setLoadingFeatured(false))
  }, [])

  // Search with debounce
  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearchError(null); return }
    const timer = setTimeout(async () => {
      try {
        setSearchError(null)
        setSearching(true)
        const data = await api.searchPlaces(query)
        setResults(normalizePlaces(data))
      } catch (e) {
        setSearchError(e.message)
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [query])

  const trimmedQuery = query.trim().toLowerCase()
  const showFeatured = !trimmedQuery
  const localMatches = showFeatured
    ? []
    : featured.filter((place) => {
      const haystack = `${place.name ?? ''} ${place.category ?? ''}`.toLowerCase()
      return haystack.includes(trimmedQuery)
    })
  const displayList = showFeatured ? featured : mergePlaces(results, localMatches)

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="flex h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
          autoFocus
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          </div>
        )}
      </div>

      {/* Section label */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-400">
          {showFeatured
            ? t('popularPlaces')
            : query.trim() && !searching
              ? `${displayList.length} result${displayList.length !== 1 ? 's' : ''} for "${query}"`
              : t('popularPlaces')
          }
        </p>
        {!showFeatured && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-[11px] text-indigo-500 hover:text-indigo-700 font-medium"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {searchError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
          {searchError}
        </div>
      )}

      {/* Place list */}
      {loadingFeatured && showFeatured ? (
        <div className="text-center py-6 text-[13px] text-slate-400">{t('loadingPlaces')}</div>
      ) : displayList.length > 0 ? (
        <div className="space-y-2 max-h-[360px] overflow-y-auto scroll-thin pr-0.5">
          {displayList.map(place => (
            <PlaceCard
              key={place.id}
              place={place}
              isAdded={addedIds.has(place.id)}
              onAdd={onAdd}
            />
          ))}
        </div>
      ) : query.trim() && !searching ? (
        <p className="text-center py-5 text-[13px] text-slate-400">
          {t('noResults', query)}
        </p>
      ) : null}
    </div>
  )
}
