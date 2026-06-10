import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Car,
  CheckCircle,
  ChevronDown,
  Clock,
  CloudRain,
  FileText,
  Loader2,
  MapPin,
  Navigation2,
  Plus,
  RotateCcw,
  Route,
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
import { buildPlacesById, computePlaceTimes, haversineMeters, parseHHMM, toHHMM } from '../lib/tripUtils'
import { allModesWithAvailability, normalizeTransportMode, transportMeta } from '../lib/transport'
import { openGrab } from '../lib/grab'
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
  // Single-place day: no legs but place_ids lists places — render without transit rows
  if (items.length === 0 && day?.place_ids?.length) {
    for (const pid of day.place_ids) {
      const place = placesById[pid]
      if (place) items.push({ type: 'place', place, incomingLeg: null, outgoingLeg: null })
    }
  }
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

function CompactPlaceCard({ place, role, onRemove }) {
  if (!place) return null
  const isTo = role === 'to'
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg border px-4 py-3',
      isTo ? 'border-emerald-200 bg-emerald-50' : 'border-blue-100 bg-blue-50'
    )}>
      <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', isTo ? 'bg-emerald-500' : 'bg-blue-500')} />
      <div className="min-w-0 flex-1">
        <p className={cn('text-[10.5px] font-bold uppercase tracking-wide', isTo ? 'text-emerald-600' : 'text-blue-500')}>
          {isTo ? 'Destination' : 'Starting from'}
        </p>
        <p className="font-display font-bold text-[15px] text-slate-900 truncate">{place.name}</p>
        {(place.dwell_minutes ?? 0) > 0 && (
          <p className="text-[11.5px] text-slate-500 mt-0.5">⏱ {place.dwell_minutes} min visit</p>
        )}
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 grid h-7 w-7 place-items-center rounded text-slate-300 hover:text-red-500"
          title="Remove"
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

