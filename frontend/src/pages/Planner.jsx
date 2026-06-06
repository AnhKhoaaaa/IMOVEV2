import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  ChevronLeft,
  Clock,
  Loader2,
  MapPin,
  Navigation2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { cn } from '../lib/utils'
import PlaceSearch from '../components/planner/PlaceSearch'
import PlaceBrowser from '../components/planner/PlaceBrowser'

const COMPANIONS = [
  { id: 'solo', label: 'Solo' },
  { id: 'couple', label: 'Couple' },
  { id: 'family', label: 'Family' },
  { id: 'friends', label: 'Friends' },
]

const STYLES = [
  { id: 'nature', label: 'Nature' },
  { id: 'food', label: 'Food' },
  { id: 'heritage', label: 'Heritage' },
  { id: 'shopping', label: 'Shopping' },
  { id: 'nightlife', label: 'Nightlife' },
]

const generateId = () =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function endDate(startDate, numDays) {
  if (!startDate) return null
  const date = new Date(startDate)
  date.setDate(date.getDate() + Math.max(0, numDays - 1))
  return date.toISOString().slice(0, 10)
}

function Chip({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-9 rounded-md border px-3 text-[13px] font-bold transition',
        active
          ? 'border-blue-200 bg-blue-600 text-white shadow-card'
          : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'
      )}
    >
      {children}
    </button>
  )
}

