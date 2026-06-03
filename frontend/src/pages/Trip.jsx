import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  Clock,
  FileText,
  GripVertical,
  Loader2,
  MapPin,
  Navigation2,
  Plus,
  Route,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react'
import { api } from '../services/api'
import { useTrip } from '../hooks/useTrip'
import { useAlerts } from '../hooks/useAlerts'
import { useSavedTrips } from '../hooks/useSavedTrips'
import { useGeolocation } from '../hooks/useGeolocation'
import { useAuth } from '../contexts/AuthContext'
import { buildOrderedPlaces, buildPlacesById } from '../lib/tripUtils'
import { availableModesForLeg, normalizeTransportMode, transportMeta } from '../lib/transport'
import { cn } from '../lib/utils'
import TripMap from '../components/map/TripMap'
import AlertBanner from '../components/adaptation/AlertBanner'
import TripSetupModal from '../components/planner/TripSetupModal'
import SummaryTab from '../components/planner/SummaryTab'
import PlaceSearch from '../components/planner/PlaceSearch'
import BusArrivalPanel from '../components/transit/BusArrivalPanel'

function getSessionId() {
  try { return localStorage.getItem('session_id') } catch { return null }
}

function formatDuration(value) {
  if (value == null) return 'Flexible'
  if (value < 60) return `${value} min`
  return `${Math.floor(value / 60)}h ${value % 60}m`
}

function formatCost(value) {
  return value != null ? `S$${Number(value).toFixed(2)}` : 'S$0.00'
}

function dayStats(day) {
  const legs = day?.legs ?? []
  return {
    duration: legs.reduce((sum, leg) => sum + (leg.duration_minutes ?? 0), 0),
    cost: legs.reduce((sum, leg) => sum + (leg.cost_sgd ?? 0), 0),
    distance: legs.reduce((sum, leg) => sum + (leg.distance_km ?? 0), 0),
  }
}

function timelineForDay(day, placesById) {
  const legs = day?.legs ?? []
  if (!legs.length) return []
  const items = []
  const seen = new Set()
  legs.forEach((leg, index) => {
    const from = placesById[leg.from_place_id]
    const to = placesById[leg.to_place_id]
    if (from && !seen.has(from.id)) {
      seen.add(from.id)
      items.push({ type: 'place', place: from, incomingLeg: null, outgoingLeg: leg })
    }
    items.push({ type: 'leg', leg, from, to, index })
    if (to && !seen.has(to.id)) {
      seen.add(to.id)
      items.push({ type: 'place', place: to, incomingLeg: leg, outgoingLeg: legs[index + 1] ?? null })
    }
  })
  return items
}

function TransportBadge({ mode }) {
  const meta = transportMeta(mode)
  const Icon = meta.Icon
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold', meta.tone)}>
      <Icon size={12} />
      {meta.label}
    </span>
  )
}