function PlaceCard({ place, onRemove, arriveAt, departAt }) {
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
                {arriveAt && (
                  <span className="rounded-md bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-500 tabular-nums">
                    <Clock size={10} className="inline mr-0.5" />{arriveAt} – {departAt}
                  </span>
                )}
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

function LegCard({ leg, from, to, tripId, tripStarted, position, onUpdated, onWarning, open: openProp, onOpenChange }) {
  // Controlled when a parent passes open/onOpenChange (DayView keeps only one menu open);
  // falls back to local state for the standalone active-leg card.
  const controlled = openProp !== undefined
  const [openLocal, setOpenLocal] = useState(false)
  const open = controlled ? openProp : openLocal
  const setOpen = (next) => {
    const value = typeof next === 'function' ? next(open) : next
    if (controlled) onOpenChange?.(value)
    else setOpenLocal(value)
  }
  const menuRef = useRef(null)
  const [savingMode, setSavingMode] = useState(null)
  const [compare, setCompare] = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const meta = transportMeta(leg.transport_mode)

  // Close the mode menu when clicking outside it (e.g. switching to another leg)
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const changeMode = async (mode) => {
    if (!tripId || !leg.id || savingMode) return
    setSavingMode(mode)
    try {
      const result = tripStarted && position
        ? await api.switchLegNow(tripId, leg.id, { new_mode: mode, current_lat: position.lat, current_lng: position.lng })
        : await api.updateLeg(tripId, leg.id, { transport_mode: mode })
      if (result?.warnings?.length) onWarning?.(result.warnings.join(' '))
      await onUpdated?.()
      if (mode === 'GRAB') {
        const pickup   = (tripStarted && position) ? { lat: position.lat, lng: position.lng } : { lat: from?.lat, lng: from?.lng }
        const fromName = (tripStarted && position) ? 'Your location' : (from?.name ?? '')
        const toName   = to?.name ?? ''
        openGrab(
          { fromLat: pickup.lat, fromLng: pickup.lng, toLat: to?.lat, toLng: to?.lng, fromName, toName },
          ({ appOpened }) => onWarning?.(appOpened
            ? `Grab opened — enter pickup: ${fromName}, drop-off: ${toName}`
            : `Grab app not found — opened Google Maps instead (${fromName} → ${toName})`
          ),
        )
      }
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
              <span className="rounded-md bg-amber-50 px-2 py-1 text-[12px] font-bold text-amber-700">
                Estimated
              </span>
            )}
            {tripStarted && normalizeTransportMode(leg.transport_mode) === 'GRAB' && (
              <button
                onClick={() => {
                  const pickup   = position ? { lat: position.lat, lng: position.lng } : { lat: from?.lat, lng: from?.lng }
                  const fromName = position ? 'Your location' : (from?.name ?? '')
                  const toName   = to?.name ?? ''
                  openGrab(
                    { fromLat: pickup.lat, fromLng: pickup.lng, toLat: to?.lat, toLng: to?.lng, fromName, toName },
                    ({ appOpened }) => onWarning?.(appOpened
                      ? `Grab opened — enter pickup: ${fromName}, drop-off: ${toName}`
                      : `Grab app not found — opened Google Maps instead (${fromName} → ${toName})`
                    ),
                  )
                }}
                className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-[12px] font-bold text-white hover:bg-green-500"
              >
                <Car size={12} /> Open Grab
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative" ref={menuRef}>
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
                {allModesWithAvailability(leg).map((option) => (
                  <button
                    key={option.mode}
                    onClick={() => { if (!option.available) return; setOpen(false); changeMode(option.mode) }}
                    disabled={!option.available}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-bold',
                      option.available
                        ? 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'
                        : 'cursor-not-allowed text-slate-300 opacity-50'
                    )}
                  >
                    <option.Icon size={14} />
                    {option.label}
                    {!option.available && (
                      <span className="ml-auto text-[10px] font-medium text-slate-300">N/A</span>
                    )}
                    {option.available && normalizeTransportMode(leg.transport_mode) === option.mode && (
                      <CheckCircle size={13} className="ml-auto text-emerald-600" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {tripStarted && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={loadCompare}
              disabled={compareLoading}
              className="rounded-md border border-blue-100 bg-blue-50 px-3 py-1.5 text-[12px] font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
            >
              {compareLoading ? 'Comparing...' : 'Compare modes'}
            </button>
          </div>

          {(leg.sub_legs?.length > 0 || compare || leg.first_bus_stop_code) && (
            <div className="mt-3 space-y-3">
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
                <BusArrivalPanel
                  stopCode={leg.first_bus_stop_code}
                  serviceFilter={leg.sub_legs?.find((s) => s.mode === 'BUS')?.route ?? null}
                />
              )}

              {normalizeTransportMode(leg.transport_mode) !== 'BUS' &&
                (leg.sub_legs ?? [])
                  .filter((sub) => sub.mode === 'BUS' && sub.from_stop_code)
                  .map((sub, i) => (
                    <div key={i} className="mt-2">
                      <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                        Bus {sub.route}{sub.from_name ? ` — ${sub.from_name}` : ''}
                      </p>
                      <BusArrivalPanel stopCode={sub.from_stop_code} serviceFilter={sub.route ?? null} />
                    </div>
                  ))
              }

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
                  {/* Grab card — always shown in compare, data from leg.alternatives */}
                  <div className="rounded-md border border-green-100 bg-green-50 p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-green-600">Grab</p>
                    <p className="mt-1 text-[13px] font-extrabold text-green-900">
                      {leg.alternatives?.GRAB ? formatDuration(leg.alternatives.GRAB.duration_minutes) : '—'}
                    </p>
                    {leg.alternatives?.GRAB && (
                      <p className="text-[11px] text-green-600">
                        {formatCost(leg.alternatives.GRAB.fare_sgd)} · Estimated
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </article>
  )
}

const _WALK_M_PER_MIN  = 80   // ~5 km/h
const _METRO_M_PER_MIN = 600  // ~36 km/h
const _MIN_METRO_MIN   = 8

function computeHaversineTimes(places, hotel, startTimeStr) {
  let cursor = parseHHMM(startTimeStr || '09:00')
  const times = {}
  if (hotel && places[0]) {
    const d = haversineMeters({ lat: hotel.lat, lng: hotel.lng }, { lat: places[0].lat, lng: places[0].lng })
    cursor += d < 1500 ? Math.max(1, Math.round(d / _WALK_M_PER_MIN)) : Math.max(_MIN_METRO_MIN, Math.round(d / _METRO_M_PER_MIN))
  }
  for (let i = 0; i < places.length; i++) {
    const p = places[i]
    const dwell = p.dwell_minutes ?? 30
    times[p.id] = { arrive: toHHMM(cursor), depart: toHHMM(cursor + dwell) }
    cursor += dwell
    const next = places[i + 1] ?? hotel
    if (next) {
      const d = haversineMeters({ lat: p.lat, lng: p.lng }, { lat: next.lat, lng: next.lng })
      cursor += d < 1500 ? Math.max(1, Math.round(d / _WALK_M_PER_MIN)) : Math.max(_MIN_METRO_MIN, Math.round(d / _METRO_M_PER_MIN))
    }
  }
  if (hotel && places.length) times['hotel'] = { arrive: toHHMM(cursor) }
  return times
}

function Overview({ trip, allPlacesById, pendingByDay, pendingTimes, onSelectDay, onAddPlace, onRemovePlace, onReorder, onUpdateRoute, onOptimiseOrder, onStartTrip, tripStarted, startTime, needsRouteUpdate, keepOrderDone, mutating }) {
  const [routeDropdownOpen, setRouteDropdownOpen] = useState(false)
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-[24px] font-extrabold text-slate-950">Overview</h2>
          <p className="mt-1 text-[13px] text-slate-500">Review warnings, free-time gaps, and daily route structure.</p>
        </div>
        {!tripStarted && (
          <div className="flex items-center gap-2">
            {needsRouteUpdate ? (
              <div className="relative">
                <button
                  onClick={() => setRouteDropdownOpen((v) => !v)}
                  className="flex h-10 items-center gap-2 rounded-md bg-indigo-600 px-4 text-[13px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
                  disabled={mutating}
                >
                  {mutating ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Update Route
                  <ChevronDown size={13} className={cn('ml-1 transition-transform', routeDropdownOpen && 'rotate-180')} />
                </button>
                {routeDropdownOpen && (
                  <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-md border border-slate-200 bg-white shadow-pop">
                    <button
                      onClick={() => { setRouteDropdownOpen(false); onUpdateRoute(true) }}
                      disabled={keepOrderDone || mutating}
                      className={cn(
                        'flex w-full flex-col px-4 py-3 text-left hover:bg-slate-50',
                        (keepOrderDone || mutating) && 'cursor-not-allowed opacity-40'
                      )}
                    >
                      <span className="text-[13px] font-bold text-slate-800">Keep my order</span>
                      <span className="text-[11px] text-slate-500">Real transit times, your stop order</span>
                    </button>
                    <div className="border-t border-slate-100" />
                    <button
                      onClick={() => { setRouteDropdownOpen(false); onUpdateRoute(false) }}
                      disabled={mutating}
                      className="flex w-full flex-col px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-40"
                    >
                      <span className="text-[13px] font-bold text-slate-800">Let AI Optimise</span>
                      <span className="text-[11px] text-slate-500">AI reorders for best efficiency</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={onOptimiseOrder}
                disabled={mutating}
                className="flex h-10 items-center gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-4 text-[13px] font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
              >
                <Sparkles size={15} /> Optimise Order
              </button>
            )}
            {onStartTrip && (
              <button
                onClick={onStartTrip}
                className="flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-[13px] font-bold text-white hover:bg-emerald-500"
              >
                <Navigation2 size={15} /> Start Trip
              </button>
            )}
          </div>
        )}
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
          <p className="mb-3 text-[12px] font-bold uppercase tracking-wide text-blue-700">Long commutes</p>
          <div className="space-y-2">
            {trip.gap_notifications.map((gap, index) => (
              <div key={index} className="rounded-md bg-white px-3 py-2 text-[13px] text-blue-900 shadow-sm">
                <span className="font-bold">Day {gap.day_index + 1} · {gap.gap_start}–{gap.gap_end}</span>
                <span className="text-blue-700"> · {gap.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {(trip.days ?? []).map((day) => {
          const isDirty = !!pendingByDay[day.day]
          // Use pending order if available, else derive from server legs — hotel excluded
          const serverItems = timelineForDay(day, allPlacesById)
            .filter((item) => item.type === 'place' && item.place.id !== 'hotel')
          const visitPlaces = isDirty
            ? pendingByDay[day.day].map((pid) => allPlacesById[pid]).filter(Boolean)
            : serverItems.map((item) => item.place)

          const hotelPlace = allPlacesById['hotel'] ?? null
          const stats = dayStats(day)
          const serverPlaceTimes = computePlaceTimes(day, allPlacesById, startTime ?? '09:00')
          const placeTimes = isDirty ? (pendingTimes[day.day] ?? serverPlaceTimes) : serverPlaceTimes
          // Total transit includes all legs (hotel→first and last→hotel)
          const transitMin = (day.legs ?? []).reduce((s, l) => s + (l.duration_minutes ?? 0), 0)

          const hasHotelStart = day.legs?.[0]?.from_place_id === 'hotel'
          const hasHotelEnd   = (day.legs?.length ?? 0) > 0 && day.legs[day.legs.length - 1]?.to_place_id === 'hotel'
          const firstTime = hasHotelStart
            ? (startTime ?? '09:00')
            : (visitPlaces[0] ? placeTimes[visitPlaces[0].id]?.arrive : null)
          const lastTime = hasHotelEnd
            ? placeTimes['hotel']?.arrive
            : (visitPlaces.at(-1) ? placeTimes[visitPlaces.at(-1).id]?.depart : null)

          return (
            <section key={day.day} className="rounded-lg border border-slate-200 bg-white p-4 shadow-card">
              <div className="mb-4 flex items-start justify-between gap-3">
                <button onClick={() => onSelectDay(day.day)} className="text-left">
                  <h3 className="font-display text-[18px] font-extrabold text-slate-950">Day {day.day}</h3>
                  <p className="mt-1 text-[12px] text-slate-500">
                    {visitPlaces.length} stops · {formatCost(stats.cost)}
                  </p>
                  {firstTime && lastTime && (
                    <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                      {firstTime} – {lastTime} · {formatDuration(transitMin)} transit
                    </p>
                  )}
                </button>
                {!tripStarted && (
                  <button
                    onClick={() => onAddPlace(day.day)}
                    className="grid h-8 w-8 place-items-center rounded-md border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    title="Add place"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {/* Hotel start pin — always first, not reorderable */}
                {hotelPlace && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <Building2 size={13} className="shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Hotel</p>
                      <p className="truncate text-[12px] font-bold text-slate-700">{hotelPlace.name}</p>
                    </div>
                  </div>
                )}

                {/* Reorderable sightseeing places */}
                {visitPlaces.length > 0 ? visitPlaces.map((place, visitIndex) => {
                  const times = placeTimes[place.id]
                  return (
                    <div key={place.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[11px] font-extrabold text-blue-600">
                        {visitIndex + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold text-slate-700">{place.name}</p>
                        {times && (
                          <p className="text-[10.5px] text-slate-400 tabular-nums">{times.arrive} – {times.depart}</p>
                        )}
                      </div>
                      {!tripStarted && (
                        <>
                          <button
                            onClick={() => onReorder(day.day, visitPlaces.map((p) => p.id), visitIndex, -1)}
                            disabled={visitIndex === 0}
                            className="text-[11px] font-bold text-slate-400 hover:text-blue-600 disabled:opacity-30"
                          >Up</button>
                          <button
                            onClick={() => onReorder(day.day, visitPlaces.map((p) => p.id), visitIndex, 1)}
                            disabled={visitIndex === visitPlaces.length - 1}
                            className="text-[11px] font-bold text-slate-400 hover:text-blue-600 disabled:opacity-30"
                          >Down</button>
                          <button
                            onClick={() => onRemovePlace(place.id, day.day)}
                            className="text-slate-300 hover:text-red-500"
                            title="Remove"
                          >
                            <X size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  )
                }) : !hotelPlace && (
                  <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-[13px] text-slate-400">
                    Empty day
                  </div>
                )}

                {/* Hotel end pin — always last, not reorderable */}
                {hotelPlace && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <Building2 size={13} className="shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Return to Hotel</p>
                      <p className="truncate text-[12px] font-bold text-slate-700">{hotelPlace.name}</p>
                    </div>
                    {!isDirty && placeTimes['hotel']?.arrive && (
                      <span className="shrink-0 text-[10.5px] text-slate-400 tabular-nums">
                        {placeTimes['hotel'].arrive}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {isDirty && (
                <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-center text-[11.5px] font-semibold text-amber-700">
                  ⚡ Estimated — click <strong>Update Route</strong> to get real transit times
                </p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function DayView({ day, placesById, tripId, tripStarted, position, activeLegIndex, onUpdated, onWarning, onRemovePlace, onMarkArrived, onContinue, arrivedPending, onAddPlace, startTime, gapNotifications = [] }) {
  const items = timelineForDay(day, placesById)
  const activeLeg = day?.legs?.[activeLegIndex]
  const activeFrom = activeLeg ? placesById[activeLeg.from_place_id] : null
  const activeTo = activeLeg ? placesById[activeLeg.to_place_id] : null
  const placeTimes = computePlaceTimes(day, placesById, startTime ?? '09:00')
  const dayGaps = gapNotifications.filter((g) => g.day_index === day.day - 1)
  const [gapsOpen, setGapsOpen] = useState(false)
  // E1: only one transit "Change" menu open at a time within the day
  const [openLegId, setOpenLegId] = useState(null)
  // Detect return-to-hotel leg so we can append the hotel destination card
  const hasReturnToHotel = (day?.legs ?? []).at(-1)?.to_place_id === 'hotel' && !!placesById['hotel']

  if (tripStarted && activeLeg) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-[20px] font-extrabold text-slate-950">Active leg</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">
              Day {day.day} · Leg {activeLegIndex + 1} of {day.legs?.length ?? 1}
            </p>
          </div>
          <div className="relative">
            <button
              onClick={arrivedPending ? onContinue : onMarkArrived}
              className={cn(
                'flex h-10 items-center gap-2 rounded-md px-4 text-[13px] font-bold text-white transition-colors duration-300',
                arrivedPending
                  ? 'bg-teal-600 hover:bg-teal-500'
                  : 'bg-emerald-600 hover:bg-emerald-500',
              )}
            >
              {arrivedPending
                ? <><Navigation2 size={15} /> Continue</>
                : <><CheckCircle size={15} /> Arrived</>}
            </button>
            {arrivedPending && (
              <span className="absolute -right-1 -top-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-teal-500" />
              </span>
            )}
          </div>
        </div>
        <CompactPlaceCard place={activeFrom} role="from" />
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
        <CompactPlaceCard place={activeTo} role="to" onRemove={() => onRemovePlace(activeTo.id)} />
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
        <button
          onClick={() => onAddPlace(day.day)}
          className="flex h-10 items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-4 text-[13px] font-bold text-blue-700 hover:bg-blue-100"
        >
          <Plus size={15} /> Add place
        </button>
      </div>

      {items.length ? (
        <div className="space-y-3">
          {items.map((item, index) => item.type === 'place' ? (
            <PlaceCard
              key={`place-${item.place.id}`}
              place={item.place}
              arriveAt={placeTimes[item.place.id]?.arrive}
              departAt={placeTimes[item.place.id]?.depart}
              onRemove={item.place.id === 'hotel' ? undefined : () => onRemovePlace(item.place.id)}
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
              open={openLegId === item.leg.id}
              onOpenChange={(next) => setOpenLegId(next ? item.leg.id : null)}
            />
          ))}
          {hasReturnToHotel && (
            <PlaceCard
              key="hotel-return"
              place={placesById['hotel']}
              arriveAt={placeTimes['hotel']?.arrive}
              departAt={undefined}
            />
          )}
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

      {dayGaps.length > 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50">
          <button
            onClick={() => setGapsOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-[12.5px] font-semibold text-blue-700"
          >
            <Route size={13} className="shrink-0" />
            <span>{dayGaps.length} long transit{dayGaps.length > 1 ? 's' : ''} today</span>
            <ChevronDown size={13} className={cn('ml-auto transition-transform', gapsOpen && 'rotate-180')} />
          </button>
          {gapsOpen && (
            <div className="space-y-1.5 border-t border-blue-100 px-3 pb-3 pt-2">
              {dayGaps.map((gap, i) => (
                <div key={i} className="text-[12px] text-blue-800">
                  <span className="font-bold tabular-nums">{gap.gap_start}–{gap.gap_end}</span>
                  <span className="mx-1 text-blue-400">·</span>
                  <span>{gap.message}</span>
                </div>
              ))}
            </div>
          )}
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
  const { position, error: geoError } = useGeolocation()
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
  const [tripStarted, setTripStarted] = useState(() => {
    if (location.state?.autoStart) return true
    return sessionStorage.getItem(`imove_trip_started_${id}`) === 'true'
  })
  // editMode=true when returning from dashboard (no autoStart) while trip is already running.
  // Shows all edit controls without stopping GPS/autoArrive on the backend.
  const [editMode, setEditMode] = useState(() => {
    if (location.state?.autoStart) return false
    return sessionStorage.getItem(`imove_trip_started_${id}`) === 'true'
  })
  const [activeLegIndex, setActiveLegIndex] = useState(
    () => parseInt(sessionStorage.getItem(`imove_active_leg_${id}`) ?? '0', 10)
  )
  const [setupOpen, setSetupOpen] = useState(false)
  const [addDayFor, setAddDayFor] = useState(null)
  const [uiWarning, setUiWarning] = useState(null)
  const [mutating, setMutating] = useState(false)
  const [optimizeMsg, setOptimizeMsg] = useState(null)
  const [todayBanner, setTodayBanner] = useState(false)
  // Group multi-day weather forecast alerts: only the selected day's alert shows
  // expanded by default, the rest collapse behind a "Rain forecast for N days" toggle.
  const [showAllWeatherAlerts, setShowAllWeatherAlerts] = useState(false)

  // Pending local changes: { [dayNum]: placeId[] } — set by reorder/add/remove before "Update Route"
  const [pendingByDay, setPendingByDay] = useState({})
  // Locally added places not yet in server data
  const [pendingPlaces, setPendingPlaces] = useState({})
  // Task 7: arrival flow — user must tap Continue before advancing leg
  const [arrivedPending, setArrivedPending] = useState(false)
  const autoArrivedRef = useRef(false)  // prevents re-firing auto-arrive for same destination

  // Route status state
  const [keepOrderDone, setKeepOrderDone] = useState(false)
  const [confirmOptimise, setConfirmOptimise] = useState(false)
  // Task 8: live GPS trail (only for WALK/CYCLE legs)
  const [trackingPath, setTrackingPath] = useState([])
  const lastTrackPointRef = useRef(null)

  // Group multi-day weather forecast alerts so only the selected day's alert
  // shows expanded by default; other days collapse behind a toggle.
  const otherAlerts = useMemo(
    () => alerts.filter((a) => a.alert_type !== 'weather_warning'),
    [alerts]
  )
  const { weatherAlertsToShow, weatherAlertsCollapsed } = useMemo(() => {
    const forecast = alerts.filter((a) => a.alert_type === 'weather_warning')
    if (forecast.length <= 1) return { weatherAlertsToShow: forecast, weatherAlertsCollapsed: [] }
    const current = forecast.find((a) => a.day_number === selectedDay)
    const rest = forecast.filter((a) => a !== current)
    return { weatherAlertsToShow: current ? [current] : [], weatherAlertsCollapsed: rest }
  }, [alerts, selectedDay])

  const savedMeta = useMemo(() => savedTrips.find((item) => item.id === id), [savedTrips, id])
  const placesById = useMemo(() => buildPlacesById(trip?.places ?? []), [trip])
  const allPlacesById = useMemo(() => ({ ...placesById, ...pendingPlaces }), [placesById, pendingPlaces])
  const currentDay = useMemo(
    () => trip?.days?.find((day) => day.day === selectedDay) ?? trip?.days?.[0],
    [trip, selectedDay]
  )

  // Task 3a: 1-based sequence number for each place within its own day
  const placeSequences = useMemo(() => {
    const map = {}
    for (const day of trip?.days ?? []) {
      timelineForDay(day, allPlacesById)
        .filter(i => i.type === 'place')
        .forEach((i, idx) => { map[i.place.id] = idx + 1 })
    }
    return map
  }, [trip, allPlacesById])

  // E3: day ownership for map colour-coding (place → day, leg → day)
  const placeDays = useMemo(() => {
    const map = {}
    for (const day of trip?.days ?? []) {
      timelineForDay(day, allPlacesById)
        .filter(i => i.type === 'place')
        .forEach(i => { map[i.place.id] = day.day })
    }
    return map
  }, [trip, allPlacesById])
  const legDays = useMemo(() => {
    const map = {}
    for (const day of trip?.days ?? []) {
      for (const leg of day.legs ?? []) {
        if (leg.id != null) map[leg.id] = day.day
      }
    }
    return map
  }, [trip])

  // Route quality flags — drive badge + Day tab locking + button visibility
  // GRAB is always estimated by design — exclude it so a GRAB leg doesn't permanently lock Day tabs
  const isEstimated = useMemo(
    () => (trip?.days ?? []).flatMap((d) => d.legs ?? [])
      .some((l) => l.is_estimated && normalizeTransportMode(l.transport_mode) !== 'GRAB'),
    [trip]
  )
  const hasDirtyDays   = Object.keys(pendingByDay).length > 0
  const needsRouteUpdate = isEstimated || hasDirtyDays
  // isLive drives all UI decisions; raw tripStarted drives GPS/backend effects
  const isLive = tripStarted && !editMode

  // When routes become estimated again (e.g. after switching to GRAB), allow Keep My Order to run
  useEffect(() => {
    if (needsRouteUpdate) setKeepOrderDone(false)
  }, [needsRouteUpdate])

  // Chatbot confirmed a write → refresh the itinerary from the server.
  useEffect(() => {
    const onTripUpdated = () => { refresh() }
    window.addEventListener('imove:trip-updated', onTripUpdated)
    return () => window.removeEventListener('imove:trip-updated', onTripUpdated)
  }, [refresh])

  // Estimated times for pending (dirty) days — computed purely from haversine, no API call
  const startTimeStr = savedMeta?.startTime ?? '09:00'
  const pendingTimes = useMemo(() => {
    if (!hasDirtyDays) return {}
    const hotel = allPlacesById['hotel'] ?? null
    const result = {}
    for (const [dayStr, placeIds] of Object.entries(pendingByDay)) {
      const places = placeIds.map((pid) => allPlacesById[pid]).filter(Boolean)
      result[Number(dayStr)] = computeHaversineTimes(places, hotel, startTimeStr)
    }
    return result
  }, [pendingByDay, allPlacesById, startTimeStr, hasDirtyDays])

  // Task 3a: IDs of places in the currently selected day tab (null = no inter-day dimming)
  const activeDayPlaceIds = useMemo(() => {
    if (!activeTab.startsWith('day-') || !currentDay) return null
    return new Set(
      timelineForDay(currentDay, allPlacesById)
        .filter(i => i.type === 'place')
        .map(i => i.place.id)
    )
  }, [activeTab, currentDay, allPlacesById])

  // Hoist active leg computation so mapPlaces/mapLegs can use it
  const activeLeg = useMemo(
    () => (isLive ? currentDay?.legs?.[activeLegIndex] ?? null : null),
    [isLive, currentDay, activeLegIndex]
  )
  const activeFrom = activeLeg ? allPlacesById[activeLeg.from_place_id] : null
  const activeTo   = activeLeg ? allPlacesById[activeLeg.to_place_id]   : null

  // Reset auto-arrive guard whenever the destination changes (leg advance OR swap adaptation).
  useEffect(() => {
    autoArrivedRef.current = false
    setArrivedPending(false)
  }, [activeTo?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Task 8b: determine if current leg warrants a live-draw tracking polyline
  const activeLegMode = activeLeg ? normalizeTransportMode(activeLeg.transport_mode) : null
  const isWalkOrCycle = activeLegMode === 'WALK' || activeLegMode === 'CYCLE'

  // Map data: when trip started → only active leg; day tab → all places (TripMap dims others); overview → all
  const mapLegs = useMemo(() => {
    if (isLive && activeLeg) return [activeLeg]
    if (activeTab === 'overview' || activeTab === 'summary')
      return trip?.days?.flatMap((day) => day.legs ?? []) ?? []
    return currentDay?.legs ?? []
  }, [isLive, activeLeg, activeTab, trip, currentDay])

  // Task 4a: during trip — hide visited, dim future, show active at full opacity
  const mapPlaces = useMemo(() => {
    if (!trip) return []
    if (isLive && currentDay) {
      const legs = currentDay.legs ?? []
      const visitedIds = new Set(legs.slice(0, activeLegIndex).map(l => l.from_place_id))
      const activeIds = activeLeg
        ? new Set([activeLeg.from_place_id, activeLeg.to_place_id])
        : new Set()
      // Keep a place if it's part of the active leg even when already visited —
      // otherwise the hotel (leg 0's origin) vanishes on the final return-to-hotel leg.
      return (trip.places ?? [])
        .filter(p => !visitedIds.has(p.id) || activeIds.has(p.id))
        .map(p => ({ ...p, _dim: !activeIds.has(p.id) }))
    }
    // Include pending places not yet on server as additional pins (no polylines — map stays clean)
    const serverIds = new Set((trip.places ?? []).map((p) => p.id))
    const pendingPins = Object.values(pendingPlaces).filter((p) => !serverIds.has(p.id))
    return [...(trip.places ?? []), ...pendingPins]
  }, [trip, isLive, currentDay, activeLeg, activeLegIndex, pendingPlaces])

  useEffect(() => {
    if (!trip?.days?.length) return
    if (!trip.days.some((day) => day.day === selectedDay)) setSelectedDay(trip.days[0].day)
  }, [trip, selectedDay])

  useEffect(() => {
    if (!savedMeta?.start_date || tripStarted) return
    const today = new Date().toISOString().slice(0, 10)
    if (savedMeta.start_date === today) setTodayBanner(true)
  }, [savedMeta, tripStarted])

  useEffect(() => {
    if (!tripStarted || !position || !id) return
    const now = Date.now()
    if (now - lastLocationSent.current < 30000) return
    lastLocationSent.current = now
    api.updateLocation(id, { ...position, session_id: getSessionId() }).catch(() => {})
  }, [tripStarted, position, id])

  // Task 6b: auto-arrive when GPS is within 100 m of the destination
  useEffect(() => {
    if (!tripStarted || !position || !activeTo || autoArrivedRef.current || arrivedPending) return
    const dist = haversineMeters(position, { lat: activeTo.lat, lng: activeTo.lng })
    if (dist <= 100) {
      autoArrivedRef.current = true
      markArrived()
    }
  }, [position, tripStarted, activeTo, arrivedPending])

  // Task 8a: append a GPS point to the tracking trail when the user moves ≥ 30 m
  useEffect(() => {
    if (!tripStarted || !position) return
    if (!lastTrackPointRef.current) {
      lastTrackPointRef.current = position
      setTrackingPath([[position.lat, position.lng]])
      return
    }
    const dist = haversineMeters(lastTrackPointRef.current, position)
    if (dist >= 30) {
      lastTrackPointRef.current = position
      setTrackingPath(prev => [...prev, [position.lat, position.lng]])
    }
  }, [position, tripStarted])

  // Persist trip navigation state to sessionStorage so refresh restores position
  useEffect(() => {
    sessionStorage.setItem(`imove_trip_started_${id}`, String(tripStarted))
  }, [tripStarted, id])

  useEffect(() => {
    sessionStorage.setItem(`imove_active_leg_${id}`, String(activeLegIndex))
  }, [activeLegIndex, id])

  // When opened from Home dashboard with autoStart=true, jump to Day 1 once trip loads
  const autoStartHandled = useRef(false)
  useEffect(() => {
    if (!location.state?.autoStart || autoStartHandled.current || !trip?.days?.[0]) return
    autoStartHandled.current = true
    const firstDay = trip.days[0].day
    setSelectedDay(firstDay)
    setActiveLegIndex(0)
    setActiveTab(`day-${firstDay}`)
    api.checkAlerts(id, { session_id: getSessionId(), active_day: firstDay, active_leg_index: 0 }).catch(() => {})
  }, [trip?.days]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectDayTab = (dayNum) => {
    setSelectedDay(dayNum)
    setActiveTab(`day-${dayNum}`)
  }

  const resumeNavigation = () => {
    setEditMode(false)
    const day = trip?.days?.find((d) => d.day === selectedDay) ? selectedDay : (trip?.days?.[0]?.day ?? 1)
    setSelectedDay(day)
    setActiveTab(`day-${day}`)
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
  // Global "Update Route" handler — processes ALL dirty days using OneMap (force_real_routes=True)
  const handleUpdateRoute = async (keepOrder) => {
    if (mutating) return
    if (!keepOrder) { setConfirmOptimise(true); return }

    const existingLegs = (trip?.days ?? []).flatMap((d) => d.legs ?? []).filter((l) => !l.is_estimated)
    const dirtyDays = Object.keys(pendingByDay).map(Number).sort()
    // When no dirty days but routes are still estimated, process all days with current server order
    if (!dirtyDays.length && !isEstimated) return

    setMutating(true)
    setUiWarning(null)
    let lastResult = null
    try {
      const daysToProcess = dirtyDays.length > 0
        ? dirtyDays
        : (trip?.days ?? []).map((d) => d.day)

      for (const dayNum of daysToProcess) {
        const day = trip?.days?.find((d) => d.day === dayNum)
        const pendingIds = pendingByDay[dayNum]
        if (!day) continue

        if (pendingIds) {
          const serverIds = new Set(
            timelineForDay(day, allPlacesById)
              .filter((i) => i.type === 'place' && i.place.id !== 'hotel')
              .map((i) => i.place.id)
          )
          const pendingSet = new Set(pendingIds)
          const toRemove = [...serverIds].filter((pid) => !pendingSet.has(pid))
          const toAdd    = pendingIds.filter((pid) => !serverIds.has(pid) && pendingPlaces[pid])

          for (const placeId of toRemove) await api.removePlaceFromDay(id, placeId)
          for (const placeId of toAdd)    await api.addPlaceToDay(id, { place_id: placeId, day: dayNum })

          if (toRemove.length > 0 || toAdd.length > 0) {
            const freshTrip = await api.getTrip(id)
            const freshDay  = freshTrip?.days?.find((d) => d.day === dayNum)
            if (freshDay) {
              const freshPlacesById = buildPlacesById(freshTrip.places ?? [])
              const freshIds = timelineForDay(freshDay, freshPlacesById)
                .filter((i) => i.type === 'place' && i.place.id !== 'hotel')
                .map((i) => i.place.id)
              const freshSet = new Set(freshIds)
              const safeIds  = pendingIds.filter((pid) => freshSet.has(pid))
              const extraIds = freshIds.filter((pid) => !new Set(safeIds).has(pid))
              const finalIds = [...safeIds, ...extraIds]
              lastResult = JSON.stringify(finalIds) !== JSON.stringify(freshIds)
                ? await api.reorderPlaces(id, dayNum, finalIds, existingLegs)
                : freshTrip
            } else {
              lastResult = freshTrip
            }
          } else {
            lastResult = await api.reorderPlaces(id, dayNum, pendingIds, existingLegs)
          }
        } else {
          // Non-dirty day: recalculate with current server order to replace haversine estimates
          const currentIds = timelineForDay(day, allPlacesById)
            .filter((i) => i.type === 'place' && i.place.id !== 'hotel')
            .map((i) => i.place.id)
          if (currentIds.length > 0) {
            lastResult = await api.reorderPlaces(id, dayNum, currentIds, existingLegs)
          }
        }
      }
      await refresh(lastResult?.days ? lastResult : undefined)
      setKeepOrderDone(true)
    } catch (err) {
      setUiWarning(err.message)
    } finally {
      setMutating(false)
      setPendingByDay({})
      setPendingPlaces({})
    }
  }

  // Confirm → Let AI Optimise (also called by "Optimise Order" button when Good To Go)
  const handleConfirmOptimise = async () => {
    setConfirmOptimise(false)
    if (mutating) return
    const countEstimated = (days) => (days ?? []).flatMap((d) => d.legs ?? [])
      .filter((l) => l.is_estimated && normalizeTransportMode(l.transport_mode) !== 'GRAB').length
    const existingLegs = (trip?.days ?? []).flatMap((d) => d.legs ?? []).filter((l) => !l.is_estimated)
    const orderBefore = (trip?.days ?? []).flatMap((d) => (d.legs ?? []).map((l) => l.from_place_id))
    const daysBefore  = trip?.days?.length ?? 0
    const estimatedBefore = countEstimated(trip?.days)
    setMutating(true)
    setUiWarning(null)
    try {
      const result = await api.optimizeRoute(id, existingLegs)
      await refresh(result?.days ? result : undefined)
      setPendingByDay({})
      setPendingPlaces({})
      setKeepOrderDone(true)
      const orderAfter = (result?.days ?? []).flatMap((d) => (d.legs ?? []).map((l) => l.from_place_id))
      const daysAfter  = result?.days?.length ?? 0
      const reordered  = orderAfter.filter((v, i) => v !== orderBefore[i]).length
      const estimatedAfter = countEstimated(result?.days)
      if (daysAfter !== daysBefore) {
        setOptimizeMsg(`Route optimised — distributed across ${daysAfter} day${daysAfter !== 1 ? 's' : ''}.`)
      } else if (reordered > 0) {
        setOptimizeMsg(`Route optimised! ${reordered} stop${reordered !== 1 ? 's' : ''} reordered.`)
      } else if (estimatedBefore > 0 && estimatedAfter === 0) {
        setOptimizeMsg('Routes updated with real transit times — itinerary unlocked.')
      } else if (estimatedAfter > 0) {
        setOptimizeMsg(
          `Couldn't fetch real routes for ${estimatedAfter} leg${estimatedAfter !== 1 ? 's' : ''} — try Update Route again shortly.`
        )
      } else {
        setOptimizeMsg('Already optimal — no reordering needed.')
      }
      setTimeout(() => setOptimizeMsg(null), 4000)
    } catch (err) {
      setUiWarning(err.message)
    } finally {
      setMutating(false)
    }
  }

  // Helpers to get current displayed order for a day (pending override or server order)
  const getDisplayIds = (day) => {
    if (pendingByDay[day.day]) return pendingByDay[day.day]
    return timelineForDay(day, allPlacesById)
      .filter((i) => i.type === 'place' && i.place.id !== 'hotel')
      .map((i) => i.place.id)
  }

  // Local remove: update display state only — API call deferred to "Update Route"
  const removePlace = (placeId, dayNumHint) => {
    const dayOfPlace = trip?.days?.find((d) => {
      if (pendingByDay[d.day]) return pendingByDay[d.day].includes(placeId)
      return timelineForDay(d, allPlacesById).some((i) => i.type === 'place' && i.place.id === placeId)
    })
    const dayNum = dayNumHint ?? dayOfPlace?.day
    if (dayNum != null) {
      const day = trip.days.find((d) => d.day === dayNum)
      const currentIds = getDisplayIds(day)
      setKeepOrderDone(false)
      setPendingByDay((prev) => ({ ...prev, [dayNum]: currentIds.filter((pid) => pid !== placeId) }))
    }
    // If locally-added (not yet on server), also drop from pendingPlaces
    setPendingPlaces((prev) => { const next = { ...prev }; delete next[placeId]; return next })
  }

  // Local add: update display state only — API call deferred to "Update Route"
  const addPlace = (place, dayNum) => {
    const day = trip?.days?.find((d) => d.day === dayNum)
    const currentIds = getDisplayIds(day ?? { day: dayNum, legs: [] })
    if (!currentIds.includes(place.id)) {
      setKeepOrderDone(false)
      setPendingByDay((prev) => ({ ...prev, [dayNum]: [...currentIds, place.id] }))
      setPendingPlaces((prev) => ({ ...prev, [place.id]: place }))
    }
    setAddDayFor(null)
  }

  // Local reorder only — no API call until "Update Route"
  const reorderLocal = (dayNum, ids, index, direction) => {
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    const next = [...ids]
    ;[next[index], next[target]] = [next[target], next[index]]
    setKeepOrderDone(false)
    setPendingByDay((prev) => ({ ...prev, [dayNum]: next }))
  }

  const startDay = (dayNum) => {
    setTripStarted(true)
    setSelectedDay(dayNum)
    setActiveLegIndex(0)
    setActiveTab(`day-${dayNum}`)
    api.checkAlerts(id, { session_id: getSessionId(), active_day: dayNum, active_leg_index: 0 }).catch(() => {})
  }

  // Task 7: step 1 — mark arrived; user sees Continue banner before leg advances
  const markArrived = () => setArrivedPending(true)

  // Task 7: step 2 — advance to next leg (also resets GPS trail + auto-arrive guard)
  const advanceLeg = () => {
    autoArrivedRef.current = false
    setArrivedPending(false)
    setTrackingPath([])
    lastTrackPointRef.current = null
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
      sessionStorage.removeItem(`imove_trip_started_${id}`)
      sessionStorage.removeItem(`imove_active_leg_${id}`)
    }
  }

  if (loading) {
    return (
      <main aria-label="Loading trip" className="grid min-h-[calc(100vh-56px)] place-items-center bg-slate-50">
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
                {isLive && <span className="ml-2 text-emerald-600">Live</span>}
                {tripStarted && editMode && <span className="ml-2 text-amber-500">Paused</span>}
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
                  onClick={() => !needsRouteUpdate && selectDayTab(day.day)}
                  disabled={needsRouteUpdate}
                  title={needsRouteUpdate ? 'Update routes first' : undefined}
                  className={cn('h-9 rounded-md px-3 text-[13px] font-bold',
                    needsRouteUpdate
                      ? 'cursor-not-allowed opacity-40 text-slate-400'
                      : selectedDay === day.day && activeTab.startsWith('day-') ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                  )}
                >
                  Day {day.day}
                </button>
                {(trip.days?.length ?? 0) > 1 && !isLive && (
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
            {!isLive && (
              <>
                <button onClick={addDay} disabled={mutating} className="grid h-9 w-9 place-items-center rounded-md border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50" title="Add day">
                  {mutating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                </button>
                <button onClick={() => setSetupOpen(true)} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" title="Edit setup">
                  <Settings size={15} />
                </button>
              </>
            )}
            {tripStarted && editMode && (
              <button
                onClick={resumeNavigation}
                className="flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-[13px] font-bold text-white hover:bg-emerald-500"
              >
                <Navigation2 size={14} /> Resume Trip
              </button>
            )}
            {isLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[12px] font-bold text-emerald-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Mode banner */}
      <div className={cn(
        'shrink-0 border-b px-6 py-2 text-[12.5px] font-semibold flex items-center gap-2',
        isLive
          ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
          : tripStarted && editMode
            ? 'border-amber-100 bg-amber-50 text-amber-800'
            : 'border-slate-100 bg-slate-50 text-slate-500'
      )}>
        {isLive
          ? <><Navigation2 size={13} /> Live · Day {selectedDay} — tap Arrived when you reach each stop.</>
          : tripStarted && editMode
            ? <><Settings size={13} /> Edit mode — trip is paused. Resume when ready to navigate.</>
            : <>
                <FileText size={13} /> Planning mode — review your itinerary before you start.
                <span className={cn(
                  'ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold',
                  needsRouteUpdate
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-emerald-100 text-emerald-700'
                )}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', needsRouteUpdate ? 'bg-amber-500' : 'bg-emerald-500')} />
                  {needsRouteUpdate ? 'Estimated' : 'Good To Go'}
                </span>
              </>
        }
      </div>

      {(isOffline || todayBanner || optimizeMsg || (isLive && geoError) || alerts.length > 0 || uiWarning) && (
        <section className="shrink-0 space-y-2 border-b border-slate-200 bg-white px-6 py-3">
          {isLive && geoError && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
              <MapPin size={15} className="shrink-0" />
              GPS unavailable — auto-arrive is off. Tap{' '}
              <span className="font-bold">Arrived</span> manually when you reach each stop.
            </div>
          )}
          {todayBanner && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-800">
              <Navigation2 size={15} /> Your trip starts today! Head to the dashboard to start.
              <button onClick={() => setTodayBanner(false)} className="ml-auto"><X size={14} /></button>
            </div>
          )}
          {optimizeMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] font-semibold text-indigo-800">
              <Sparkles size={15} /> {optimizeMsg}
              <button onClick={() => setOptimizeMsg(null)} className="ml-auto"><X size={14} /></button>
            </div>
          )}
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
          {otherAlerts.map((alert) => (
            <AlertBanner key={alert.id} alert={alert} tripId={id} onDismiss={dismiss} onAdapted={refresh} />
          ))}
          {weatherAlertsToShow.map((alert) => (
            <AlertBanner key={alert.id} alert={alert} tripId={id} onDismiss={dismiss} onAdapted={refresh} />
          ))}
          {weatherAlertsCollapsed.length > 0 && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3.5">
              <button
                onClick={() => setShowAllWeatherAlerts((v) => !v)}
                className="flex w-full items-center gap-2 text-left text-[13px] font-semibold text-sky-900"
              >
                <CloudRain size={15} className="shrink-0 text-sky-500" />
                Rain forecast for {weatherAlertsCollapsed.length} more day{weatherAlertsCollapsed.length !== 1 ? 's' : ''}
                <ChevronDown size={14} className={cn('ml-auto shrink-0 transition-transform', showAllWeatherAlerts && 'rotate-180')} />
              </button>
              {showAllWeatherAlerts && (
                <div className="mt-3 space-y-2">
                  {weatherAlertsCollapsed.map((alert) => (
                    <AlertBanner key={alert.id} alert={alert} tripId={id} onDismiss={dismiss} onAdapted={refresh} />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(520px,0.9fr)_minmax(440px,1.1fr)] overflow-hidden">
        <section className="relative isolate min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-6 scroll-thin">
          {activeTab === 'overview' && (
            <Overview
              trip={trip}
              allPlacesById={allPlacesById}
              pendingByDay={pendingByDay}
              pendingTimes={pendingTimes}
              onSelectDay={selectDayTab}
              onAddPlace={setAddDayFor}
              onRemovePlace={removePlace}
              onReorder={reorderLocal}
              onUpdateRoute={handleUpdateRoute}
              onOptimiseOrder={() => setConfirmOptimise(true)}
              onStartTrip={null}
              tripStarted={isLive}
              startTime={savedMeta?.startTime ?? '09:00'}
              needsRouteUpdate={needsRouteUpdate}
              keepOrderDone={keepOrderDone}
              mutating={mutating}
            />
          )}

          {activeTab.startsWith('day-') && currentDay && (
            <DayView
              day={currentDay}
              placesById={allPlacesById}
              tripId={id}
              tripStarted={isLive && currentDay.day === selectedDay}
              position={position}
              activeLegIndex={activeLegIndex}
              onUpdated={refresh}
              onWarning={setUiWarning}
              onRemovePlace={removePlace}
              onMarkArrived={markArrived}
              onContinue={advanceLeg}
              arrivedPending={arrivedPending}
              onAddPlace={setAddDayFor}
              startTime={savedMeta?.startTime ?? '09:00'}
              gapNotifications={trip.gap_notifications ?? []}
            />
          )}

          {activeTab === 'summary' && (
            <SummaryTab
              trip={trip}
              pendingSave={pendingSave}
              optimizationLog={(trip.warnings ?? []).map((warning) => ({ title: warning, type: 'mode_change' }))}
              onSave={(name) => {
                const meta = { ...pendingSave, name, confirmed: true }
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

        <aside className="relative isolate min-h-0 bg-slate-100 p-4">
          <div className="h-full overflow-hidden rounded-lg border border-slate-200 bg-white p-3 shadow-card">
            <TripMap
              places={mapPlaces}
              legs={mapLegs}
              userPosition={tripStarted ? position : null}
              activeLegId={activeLeg?.id ?? null}
              trimActiveRoute={!!(activeLeg?.id)}
              placeSequences={placeSequences}
              activeDayPlaceIds={activeDayPlaceIds}
              trackingPath={isWalkOrCycle ? trackingPath : []}
              placeDays={placeDays}
              legDays={legDays}
              colorByDay={activeTab === 'overview' || activeTab === 'summary'}
            />
          </div>
        </aside>
      </div>

      <TripSetupModal
        open={setupOpen}
        savedMeta={savedMeta}
        tripHotel={allPlacesById['hotel'] ?? null}
        onClose={() => setSetupOpen(false)}
        onSave={async (meta) => {
          saveTrip(id, { ...savedMeta, ...meta, confirmed: true })
          if (!trip?.places?.length) return
          setMutating(true)
          setUiWarning(null)
          try {
            await api.planTrip(id, {
              place_ids: trip.places.filter((p) => p.id !== 'hotel').map((p) => p.id),
              optimize_order: true,
              preferences: {
                budget_sgd: meta.budget_sgd ?? savedMeta?.budget_sgd ?? 100,
                travel_styles: meta.styles ?? [],
                group_type: meta.companion ?? 'solo',
              },
              hotel_name: meta.hotelName ?? null,
              hotel_lat: meta.hotelLat ?? null,
              hotel_lng: meta.hotelLng ?? null,
            })
            await refresh()
          } catch (e) {
            setUiWarning(e.message)
          } finally {
            setMutating(false)
          }
        }}
      />

      {confirmOptimise && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50">
          <div className="w-[360px] rounded-xl border border-slate-200 bg-white p-6 shadow-pop">
            <h3 className="font-display text-[18px] font-extrabold text-slate-950">Optimise Order?</h3>
            <p className="mt-2 text-[13px] text-slate-500">
              AI will reorder your stops for efficiency using real transit data. Your current stop order may change.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setConfirmOptimise(false)}
                className="flex-1 h-10 rounded-md border border-slate-200 text-[13px] font-bold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmOptimise}
                className="flex-1 h-10 rounded-md bg-indigo-600 text-[13px] font-bold text-white hover:bg-indigo-500"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

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
              addedIds={new Set(Object.keys(allPlacesById))}
              onAdd={(place) => addPlace(place, addDayFor)}
            />
          </div>
        </div>
      )}
    </main>
  )
}