function PlaceMiniCard({ place, onRemove }) {
  return (
    <div className="group flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="h-14 w-16 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-blue-50 via-emerald-50 to-amber-50">
        {place.image_url ? (
          <img
            src={place.image_url}
            alt=""
            className="h-full w-full object-cover"
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-blue-500">
            <MapPin size={18} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-extrabold text-slate-900">{place.name}</p>
        <p className="mt-0.5 truncate text-[11px] font-semibold capitalize text-slate-400">
          {place.category || 'place'} · {place.dwell_minutes ?? place.suggested_duration_minutes ?? 60} min
        </p>
        {place.formatted_address && (
          <p className="mt-1 truncate text-[11px] text-slate-500">{place.formatted_address}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-300 transition hover:bg-red-50 hover:text-red-500"
        title="Remove"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function SelectedList({ places, onRemove }) {
  if (!places.length) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <MapPin className="mx-auto h-7 w-7 text-slate-300" />
        <p className="mt-2 text-[13px] font-bold text-slate-600">No places selected yet</p>
        <p className="mt-1 text-[12px] text-slate-400">Search or browse all places to stage your itinerary.</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {places.map((place) => (
        <PlaceMiniCard key={place.id} place={place} onRemove={() => onRemove(place.id)} />
      ))}
    </div>
  )
}

export default function Planner() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [mode, setMode] = useState(null)
  const [placesById, setPlacesById] = useState({})
  const [placesLoading, setPlacesLoading] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [tripName, setTripName] = useState('Singapore Trip')
  const [numDays, setNumDays] = useState(3)
  const [budget, setBudget] = useState(60)
  const [flexible, setFlexible] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [groupType, setGroupType] = useState('solo')
  const [travelStyles, setTravelStyles] = useState(['heritage'])
  const [suggestState, setSuggestState] = useState('idle')
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [hotelQuery, setHotelQuery] = useState('')
  const [hotelResult, setHotelResult] = useState(null)
  const [hotelLoading, setHotelLoading] = useState(false)
  const [hotelNotFound, setHotelNotFound] = useState(false)
  const [hotel, setHotel] = useState(null)
  const hotelTimerRef = useRef(null)

  useEffect(() => {
    document.body.classList.add('planner-choice-immersive')
    return () => document.body.classList.remove('planner-choice-immersive')
  }, [])

  useEffect(() => {
    setPlacesLoading(true)
    api.getCuratedPlaces()
      .then((places) => setPlacesById(Object.fromEntries((places ?? []).map((place) => [place.id, place]))))
      .catch(() => setPlacesById({}))
      .finally(() => setPlacesLoading(false))
  }, [])

  useEffect(() => {
    if (hotelTimerRef.current) clearTimeout(hotelTimerRef.current)
    if (!hotelQuery.trim() || hotel) {
      setHotelResult(null)
      setHotelNotFound(false)
      setHotelLoading(false)
      return
    }
    setHotelLoading(true)
    setHotelResult(null)
    setHotelNotFound(false)
    hotelTimerRef.current = setTimeout(async () => {
      try {
        const result = await api.geocodeHotel(hotelQuery.trim())
        setHotelResult(result)
      } catch {
        setHotelNotFound(true)
      } finally {
        setHotelLoading(false)
      }
    }, 400)
    return () => clearTimeout(hotelTimerRef.current)
  }, [hotelQuery, hotel])

  const selectedIds = useMemo(() => selected.map((place) => place.id), [selected])

  const addPlace = (place) => {
    if (!place?.id || selectedIds.includes(place.id)) return
    setSelected((items) => [...items, place])
  }

  const removePlace = (placeId) => {
    setSelected((items) => items.filter((place) => place.id !== placeId))
  }

  const togglePlace = (place) => {
    if (selectedIds.includes(place.id)) removePlace(place.id)
    else addPlace(place)
  }

  const toggleStyle = (style) => {
    setTravelStyles((items) => items.includes(style) ? items.filter((item) => item !== style) : [...items, style])
  }

  const suggestPlaces = async () => {
    setSuggestState('thinking')
    setError(null)
    try {
      const response = await api.suggestPlaces({
        num_days: numDays,
        travel_styles: travelStyles,
        group_type: groupType,
      })
      const ids = response?.suggested_place_ids ?? []
      const next = ids.map((id) => placesById[id]).filter(Boolean)
      setSelected(next)
      setSuggestState('done')
    } catch (err) {
      setError(err.message)
      setSuggestState('error')
    }
  }

  const createPlan = async () => {
    if (selected.length < 2) {
      setError('Please select at least 2 places before generating a plan.')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const sessionId = localStorage.getItem('session_id') ?? generateId()
      localStorage.setItem('session_id', sessionId)
      const body = {
        session_id: sessionId,
        num_days: numDays,
        budget_sgd: Number(budget),
        start_date: flexible ? null : startDate || null,
        end_date: flexible || !startDate ? null : endDate(startDate, numDays),
      }
      const trip = await api.createTrip(body)
      await api.planTrip(trip.trip_id, {
        place_ids: selected.map((place) => place.id),
        optimize_order: true,
        preferences: {
          budget_sgd: Number(budget),
          travel_styles: travelStyles,
          group_type: groupType,
        },
        hotel_name: hotel?.name ?? null,
        hotel_lat: hotel?.lat ?? null,
        hotel_lng: hotel?.lng ?? null,
      })
      navigate(`/trip/${trip.trip_id}`, {
        state: {
          pendingSave: {
            name: tripName.trim() || 'Singapore Trip',
            startDate: flexible ? null : startDate || null,
            numDays,
            hotelName: hotel?.name ?? null,
            hotelLat: hotel?.lat ?? null,
            hotelLng: hotel?.lng ?? null,
          },
        },
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  if (!mode) {
    return (
      <main className="planner-choice-shell -mt-14 min-h-screen pt-24">
        <div className="planner-choice-frame mx-auto w-[min(980px,calc(100vw-48px))]">
          <div className="mb-8 max-w-2xl text-white">
            <p className="text-[12px] font-bold uppercase tracking-wide text-white/75">IMOVE planner</p>
            <h1 className="mt-2 font-display text-[54px] font-extrabold leading-none">Build your Singapore route</h1>
            <p className="mt-4 text-[15px] leading-7 text-white/75">
              Start from your own places or let AI shortlist transport-friendly stops from the curated Singapore dataset.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-5">
            <button
              type="button"
              onClick={() => setMode('manual')}
              className="rounded-lg border border-white/40 bg-white/90 p-6 text-left shadow-pop backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
            >
              <div className="grid h-12 w-12 place-items-center rounded-lg bg-blue-600 text-white">
                <Pencil size={20} />
              </div>
              <h2 className="mt-5 font-display text-[24px] font-extrabold text-slate-950">Manual planner</h2>
              <p className="mt-2 text-[14px] leading-6 text-slate-500">Search, browse, and stage every place yourself before generating the route.</p>
            </button>
            <button
              type="button"
              onClick={() => setMode('ai')}
              className="rounded-lg border border-white/40 bg-white/88 p-6 text-left shadow-pop backdrop-blur transition hover:-translate-y-0.5 hover:bg-white"
            >
              <div className="grid h-12 w-12 place-items-center rounded-lg bg-slate-900 text-white">
                <Sparkles size={20} />
              </div>
              <h2 className="mt-5 font-display text-[24px] font-extrabold text-slate-950">AI suggestion</h2>
              <p className="mt-2 text-[14px] leading-6 text-slate-500">Choose your travel style, get a shortlist, edit it, then generate the plan.</p>
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMode(null)}
              className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="Back"
            >
              <ChevronLeft size={18} />
            </button>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wide text-blue-600">{mode === 'manual' ? 'Manual' : 'AI'} planner</p>
              <h1 className="font-display text-[26px] font-extrabold text-slate-950">Create Singapore itinerary</h1>
            </div>
          </div>
          <button
            onClick={createPlan}
            disabled={creating || selected.length < 2}
            className="flex h-11 items-center gap-2 rounded-md bg-blue-600 px-5 text-[14px] font-bold text-white shadow-card hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Navigation2 size={16} />}
            Generate plan
          </button>
        </div>
      </div>

      <div className="mx-auto grid max-w-7xl grid-cols-[380px_1fr_360px] gap-6 px-6 py-6">
        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="font-display text-[16px] font-extrabold text-slate-950">Trip setup</h2>
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-[12px] font-bold text-slate-500">Trip name</span>
                <input
                  value={tripName}
                  onChange={(event) => setTripName(event.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] outline-none focus:border-blue-400"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[12px] font-bold text-slate-500">Days</span>
                  <input
                    type="number"
                    min="1"
                    max="14"
                    value={numDays}
                    onChange={(event) => setNumDays(Number(event.target.value))}
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] outline-none focus:border-blue-400"
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] font-bold text-slate-500">Budget SGD</span>
                  <input
                    type="number"
                    min="0"
                    value={budget}
                    onChange={(event) => setBudget(Number(event.target.value))}
                    className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] outline-none focus:border-blue-400"
                  />
                </label>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-1">
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setFlexible(true)}
                    className={cn('h-9 rounded text-[13px] font-bold', flexible ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500')}
                  >
                    <Clock size={13} className="mr-1 inline" /> Flexible
                  </button>
                  <button
                    onClick={() => setFlexible(false)}
                    className={cn('h-9 rounded text-[13px] font-bold', !flexible ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500')}
                  >
                    <Calendar size={13} className="mr-1 inline" /> Dates
                  </button>
                </div>
              </div>
              {!flexible && (
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-[13px] outline-none focus:border-blue-400"
                />
              )}
              {/* Hotel / start location */}
              <div>
                <span className="text-[12px] font-bold text-slate-500">
                  Hotel <span className="font-normal text-slate-400">(optional)</span>
                </span>
                {hotel ? (
                  <div className="mt-1 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <Building2 size={13} className="mt-0.5 shrink-0 text-emerald-600" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-slate-900">{hotel.name}</p>
                      {hotel.address && <p className="truncate text-[11px] text-slate-500">{hotel.address}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => { setHotel(null); setHotelQuery('') }}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:text-red-500"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative mt-1">
                      <input
                        value={hotelQuery}
                        onChange={(event) => setHotelQuery(event.target.value)}
                        placeholder="e.g. Marina Bay Sands"
                        className="h-10 w-full rounded-md border border-slate-200 px-3 pr-8 text-[13px] outline-none focus:border-blue-400"
                      />
                      {hotelLoading && (
                        <Loader2 size={13} className="absolute right-2.5 top-3.5 animate-spin text-slate-400" />
                      )}
                    </div>
                    {hotelResult && !hotelLoading && (
                      <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
                        <p className="min-w-0 truncate text-[12px] text-slate-600">{hotelResult.address}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setHotel({ name: hotelQuery.trim(), lat: hotelResult.lat, lng: hotelResult.lng, address: hotelResult.address })
                            setHotelResult(null)
                          }}
                          className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500"
                        >
                          <Check size={10} /> Use
                        </button>
                      </div>
                    )}
                    {hotelNotFound && !hotelLoading && (
                      <p className="mt-1 text-[11.5px] text-red-500">No location found. Try a more specific name.</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          {mode === 'ai' && (
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
              <h2 className="font-display text-[16px] font-extrabold text-slate-950">AI inputs</h2>
              <div className="mt-4 space-y-5">
                <div>
                  <p className="mb-2 text-[12px] font-bold text-slate-500">Travelling with</p>
                  <div className="flex flex-wrap gap-2">
                    {COMPANIONS.map((item) => (
                      <Chip key={item.id} active={groupType === item.id} onClick={() => setGroupType(item.id)}>
                        {item.label}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[12px] font-bold text-slate-500">Styles</p>
                  <div className="flex flex-wrap gap-2">
                    {STYLES.map((item) => (
                      <Chip key={item.id} active={travelStyles.includes(item.id)} onClick={() => toggleStyle(item.id)}>
                        {item.label}
                      </Chip>
                    ))}
                  </div>
                </div>
                <button
                  onClick={suggestPlaces}
                  disabled={suggestState === 'thinking' || placesLoading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-slate-900 text-[13px] font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {suggestState === 'thinking' ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                  {suggestState === 'done' ? 'Regenerate shortlist' : 'Suggest places'}
                </button>
              </div>
            </section>
          )}
        </aside>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-[18px] font-extrabold text-slate-950">Selected shortlist</h2>
              <p className="mt-1 text-[13px] text-slate-500">{selected.length} places staged for planning</p>
            </div>
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex h-10 items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 text-[13px] font-bold text-blue-700 hover:bg-blue-100"
            >
              <Search size={14} /> Browse all
            </button>
          </div>

          {suggestState === 'thinking' && (
            <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                <div>
                  <p className="text-[13px] font-bold text-blue-900">AI is matching your style to Singapore POIs</p>
                  <p className="text-[12px] text-blue-700">Filtering curated places, balancing distance, and preparing a shortlist.</p>
                </div>
              </div>
            </div>
          )}

          {suggestState === 'done' && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-[13px] font-bold text-emerald-700">
              <Check size={15} /> AI shortlist loaded. Edit it before generating the plan.
            </div>
          )}

          <SelectedList places={selected} onRemove={removePlace} />
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
            <h2 className="font-display text-[16px] font-extrabold text-slate-950">Quick search</h2>
            <div className="mt-3">
              <PlaceSearch onAdd={addPlace} addedIds={new Set(selectedIds)} />
            </div>
          </section>

          {error && (
            <section className="rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex gap-2">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <p className="text-[13px] font-semibold text-red-700">{error}</p>
              </div>
            </section>
          )}
        </aside>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
          <div className="h-full w-[560px] overflow-y-auto bg-white p-6 shadow-pop">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-wide text-blue-600">Browse all</p>
                <h2 className="font-display text-[24px] font-extrabold text-slate-950">Curated Singapore POIs</h2>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <PlaceBrowser selectedIds={selectedIds} onToggle={togglePlace} />
            <button
              onClick={() => setDrawerOpen(false)}
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-600 text-[13px] font-bold text-white hover:bg-blue-500"
            >
              <Plus size={15} /> Use selected places
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