function PlaceCard({ place, onRemove }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex gap-4">
        <div className="h-24 w-28 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-blue-50 via-emerald-50 to-amber-50">
          {place.image_url ? (
            <img
              src={place.image_url}
              alt=""
              className="h-full w-full object-cover"
              onError={(event) => { event.currentTarget.style.display = 'none' }}
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-blue-500">
              <MapPin size={22} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-display text-[17px] font-extrabold text-slate-950">{place.name}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-bold capitalize text-blue-700">
                  {place.category || 'place'}
                </span>
                <span className="rounded-md bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-500">
                  {place.dwell_minutes ?? place.suggested_duration_minutes ?? 60} min
                </span>
                {place.close_days?.length > 0 && (
                  <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">
                    Closed {place.close_days.join(', ')}
                  </span>
                )}
              </div>
            </div>
            {onRemove && (
              <button
                onClick={onRemove}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-500"
                title="Remove place"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {place.description && (
            <p className="mt-3 line-clamp-2 text-[13px] leading-6 text-slate-500">{place.description}</p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] text-slate-500">
            {place.formatted_address && (
              <p className="truncate"><MapPin size={12} className="mr-1 inline text-slate-400" />{place.formatted_address}</p>
            )}
            {place.best_time_start && (
              <p><Clock size={12} className="mr-1 inline text-slate-400" />Best {place.best_time_start}-{place.best_time_end}</p>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function LegCard({ leg, from, to, tripId, tripStarted, position, onUpdated, onWarning }) {
  const [open, setOpen] = useState(false)
  const [savingMode, setSavingMode] = useState(null)
  const [compare, setCompare] = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const meta = transportMeta(leg.transport_mode)

  const changeMode = async (mode) => {
    if (!tripId || !leg.id || savingMode) return
    setSavingMode(mode)
    try {
      const result = tripStarted && position
        ? await api.switchLegNow(tripId, leg.id, { new_mode: mode, current_lat: position.lat, current_lng: position.lng })
        : await api.updateLeg(tripId, leg.id, { transport_mode: mode })
      if (result?.warnings?.length) onWarning?.(result.warnings.join(' '))
      await onUpdated?.()
    } catch (err) {
      onWarning?.(err.message)
    } finally {
      setSavingMode(null)
    }
  }

  const loadCompare = async () => {
    if (!from || !to) return
    setCompareLoading(true)
    try {
      setCompare(await api.compareRoutes(from.lat, from.lng, to.lat, to.lng))
    } catch (err) {
      onWarning?.(err.message)
    } finally {
      setCompareLoading(false)
    }
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <TransportBadge mode={leg.transport_mode} />
            <span className="text-[12px] font-semibold text-slate-400">
              {from?.name ?? 'Origin'} to {to?.name ?? 'Destination'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[12px] font-bold text-slate-600">
              <Clock size={12} /> {formatDuration(leg.duration_minutes)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[12px] font-bold text-slate-600">
              <Wallet size={12} /> {formatCost(leg.cost_sgd)}
            </span>
            {leg.distance_km != null && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[12px] font-bold text-slate-600">
                <Route size={12} /> {Number(leg.distance_km).toFixed(1)} km
              </span>
            )}
            {leg.is_estimated && (
              <span className="rounded-md bg-amber-50 px-2 py-1 text-[12px] font-bold text-amber-700">Estimated</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setOpen((value) => !value)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700 hover:border-blue-200 hover:text-blue-700"
            >
              {savingMode ? <Loader2 size={13} className="animate-spin" /> : <meta.Icon size={13} />}
              Change
              <ChevronDown size={12} />
            </button>
            {open && (
              <div className="absolute right-0 top-10 z-30 w-44 overflow-hidden rounded-md border border-slate-200 bg-white shadow-pop">
                {availableModesForLeg(leg).map((option) => (
                  <button
                    key={option.mode}
                    onClick={() => { setOpen(false); changeMode(option.mode) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-bold text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                  >
                    <option.Icon size={14} />
                    {option.label}
                    {normalizeTransportMode(leg.transport_mode) === option.mode && <CheckCircle size={13} className="ml-auto text-emerald-600" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-700"
            title="Drag handle"
          >
            <GripVertical size={14} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setOpen(false)}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50"
        >
          {leg.instructions?.length ? `${leg.instructions.length} instructions` : 'No instructions'}
        </button>
        <button
          onClick={loadCompare}
          disabled={compareLoading}
          className="rounded-md border border-blue-100 bg-blue-50 px-3 py-1.5 text-[12px] font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
        >
          {compareLoading ? 'Comparing...' : 'Compare modes'}
        </button>
      </div>

      {(leg.instructions?.length > 0 || leg.sub_legs?.length > 0 || compare || leg.first_bus_stop_code) && (
        <div className="mt-3 space-y-3">
          {leg.instructions?.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Instructions</p>
              <ol className="space-y-1 text-[12px] text-slate-600">
                {leg.instructions.slice(0, 6).map((item, index) => (
                  <li key={index}>{index + 1}. {item}</li>
                ))}
              </ol>
            </div>
          )}

          {leg.sub_legs?.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Transit details</p>
              <div className="space-y-2">
                {leg.sub_legs.map((sub, index) => (
                  <div key={index} className="flex items-center gap-2 text-[12px] text-slate-600">
                    <TransportBadge mode={sub.mode} />
                    <span className="min-w-0 flex-1 truncate">
                      {sub.route ? `${sub.route}: ` : ''}{sub.from_name} to {sub.to_name}
                    </span>
                    <span className="shrink-0 font-bold">{sub.duration_minutes} min</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {leg.first_bus_stop_code && normalizeTransportMode(leg.transport_mode) === 'BUS' && (
            <BusArrivalPanel stopCode={leg.first_bus_stop_code} />
          )}

          {compare && (
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(compare).map(([key, value]) => (
                <div key={key} className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{key}</p>
                  <p className="mt-1 text-[13px] font-extrabold text-slate-900">
                    {value.available ? formatDuration(value.duration_minutes) : 'Unavailable'}
                  </p>
                  {value.available && <p className="text-[11px] text-slate-500">{formatCost(value.fare_sgd)}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function Overview({ trip, placesById, onSelectDay, onAddPlace, onRemovePlace, onReorder, onOptimize }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-[24px] font-extrabold text-slate-950">Overview</h2>
          <p className="mt-1 text-[13px] text-slate-500">Review warnings, free-time gaps, and daily route structure.</p>
        </div>
        <button
          onClick={onOptimize}
          className="flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-[13px] font-bold text-white hover:bg-slate-800"
        >
          <Sparkles size={15} /> Optimise
        </button>
      </div>

      {trip.warnings?.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <div className="space-y-1">
              {trip.warnings.map((warning, index) => (
                <p key={index} className="text-[13px] font-semibold text-amber-800">{warning}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {trip.gap_notifications?.length > 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
          <p className="mb-3 text-[12px] font-bold uppercase tracking-wide text-blue-700">Schedule gaps</p>
          <div className="space-y-2">
            {trip.gap_notifications.map((gap, index) => (
              <div key={index} className="rounded-md bg-white px-3 py-2 text-[13px] text-blue-900 shadow-sm">
                <span className="font-bold">Day {gap.day_index + 1} · {gap.gap_start}-{gap.gap_end}</span>
                <span className="text-blue-700"> · {gap.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {(trip.days ?? []).map((day) => {
          const items = timelineForDay(day, placesById).filter((item) => item.type === 'place')
          const stats = dayStats(day)
          return (
            <section key={day.day} className="rounded-lg border border-slate-200 bg-white p-4 shadow-card">
              <div className="mb-4 flex items-start justify-between gap-3">
                <button onClick={() => onSelectDay(day.day)} className="text-left">
                  <h3 className="font-display text-[18px] font-extrabold text-slate-950">Day {day.day}</h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    {items.length} stops · {formatDuration(stats.duration)} · {formatCost(stats.cost)}
                  </p>
                </button>
                <button
                  onClick={() => onAddPlace(day.day)}
                  className="grid h-8 w-8 place-items-center rounded-md border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  title="Add place"
                >
                  <Plus size={14} />
                </button>
              </div>
              {items.length ? (
                <div className="space-y-2">
                  {items.map((item, index) => (
                    <div key={item.place.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-white text-[11px] font-extrabold text-blue-600">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-700">{item.place.name}</span>
                      <button
                        onClick={() => onReorder(day.day, items.map((entry) => entry.place.id), index, -1)}
                        disabled={index === 0}
                        className="text-[11px] font-bold text-slate-400 hover:text-blue-600 disabled:opacity-30"
                      >
                        Up
                      </button>
                      <button
                        onClick={() => onReorder(day.day, items.map((entry) => entry.place.id), index, 1)}
                        disabled={index === items.length - 1}
                        className="text-[11px] font-bold text-slate-400 hover:text-blue-600 disabled:opacity-30"
                      >
                        Down
                      </button>
                      <button
                        onClick={() => onRemovePlace(item.place.id)}
                        className="text-slate-300 hover:text-red-500"
                        title="Remove"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-[13px] text-slate-400">
                  Empty day
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function DayView({ day, placesById, tripId, tripStarted, position, activeLegIndex, onUpdated, onWarning, onRemovePlace, onStart, onArrive, onAddPlace }) {
  const items = timelineForDay(day, placesById)
  const activeLeg = day?.legs?.[activeLegIndex]
  const activeFrom = activeLeg ? placesById[activeLeg.from_place_id] : null
  const activeTo = activeLeg ? placesById[activeLeg.to_place_id] : null

  if (tripStarted && activeLeg) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-[24px] font-extrabold text-slate-950">Active leg</h2>
            <p className="mt-1 text-[13px] text-slate-500">Route from your current progress through Day {day.day}.</p>
          </div>
          <button
            onClick={onArrive}
            className="flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-[13px] font-bold text-white hover:bg-emerald-500"
          >
            <CheckCircle size={15} /> Arrived
          </button>
        </div>
        <div className="grid grid-cols-[1fr_1.2fr_1fr] gap-4">
          <PlaceCard place={activeFrom} />
          <LegCard
            leg={activeLeg}
            from={activeFrom}
            to={activeTo}
            tripId={tripId}
            tripStarted
            position={position}
            onUpdated={onUpdated}
            onWarning={onWarning}
          />
          <PlaceCard place={activeTo} onRemove={() => onRemovePlace(activeTo.id)} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-[24px] font-extrabold text-slate-950">Day {day.day}</h2>
          <p className="mt-1 text-[13px] text-slate-500">Alternating place and route cards with live transport details.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onAddPlace(day.day)}
            className="flex h-10 items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-4 text-[13px] font-bold text-blue-700 hover:bg-blue-100"
          >
            <Plus size={15} /> Add place
          </button>
          <button
            onClick={() => onStart(day.day)}
            className="flex h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-[13px] font-bold text-white hover:bg-slate-800"
          >
            <Navigation2 size={15} /> Start
          </button>
        </div>
      </div>

      {items.length ? (
        <div className="space-y-3">
          {items.map((item, index) => item.type === 'place' ? (
            <PlaceCard
              key={`place-${item.place.id}`}
              place={item.place}
              onRemove={() => onRemovePlace(item.place.id)}
            />
          ) : (
            <LegCard
              key={`leg-${item.leg.id}-${index}`}
              leg={item.leg}
              from={item.from}
              to={item.to}
              tripId={tripId}
              tripStarted={false}
              position={position}
              onUpdated={onUpdated}
              onWarning={onWarning}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <MapPin className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-[14px] font-bold text-slate-600">No route legs in this day</p>
          <button
            onClick={() => onAddPlace(day.day)}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-[13px] font-bold text-white"
          >
            <Plus size={15} /> Add place
          </button>
        </div>
      )}
    </div>
  )
}

export default function Trip() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { trip, loading, error, refresh, isOffline } = useTrip(id, user?.id ?? null)
  const { trips: savedTrips, save: saveTrip } = useSavedTrips(user?.id ?? null)
  const { alerts, dismiss } = useAlerts(id)
  const { position } = useGeolocation()
  const lastLocationSent = useRef(0)

  const pendingKey = `imove_pending_${id}`
  const [pendingSave, setPendingSave] = useState(() => {
    if (location.state?.pendingSave) {
      sessionStorage.setItem(pendingKey, JSON.stringify(location.state.pendingSave))
      return location.state.pendingSave
    }
    try {
      const stored = sessionStorage.getItem(pendingKey)
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedDay, setSelectedDay] = useState(1)
  const [tripStarted, setTripStarted] = useState(!!location.state?.autoStart)
  const [activeLegIndex, setActiveLegIndex] = useState(0)
  const [setupOpen, setSetupOpen] = useState(false)
  const [addDayFor, setAddDayFor] = useState(null)
  const [uiWarning, setUiWarning] = useState(null)
  const [mutating, setMutating] = useState(false)

  const savedMeta = useMemo(() => savedTrips.find((item) => item.id === id), [savedTrips, id])
  const placesById = useMemo(() => buildPlacesById(trip?.places ?? []), [trip])
  const currentDay = useMemo(
    () => trip?.days?.find((day) => day.day === selectedDay) ?? trip?.days?.[0],
    [trip, selectedDay]
  )
  const mapLegs = activeTab === 'overview'
    ? trip?.days?.flatMap((day) => day.legs ?? []) ?? []
    : activeTab === 'summary'
      ? trip?.days?.flatMap((day) => day.legs ?? []) ?? []
      : currentDay?.legs ?? []
  const mapPlaces = useMemo(() => {
    if (!trip) return []
    if (activeTab === 'overview' || activeTab === 'summary') return trip.places ?? []
    return buildOrderedPlaces(trip.places ?? [], currentDay?.legs ?? []).ordered
  }, [trip, currentDay, activeTab])

  useEffect(() => {
    if (!trip?.days?.length) return
    if (!trip.days.some((day) => day.day === selectedDay)) setSelectedDay(trip.days[0].day)
  }, [trip, selectedDay])

  useEffect(() => {
    if (!tripStarted || !position || !id) return
    const now = Date.now()
    if (now - lastLocationSent.current < 30000) return
    lastLocationSent.current = now
    api.updateLocation(id, { ...position, session_id: getSessionId() }).catch(() => {})
  }, [tripStarted, position, id])

  const selectDayTab = (dayNum) => {
    setSelectedDay(dayNum)
    setActiveTab(`day-${dayNum}`)
  }

  const mutate = async (fn) => {
    if (mutating) return
    setMutating(true)
    setUiWarning(null)
    try {
      const result = await fn()
      await refresh(result?.days ? result : undefined)
    } catch (err) {
      setUiWarning(err.message)
    } finally {
      setMutating(false)
    }
  }

  const addDay = () => mutate(() => api.addDay(id))
  const removeDay = (dayNum) => mutate(() => api.removeDay(id, dayNum))
  const optimize = () => mutate(() => api.optimizeRoute(id))
  const removePlace = (placeId) => mutate(() => api.removePlaceFromDay(id, placeId))
  const addPlace = (place, day) => mutate(() => api.addPlaceToDay(id, { place_id: place.id, day }))
  const reorder = (day, ids, index, direction) => {
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    const next = [...ids]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    mutate(() => api.reorderPlaces(id, day, next))
  }

  const startDay = (dayNum) => {
    setTripStarted(true)
    setSelectedDay(dayNum)
    setActiveLegIndex(0)
    setActiveTab(`day-${dayNum}`)
    api.checkAlerts(id, { session_id: getSessionId() }).catch(() => {})
  }

  const arrive = () => {
    const day = trip?.days?.find((item) => item.day === selectedDay)
    if (!day) return
    if (activeLegIndex < (day.legs?.length ?? 0) - 1) {
      setActiveLegIndex((value) => value + 1)
      return
    }
    const nextDay = trip.days.find((item) => item.day === selectedDay + 1)
    if (nextDay) {
      setSelectedDay(nextDay.day)
      setActiveLegIndex(0)
      setActiveTab(`day-${nextDay.day}`)
    } else {
      setTripStarted(false)
      setActiveTab('summary')
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-[calc(100vh-56px)] place-items-center bg-slate-50">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
      </main>
    )
  }

  if (error || !trip) {
    return (
      <main className="grid min-h-[calc(100vh-56px)] place-items-center bg-slate-50 px-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
          Could not load trip: {String(error?.message ?? 'Trip not found')}
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-[calc(100vh-56px)] flex-col overflow-hidden bg-white">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <button onClick={() => navigate('/')} className="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100">
              <ArrowLeft size={17} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[22px] font-extrabold text-slate-950">
                {savedMeta?.name ?? pendingSave?.name ?? 'Singapore Trip'}
              </h1>
              <p className="mt-1 text-[12px] font-semibold text-slate-400">
                {trip.days?.length ?? 0} days · {trip.places?.length ?? 0} places
                {tripStarted && <span className="ml-2 text-emerald-600">Live</span>}
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={cn('h-9 rounded-md px-3 text-[13px] font-bold', activeTab === 'overview' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500')}
            >
              Overview
            </button>
            {(trip.days ?? []).map((day) => (
              <div key={day.day} className="flex items-center">
                <button
                  onClick={() => selectDayTab(day.day)}
                  className={cn('h-9 rounded-md px-3 text-[13px] font-bold', selectedDay === day.day && activeTab.startsWith('day-') ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500')}
                >
                  Day {day.day}
                </button>
                {(trip.days?.length ?? 0) > 1 && !tripStarted && (
                  <button
                    onClick={() => removeDay(day.day)}
                    className="mr-1 grid h-7 w-7 place-items-center rounded text-slate-300 hover:bg-red-50 hover:text-red-500"
                    title="Remove day"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={() => setActiveTab('summary')}
              className={cn('h-9 rounded-md px-3 text-[13px] font-bold', activeTab === 'summary' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500')}
            >
              Summary
            </button>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button onClick={addDay} disabled={tripStarted || mutating} className="grid h-9 w-9 place-items-center rounded-md border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50" title="Add day">
              {mutating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            </button>
            <button onClick={optimize} disabled={tripStarted || mutating} className="grid h-9 w-9 place-items-center rounded-md border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50" title="Optimise">
              <Sparkles size={15} />
            </button>
            <button onClick={() => setSetupOpen(true)} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" title="Edit setup">
              <Settings size={15} />
            </button>
          </div>
        </div>
      </header>

      {(isOffline || alerts.length > 0 || uiWarning) && (
        <section className="shrink-0 space-y-2 border-b border-slate-200 bg-white px-6 py-3">
          {isOffline && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
              <WifiOff size={15} /> Offline mode. Showing cached itinerary.
            </div>
          )}
          {uiWarning && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-700">
              <AlertCircle size={15} /> {uiWarning}
              <button onClick={() => setUiWarning(null)} className="ml-auto"><X size={14} /></button>
            </div>
          )}
          {alerts.map((alert) => (
            <AlertBanner key={alert.id} alert={alert} tripId={id} onDismiss={dismiss} onAdapted={refresh} />
          ))}
        </section>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(560px,0.92fr)_minmax(460px,1.08fr)] overflow-hidden">
        <section className="min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-6 scroll-thin">
          {activeTab === 'overview' && (
            <Overview
              trip={trip}
              placesById={placesById}
              onSelectDay={selectDayTab}
              onAddPlace={setAddDayFor}
              onRemovePlace={removePlace}
              onReorder={reorder}
              onOptimize={optimize}
            />
          )}

          {activeTab.startsWith('day-') && currentDay && (
            <DayView
              day={currentDay}
              placesById={placesById}
              tripId={id}
              tripStarted={tripStarted && currentDay.day === selectedDay}
              position={position}
              activeLegIndex={activeLegIndex}
              onUpdated={refresh}
              onWarning={setUiWarning}
              onRemovePlace={removePlace}
              onStart={startDay}
              onArrive={arrive}
              onAddPlace={setAddDayFor}
            />
          )}

          {activeTab === 'summary' && (
            <SummaryTab
              trip={trip}
              pendingSave={pendingSave}
              optimizationLog={(trip.warnings ?? []).map((warning) => ({ title: warning, type: 'mode_change' }))}
              onSave={(name) => {
                const meta = { ...pendingSave, name }
                saveTrip(id, meta)
                setPendingSave(null)
                sessionStorage.removeItem(pendingKey)
              }}
              onDelete={async () => {
                if (!window.confirm('Delete this trip permanently?')) return
                try {
                  await api.deleteTrip(id)
                  api.deleteSavedTrip(id, user?.id ?? null)
                  navigate('/')
                } catch (e) {
                  setUiWarning(e.message)
                }
              }}
            />
          )}
        </section>

        <aside className="min-h-0 bg-slate-100 p-4">
          <div className="h-full overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-card">
            <TripMap places={mapPlaces} legs={mapLegs} userPosition={tripStarted ? position : null} />
          </div>
        </aside>
      </div>

      <TripSetupModal
        open={setupOpen}
        savedMeta={savedMeta}
        onClose={() => setSetupOpen(false)}
        onSave={async (meta) => {
          saveTrip(id, { ...savedMeta, ...meta })
          if (!trip?.places?.length) return
          setMutating(true)
          setUiWarning(null)
          try {
            await api.planTrip(id, {
              place_ids: trip.places.map((p) => p.id),
              optimize_order: true,
              preferences: {
                budget_sgd: meta.budget_sgd ?? savedMeta?.budget_sgd ?? 100,
                travel_styles: meta.styles ?? [],
                group_type: meta.companion ?? 'solo',
              },
            })
            await refresh()
          } catch (e) {
            setUiWarning(e.message)
          } finally {
            setMutating(false)
          }
        }}
      />

      {addDayFor && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
          <div className="h-full w-[460px] overflow-y-auto bg-white p-6 shadow-pop">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-wide text-blue-600">Add place</p>
                <h2 className="font-display text-[24px] font-extrabold text-slate-950">Day {addDayFor}</h2>
              </div>
              <button onClick={() => setAddDayFor(null)} className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <PlaceSearch
              addedIds={new Set((trip.places ?? []).map((place) => place.id))}
              onAdd={async (place) => {
                await addPlace(place, addDayFor)
                setAddDayFor(null)
              }}
            />
          </div>
        </div>
      )}
    </main>
  )
}
