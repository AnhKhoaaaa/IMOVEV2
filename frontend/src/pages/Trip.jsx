import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  Car,
  CheckCircle,
  ChevronDown,
  Clock,
  CloudRain,
  FileText,
  GripVertical,
  Home,
  Loader2,
  Lock,
  MapPin,
  Navigation2,
  PanelRightClose,
  PanelRightOpen,
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
import { DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from '../services/api'
import { useTrip } from '../hooks/useTrip'
import { useAlerts } from '../hooks/useAlerts'
import { useSavedTrips } from '../hooks/useSavedTrips'
import { useGeolocation } from '../hooks/useGeolocation'
import { useAuth } from '../contexts/AuthContext'
import { buildPlacesById, computePlaceTimes, haversineMeters, parseHHMM, toHHMM } from '../lib/tripUtils'
import { allModesWithAvailability, normalizeTransportMode, transportMeta } from '../lib/transport'
import { categoryChip, categoryHex } from '../lib/categories'
import { useT } from '../contexts/LanguageContext'

// Maps a transport mode to its i18n label key for the mode picker.
const MODE_LABEL_KEY = { METRO: 'transport_mrt', BUS: 'transport_bus', WALK: 'transport_walk', CYCLE: 'transport_cycle', GRAB: 'transport_grab' }
import { openGrab } from '../lib/grab'
import { cn } from '../lib/utils'
import TripMap from '../components/map/TripMap'
import AlertBanner from '../components/adaptation/AlertBanner'
import TripSetupModal from '../components/planner/TripSetupModal'
import SummaryTab from '../components/planner/SummaryTab'
import PlaceSearch from '../components/planner/PlaceSearch'
import BusArrivalPanel from '../components/transit/BusArrivalPanel'
import MrtInfoPanel from '../components/transit/MrtInfoPanel'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { Button } from '../components/ui/button'

// DEV25-BANNER-RETAINED: as of dev25 Phase 1, live alerts surface through the ChatWidget for
// logged-in users and guests get no alerts, so the on-page AlertBanner is not mounted. The
// component + its tests are intentionally kept; flip this flag to true to restore the banners
// (e.g. when re-enabling guest alerts). See docs/plans/dev25.md → "Banner preservation".
const ENABLE_TRIP_BANNERS = false
const MOBILE_SHEET_SNAPS = [10, 54, 100]
const PREVIEW_ROUTE_STYLE = { color: '#2563eb', halo: '#eff6ff', outline: '#1e3a8a', dashArray: null }

function snapMobileSheetHeight(value) {
  return MOBILE_SHEET_SNAPS.reduce((best, candidate) => (
    Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best
  ), MOBILE_SHEET_SNAPS[0])
}

function getSessionId() {
  try { return localStorage.getItem('session_id') } catch { return null }
}

// dev20: current Singapore wall-clock as minute-of-day (0–1439) for closing-risk projection.
function sgtMinuteOfDay() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return (h * 60 + m) % 1440
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
  const { t } = useT()
  const meta = transportMeta(mode)
  const Icon = meta.Icon
  const labelKey = MODE_LABEL_KEY[normalizeTransportMode(mode)]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-bold', meta.tone)}>
      <Icon size={12} />
      {labelKey ? t(labelKey) : meta.label}
    </span>
  )
}

function CompactPlaceCard({ place, role, onRemove }) {
  const { t } = useT()
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
          {isTo ? t('tripDestination') : t('tripStartingFrom')}
        </p>
        <p className="font-display font-bold text-[15px] text-slate-900 truncate">{place.name}</p>
        {(place.dwell_minutes ?? 0) > 0 && (
          <p className="text-[11.5px] text-slate-500 mt-0.5">⏱ {t('tripMinVisit', place.dwell_minutes)}</p>
        )}
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 grid h-7 w-7 place-items-center rounded text-slate-300 hover:text-red-500"
          title={t('tripRemove')}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

function PlaceCard({ place, onRemove, arriveAt, departAt }) {
  const { t } = useT()
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex gap-4">
        <div className="h-24 w-28 shrink-0 overflow-hidden rounded-[10px] bg-gradient-to-br from-blue-50 via-emerald-50 to-amber-50">
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
                <span className={cn('rounded-md px-2 py-1 text-[11px] font-bold capitalize', categoryChip(place.category))}>
                  {place.category || t('tripCategoryFallback')}
                </span>
                <span className="rounded-md bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-500">
                  {t('tripMinShort', place.dwell_minutes ?? place.suggested_duration_minutes ?? 60)}
                </span>
                {arriveAt && (
                  <span className="rounded-md bg-slate-50 px-2 py-1 text-[11px] font-bold text-slate-500 tabular-nums">
                    <Clock size={10} className="inline mr-0.5" />{arriveAt} – {departAt}
                  </span>
                )}
                {place.close_days?.length > 0 && (
                  <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">
                    {t('tripClosed', place.close_days.join(', '))}
                  </span>
                )}
              </div>
            </div>
            {onRemove && (
              <button
                onClick={onRemove}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-300 hover:bg-red-50 hover:text-red-500"
                title={t('tripRemovePlace')}
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
              <p><Clock size={12} className="mr-1 inline text-slate-400" />{t('tripBestTime', place.best_time_start, place.best_time_end)}</p>
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
  const { t } = useT()
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
  const [showCompare, setShowCompare] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
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
        const fromName = (tripStarted && position) ? t('tripYourLocation') : (from?.name ?? '')
        const toName   = to?.name ?? ''
        openGrab(
          { fromLat: pickup.lat, fromLng: pickup.lng, toLat: to?.lat, toLng: to?.lng, fromName, toName },
          ({ appOpened }) => onWarning?.(appOpened
            ? t('tripGrabOpened', fromName, toName)
            : t('tripGrabNotFound', fromName, toName)
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
    if (compare) {
      setShowCompare((prev) => !prev)
      return
    }
    setCompareLoading(true)
    try {
      setCompare(await api.compareRoutes(from.lat, from.lng, to.lat, to.lng))
      setShowCompare(true)
    } catch (err) {
      onWarning?.(err.message)
    } finally {
      setCompareLoading(false)
    }
  }

  const modeKey = normalizeTransportMode(leg.transport_mode)
  // Citymapper-style line badge: first non-walk transit sub-leg's service number (e.g. "97", "EW")
  const lineBadge = (leg.sub_legs ?? []).find((s) => s.mode !== 'WALK' && s.route)?.route ?? null

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-card">
      <div className="flex items-center gap-3">
        {/* mode icon chip — tinted with the mode token */}
        <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border', meta.tone)}>
          <meta.Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[14px] font-bold text-slate-900">
              {MODE_LABEL_KEY[modeKey] ? t(MODE_LABEL_KEY[modeKey]) : meta.label}
            </span>
            {lineBadge && (
              <span
                className="inline-flex h-[17px] items-center rounded px-1.5 text-[10px] font-extrabold text-white"
                style={{ background: meta.color }}
              >
                {lineBadge}
              </span>
            )}
            {leg.is_estimated && (
              <span className="rounded-md bg-warning-50 px-1.5 py-0.5 text-[10px] font-bold text-warning-600">
                {t('tripEstimated')}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[12px] text-slate-500 tabular-nums">
            {formatDuration(leg.duration_minutes)} · {formatCost(leg.cost_sgd)}
            {leg.distance_km != null ? ` · ${Number(leg.distance_km).toFixed(1)} km` : ''}
          </p>
        </div>

        {/* Change dropdown — pill trigger, logic unchanged */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            onClick={() => setOpen((value) => !value)}
            className="flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-[12px] font-bold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-700"
          >
            {savingMode ? <Loader2 size={13} className="animate-spin" /> : <meta.Icon size={13} />}
            {t('tripChange')}
            <ChevronDown size={12} />
          </button>
          {open && (
            <div className="absolute right-0 top-11 z-30 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
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
                  {MODE_LABEL_KEY[option.mode] ? t(MODE_LABEL_KEY[option.mode]) : option.label}
                  {!option.available && (
                    <span className="ml-auto text-[10px] font-medium text-slate-300">N/A</span>
                  )}
                  {option.available
                    && normalizeTransportMode(leg.transport_mode) !== option.mode
                    && leg.alternatives?.[option.mode]?.is_estimated && (
                    <span
                      className="ml-auto text-[9px] font-semibold uppercase tracking-wide text-amber-500"
                      title={t('tripEstimated')}
                    >
                      ~{t('tripEstimated')}
                    </span>
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

      {/* route from → to */}
      <p className="mt-2 truncate text-[11.5px] text-slate-400">
        {t('tripRoute', from?.name ?? t('tripOrigin'), to?.name ?? t('tripDestination'))}
      </p>

      {tripStarted && modeKey === 'GRAB' && (
        <button
          onClick={() => {
            const pickup   = position ? { lat: position.lat, lng: position.lng } : { lat: from?.lat, lng: from?.lng }
            const fromName = position ? t('tripYourLocation') : (from?.name ?? '')
            const toName   = to?.name ?? ''
            openGrab(
              { fromLat: pickup.lat, fromLng: pickup.lng, toLat: to?.lat, toLng: to?.lng, fromName, toName },
              ({ appOpened }) => onWarning?.(appOpened
                ? t('tripGrabOpened', fromName, toName)
                : t('tripGrabNotFound', fromName, toName)
              ),
            )
          }}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-mode-taxi px-3.5 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
        >
          <Car size={13} /> {t('tripOpenGrab')}
        </button>
      )}

      {/* Route Mode Comparison & Transit Details Toggle (always available) */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={loadCompare}
          disabled={compareLoading}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-bold transition-colors disabled:opacity-60 animate-fade-in',
            showCompare
              ? 'border border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
              : 'border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
          )}
        >
          {compareLoading ? t('tripComparing') : t('tripCompareModes')}
          {compare && !compareLoading && (
            <ChevronDown size={12} className={cn('transition-transform duration-200', showCompare && 'rotate-180')} />
          )}
        </button>

        {leg.sub_legs?.length > 0 && (
          <button
            onClick={() => setShowDetails((prev) => !prev)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3.5 text-[12px] font-bold text-slate-700 transition-colors hover:border-blue-200 hover:text-blue-700"
          >
            {showDetails ? t('tripHideDetails') : t('tripShowDetails')}
            <ChevronDown size={12} className={cn('transition-transform duration-200', showDetails && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* Expandable Transit Sub-Legs Details (Walk -> Bus -> Walk breakdown) */}
      {leg.sub_legs?.length > 0 && showDetails && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 animate-fade-in">
          <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('tripTransitDetails')}</p>
          <div className="space-y-2.5">
            {leg.sub_legs.map((sub, index) => {
              const subMeta = transportMeta(sub.mode)
              const isLast = index === leg.sub_legs.length - 1
              return (
                <div key={index} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 bg-white" style={{ borderColor: subMeta.color }}>
                      <subMeta.Icon size={9} style={{ color: subMeta.color }} />
                    </span>
                    {!isLast && <span className="my-0.5 w-px flex-1 bg-slate-200" style={{ minHeight: 12 }} />}
                  </div>
                  <div className="min-w-0 flex-1 pb-2.5">
                    <p className="text-[12px] leading-snug text-slate-700">
                      {sub.route ? `[${sub.route}] ` : ''}{t('tripRoute', sub.from_name, sub.to_name)}
                    </p>
                    <p className="text-[11px] text-slate-400">{t('tripMinShort', sub.duration_minutes)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Mode Compare Results (shown when showCompare is true and data is loaded) */}
      {showCompare && compare && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 animate-fade-in">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{t('tripCompareModes')}</p>
            <button
              type="button"
              onClick={() => setShowCompare(false)}
              className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
              title={t('tripHideDetails') || 'Hide'}
            >
              <X size={13} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {Object.entries(compare).map(([key, value]) => {
              const normKey = normalizeTransportMode(key)
              const subMeta = transportMeta(normKey)
              return (
                <div key={key} className={cn("rounded-xl border p-2.5 flex flex-col justify-between shadow-sm transition hover:shadow-md", subMeta.tone)}>
                  <div className="flex items-center gap-1.5">
                    <subMeta.Icon size={12} className="shrink-0" />
                    <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">
                      {MODE_LABEL_KEY[normKey] ? t(MODE_LABEL_KEY[normKey]) : subMeta.label}
                    </p>
                  </div>
                  <div className="mt-1.5">
                    <p className="text-[13px] font-extrabold leading-tight">
                      {value.available ? formatDuration(value.duration_minutes) : t('tripUnavailable')}
                    </p>
                    {value.available && <p className="text-[10px] opacity-75 mt-0.5">{formatCost(value.fare_sgd)}</p>}
                  </div>
                </div>
              )
            })}
            
            {/* Grab card — always shown in compare, data from leg.alternatives */}
            {(() => {
              const grabMeta = transportMeta('GRAB')
              return (
                <div className={cn("rounded-xl border p-2.5 flex flex-col justify-between shadow-sm transition hover:shadow-md", grabMeta.tone)}>
                  <div className="flex items-center gap-1.5">
                    <grabMeta.Icon size={12} className="shrink-0" />
                    <p className="text-[10px] font-bold uppercase tracking-wide opacity-80">
                      {MODE_LABEL_KEY['GRAB'] ? t(MODE_LABEL_KEY['GRAB']) : 'Grab'}
                    </p>
                  </div>
                  <div className="mt-1.5">
                    <p className="text-[13px] font-extrabold leading-tight">
                      {leg.alternatives?.GRAB ? formatDuration(leg.alternatives.GRAB.duration_minutes) : '—'}
                    </p>
                    {leg.alternatives?.GRAB && (
                      <p className="text-[10px] opacity-75 mt-0.5">
                        {formatCost(leg.alternatives.GRAB.fare_sgd)} · {t('tripEstimated')}
                      </p>
                    )}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Live transit panels — bus arrivals + MRT info, only when trip has started */}
      {tripStarted && (
        <>
          {/* Bus: panel for direct BUS leg or BUS sub-legs inside intermodal routes */}
          {(leg.first_bus_stop_code || (normalizeTransportMode(leg.transport_mode) !== 'BUS' && leg.sub_legs?.some(s => s.mode === 'BUS' && s.from_stop_code))) && (
            <div className="mt-3 space-y-3 animate-fade-in">
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
                        {t('tripBusLabel', sub.route, sub.from_name)}
                      </p>
                      <BusArrivalPanel stopCode={sub.from_stop_code} serviceFilter={sub.route ?? null} />
                    </div>
                  ))
              }
            </div>
          )}

          {/* MRT: frequency estimate + optional PCDRealtime crowd density */}
          {(normalizeTransportMode(leg.transport_mode) === 'METRO' || leg.sub_legs?.some(s => s.mode === 'METRO')) && (
            <MrtInfoPanel
              stationCode={leg.sub_legs?.find((s) => s.mode === 'METRO')?.from_stop_code || null}
              subLegs={leg.sub_legs ?? []}
            />
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

function SortablePlaceItem({ place, visitIndex, times, tripStarted, onRemovePlace, onPreviewPlace, dayNum }) {
  const { t } = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: place.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  }
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
      {!tripStarted && (
        <button {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-slate-300 hover:text-slate-500 active:cursor-grabbing" aria-label="Drag to reorder">
          <GripVertical size={14} />
        </button>
      )}
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[11px] font-extrabold text-blue-600">
        {visitIndex + 1}
      </span>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onPreviewPlace?.(place)}
          className="block max-w-full truncate text-left text-[13px] font-bold text-slate-700 hover:text-blue-700"
          title={place.name}
        >
          {place.name}
        </button>
        {times && (
          <p className="text-[10.5px] text-slate-400 tabular-nums">{times.arrive} – {times.depart}</p>
        )}
      </div>
      <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold capitalize', categoryChip(place.category))}>
        {place.category || t('tripCategoryFallback')}
      </span>
      {!tripStarted && (
        <button
          onClick={() => onRemovePlace(place.id, dayNum)}
          className="shrink-0 text-slate-300 hover:text-red-500"
          title={t('tripRemove')}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}

function Overview({ trip, allPlacesById, pendingByDay, pendingTimes, onSelectDay, onAddPlace, onRemovePlace, onPreviewPlace, onReorder, onDragReorder, onUpdateRoute, onOptimiseOrder, onStartTrip, tripStarted, startTimeForDay, needsRouteUpdate, mutating }) {
  const { t } = useT()
  const [routeDropdownOpen, setRouteDropdownOpen] = useState(false)
  const [warningsOpen, setWarningsOpen] = useState(false)
  const [activeDragId, setActiveDragId] = useState(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <h2 className="font-display text-[24px] font-extrabold text-slate-950">{t('tripOverview')}</h2>
          <p className="mt-1 text-[13px] text-slate-500">{t('tripOverviewDesc')}</p>
        </div>
        {!tripStarted && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            {needsRouteUpdate ? (
              <div className="relative">
                <Button
                  onClick={() => setRouteDropdownOpen((v) => !v)}
                  disabled={mutating}
                  className="w-full sm:w-auto"
                >
                  {mutating ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  {t('tripUpdateRoute')}
                  <ChevronDown size={13} className={cn('ml-1 transition-transform', routeDropdownOpen && 'rotate-180')} />
                </Button>
                {routeDropdownOpen && (
                  <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-md border border-slate-200 bg-white shadow-pop">
                    <button
                      onClick={() => { setRouteDropdownOpen(false); onUpdateRoute(true) }}
                      disabled={mutating}
                      className={cn(
                        'flex w-full flex-col px-4 py-3 text-left hover:bg-slate-50',
                        mutating && 'cursor-not-allowed opacity-40'
                      )}
                    >
                      <span className="text-[13px] font-bold text-slate-800">{t('tripKeepOrder')}</span>
                      <span className="text-[11px] text-slate-500">{t('tripKeepOrderDesc')}</span>
                    </button>
                    <div className="border-t border-slate-100" />
                    <button
                      onClick={() => { setRouteDropdownOpen(false); onUpdateRoute(false) }}
                      disabled={mutating}
                      className="flex w-full flex-col px-4 py-3 text-left hover:bg-slate-50 disabled:opacity-40"
                    >
                      <span className="text-[13px] font-bold text-slate-800">{t('tripLetAIOptimise')}</span>
                      <span className="text-[11px] text-slate-500">{t('tripLetAIOptimiseDesc')}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={onOptimiseOrder}
                disabled={mutating}
                className="w-full border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-700 sm:w-auto"
              >
                <Sparkles size={15} /> {t('tripOptimiseOrder')}
              </Button>
            )}
            {onStartTrip && (
              <Button variant="success" onClick={onStartTrip} className="w-full sm:w-auto">
                <Navigation2 size={15} /> {t('tripStartTrip')}
              </Button>
            )}
          </div>
        )}
      </div>

      {trip.warnings?.length > 0 && (
        <div role="alert" className="overflow-hidden rounded-lg border border-amber-200 bg-amber-50">
          {/* Collapsible: keep notices in place but let the user shrink them so a long, wordy
              warning (e.g. "some days seem a little packed") never blocks the view. */}
          <button
            type="button"
            onClick={() => setWarningsOpen((v) => !v)}
            aria-expanded={warningsOpen}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="text-[13px] font-bold text-amber-800">{t('tripWarningsTitle', trip.warnings.length)}</span>
            <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-amber-600 transition-transform', warningsOpen && 'rotate-180')} />
          </button>
          {warningsOpen && (
            <div className="space-y-1 px-4 pb-3 pl-10">
              {trip.warnings.map((warning, index) => (
                <p key={index} className="text-[13px] font-medium leading-relaxed text-amber-800">{warning}</p>
              ))}
            </div>
          )}
        </div>
      )}


      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
          const dayStartTime = startTimeForDay?.(day.day) ?? '09:00'
          const serverPlaceTimes = computePlaceTimes(day, allPlacesById, dayStartTime)
          const placeTimes = isDirty ? (pendingTimes[day.day] ?? serverPlaceTimes) : serverPlaceTimes
          // Total transit includes all legs (hotel→first and last→hotel)
          const transitMin = (day.legs ?? []).reduce((s, l) => s + (l.duration_minutes ?? 0), 0)

          const hasHotelStart = day.legs?.[0]?.from_place_id === 'hotel'
          const hasHotelEnd   = (day.legs?.length ?? 0) > 0 && day.legs[day.legs.length - 1]?.to_place_id === 'hotel'
          const firstTime = hasHotelStart
            ? dayStartTime
            : (visitPlaces[0] ? placeTimes[visitPlaces[0].id]?.arrive : null)
          const lastTime = hasHotelEnd
            ? placeTimes['hotel']?.arrive
            : (visitPlaces.at(-1) ? placeTimes[visitPlaces.at(-1).id]?.depart : null)

          return (
            <section key={day.day} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
              <div className="mb-4 flex items-start justify-between gap-3">
                <button onClick={() => onSelectDay(day.day)} className="text-left">
                  <span className="inline-flex items-center gap-1.5 rounded-[9px] bg-info-50 px-2.5 py-1 font-display text-[13px] font-bold text-blue-600">
                    <Calendar size={14} /> {t('tripDay', day.day)}
                  </span>
                  <p className="mt-2 text-[12px] text-slate-500">
                    {t('tripStopsCount', visitPlaces.length)} · {formatCost(stats.cost)}
                  </p>
                  {firstTime && lastTime && (
                    <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
                      {firstTime} – {lastTime} · {formatDuration(transitMin)} {t('tripTransit')}
                    </p>
                  )}
                </button>
                {!tripStarted && (
                  <button
                    onClick={() => onAddPlace(day.day)}
                    className="grid h-8 w-8 place-items-center rounded-[10px] border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    title={t('tripAddPlace')}
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>

              {/* Photo strip — gives each day card life (place imagery), like Wanderlog day cards */}
              {visitPlaces.length > 0 && (
                <div className="mb-3 flex gap-1 overflow-hidden rounded-[10px]">
                  {visitPlaces.slice(0, 4).map((p) => (
                    <div key={p.id} className="h-[58px] flex-1 overflow-hidden bg-gradient-to-br from-blue-50 via-emerald-50 to-amber-50">
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt=""
                          className="h-full w-full object-cover"
                          onError={(event) => { event.currentTarget.style.display = 'none' }}
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center" style={{ color: categoryHex(p.category) }}>
                          <MapPin size={16} />
                        </div>
                      )}
                    </div>
                  ))}
                  {visitPlaces.length > 4 && (
                    <div className="grid h-[58px] w-11 shrink-0 place-items-center bg-slate-900/80 text-[12px] font-bold text-white">
                      +{visitPlaces.length - 4}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {/* Hotel start pin — always first, not reorderable */}
                {hotelPlace && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <Building2 size={13} className="shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">{t('tripHotel')}</p>
                      <p className="truncate text-[12px] font-bold text-slate-700">{hotelPlace.name}</p>
                    </div>
                  </div>
                )}

                {/* Reorderable sightseeing places — drag-and-drop */}
                {visitPlaces.length > 0 ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={({ active }) => setActiveDragId(active.id)}
                    onDragEnd={({ active, over }) => {
                      setActiveDragId(null)
                      if (!over || active.id === over.id) return
                      const ids = visitPlaces.map((p) => p.id)
                      const oldIdx = ids.indexOf(active.id)
                      const newIdx = ids.indexOf(over.id)
                      if (oldIdx === -1 || newIdx === -1) return
                      onDragReorder(day.day, arrayMove(ids, oldIdx, newIdx))
                    }}
                    onDragCancel={() => setActiveDragId(null)}
                  >
                    <SortableContext items={visitPlaces.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                      {visitPlaces.map((place, visitIndex) => (
                        <SortablePlaceItem
                          key={place.id}
                          place={place}
                          visitIndex={visitIndex}
                          times={placeTimes[place.id]}
                          tripStarted={tripStarted}
                          onRemovePlace={onRemovePlace}
                          onPreviewPlace={onPreviewPlace}
                          dayNum={day.day}
                        />
                      ))}
                    </SortableContext>
                    <DragOverlay>
                      {activeDragId ? (() => {
                        const dragPlace = visitPlaces.find((p) => p.id === activeDragId)
                        if (!dragPlace) return null
                        const dragIdx = visitPlaces.indexOf(dragPlace)
                        return (
                          <div className="flex items-center gap-2 rounded-md bg-white px-3 py-2 shadow-lg border border-blue-200 ring-2 ring-blue-100">
                            <GripVertical size={14} className="shrink-0 text-blue-400" />
                            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-50 text-[11px] font-extrabold text-blue-600">
                              {dragIdx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-bold text-slate-700">{dragPlace.name}</p>
                            </div>
                            <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold capitalize', categoryChip(dragPlace.category))}>
                              {dragPlace.category || t('tripCategoryFallback')}
                            </span>
                          </div>
                        )
                      })() : null}
                    </DragOverlay>
                  </DndContext>
                ) : !hotelPlace && (
                  <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-[13px] text-slate-400">
                    {t('tripEmptyDay')}
                  </div>
                )}

                {/* Hotel end pin — always last, not reorderable */}
                {hotelPlace && (
                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                    <Building2 size={13} className="shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">{t('tripReturnHotel')}</p>
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

              {/* Transport mode badges — shows which modes are used this day */}
              {(() => {
                const dayModes = [...new Set((day.legs ?? []).map((l) => normalizeTransportMode(l.transport_mode)))]
                return dayModes.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {dayModes.map((mode) => (
                      <TransportBadge key={mode} mode={mode} />
                    ))}
                  </div>
                ) : null
              })()}

            </section>
          )
        })}
      </div>
    </div>
  )
}

function DayView({ day, placesById, tripId, tripStarted, position, activeLegIndex, onUpdated, onWarning, onRemovePlace, onMarkArrived, onContinue, onGoBack, canGoBack, arrivedPending, onAddPlace, startTime, gapNotifications = [] }) {
  const { t } = useT()
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
            <h2 className="font-display text-[20px] font-extrabold text-slate-950">{t('tripActiveLeg')}</h2>
            <p className="mt-0.5 text-[13px] text-slate-500">
              {t('tripLegProgress', day.day, activeLegIndex + 1, day.legs?.length ?? 1)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canGoBack && (
              <Button variant="outline" onClick={onGoBack} title={t('tripGoBackTitle')}>
                <ArrowLeft size={15} /> {t('tripBack')}
              </Button>
            )}
            <div className="relative">
              <Button variant="success" onClick={arrivedPending ? onContinue : onMarkArrived}>
                {arrivedPending
                  ? <><Navigation2 size={15} /> {t('tripContinue')}</>
                  : <><CheckCircle size={15} /> {t('tripArrived')}</>}
              </Button>
              {arrivedPending && (
                <span className="absolute -right-1 -top-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-teal-500" />
                </span>
              )}
            </div>
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
          <h2 className="font-display text-[24px] font-extrabold text-slate-950">{t('tripDay', day.day)}</h2>
          <p className="mt-1 text-[13px] text-slate-500">{t('tripDayDesc')}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => onAddPlace(day.day)}
          className="border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-700"
        >
          <Plus size={15} /> {t('tripAddPlace')}
        </Button>
      </div>

      {dayGaps.length > 0 && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 animate-fade-in">
          <p className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-blue-700">{t('tripLongCommutes')}</p>
          <div className="space-y-2">
            {dayGaps.map((gap, index) => (
              <div key={index} className="rounded-md bg-white px-3 py-2 text-[13px] text-blue-900 shadow-sm animate-fade-in">
                <span className="font-bold">{gap.gap_start}–{gap.gap_end}</span>
                <span className="text-blue-700"> · {gap.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length ? (() => {
        // Citymapper timeline: continuous left rail; place nodes coloured by category
        // (hotel = amber), transit cards sit indented between them.
        const rows = hasReturnToHotel
          ? [...items, { type: 'place', place: placesById['hotel'], _return: true }]
          : items
        const lastIdx = rows.length - 1
        return (
          <div>
            {rows.map((item, index) => {
              const isPlace = item.type === 'place'
              const isLast = index === lastIdx
              const dotColor = isPlace
                ? (item.place.id === 'hotel' ? '#d97706' : categoryHex(item.place.category))
                : null
              return (
                <div
                  key={isPlace ? `place-${item.place.id}${item._return ? '-ret' : ''}` : `leg-${item.leg.id}-${index}`}
                  className="flex gap-3"
                >
                  <div className="flex w-[18px] shrink-0 flex-col items-center pt-5">
                    {isPlace ? (
                      <span
                        className="h-[18px] w-[18px] shrink-0 rounded-full border-[3px] border-white shadow-[0_1px_4px_rgba(0,0,0,0.18)]"
                        style={{ background: dotColor }}
                      />
                    ) : (
                      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                    )}
                    {!isLast && <span className="mt-1 w-0.5 flex-1 bg-slate-200" />}
                  </div>
                  <div className="min-w-0 flex-1 pb-3">
                    {isPlace ? (
                      <PlaceCard
                        place={item.place}
                        arriveAt={placeTimes[item.place.id]?.arrive}
                        departAt={item._return ? undefined : placeTimes[item.place.id]?.depart}
                        onRemove={item.place.id === 'hotel' ? undefined : () => onRemovePlace(item.place.id)}
                      />
                    ) : (
                      <LegCard
                        leg={item.leg}
                        from={item.from}
                        to={item.to}
                        tripId={tripId}
                        tripStarted={tripStarted}
                        position={position}
                        onUpdated={onUpdated}
                        onWarning={onWarning}
                        open={openLegId === item.leg.id}
                        onOpenChange={(next) => setOpenLegId(next ? item.leg.id : null)}
                      />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })() : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <MapPin className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-[14px] font-bold text-slate-600">{t('tripNoLegs')}</p>
          <Button onClick={() => onAddPlace(day.day)} className="mt-4">
            <Plus size={15} /> {t('tripAddPlace')}
          </Button>
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
  const { alerts, dismiss } = useAlerts(user ? id : null)
  const { position, error: geoError } = useGeolocation()
  const { t } = useT()
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
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [mutating, setMutating] = useState(false)
  const [optimizeMsg, setOptimizeMsg] = useState(null)
  const [mapOpen, setMapOpen] = useState(true)   // collapse the map to give the left panel full width
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
  const [confirmOptimise, setConfirmOptimise] = useState(false)
  // Task 8: live GPS trail (only for WALK/CYCLE legs)
  const [trackingPath, setTrackingPath] = useState([])
  const lastTrackPointRef = useRef(null)
  const [mobileSheetHeight, setMobileSheetHeight] = useState(54)
  const [isMobileSheetDragging, setIsMobileSheetDragging] = useState(false)
  const [previewPlace, setPreviewPlace] = useState(null)
  const mobileSheetTop = `calc(56px + ${100 - mobileSheetHeight}dvh)`

  const startMobileSheetDrag = useCallback((event) => {
    if (typeof window === 'undefined' || window.matchMedia?.('(min-width: 1024px)').matches) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = mobileSheetHeight
    let moved = false
    setIsMobileSheetDragging(true)
    document.body.style.userSelect = 'none'
    const onMove = (moveEvent) => {
      moveEvent.preventDefault()
      const delta = startY - moveEvent.clientY
      if (Math.abs(delta) > 4) moved = true
      const next = startHeight + (delta / window.innerHeight) * 100
      setMobileSheetHeight(Math.max(MOBILE_SHEET_SNAPS[0], Math.min(MOBILE_SHEET_SNAPS[2], next)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      setIsMobileSheetDragging(false)
      if (!moved) {
        setMobileSheetHeight((height) => (height >= 90 ? 54 : height <= 20 ? 54 : 100))
        return
      }
      setMobileSheetHeight((height) => snapMobileSheetHeight(height))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [mobileSheetHeight])

  const previewPlaceOnMobile = useCallback((place) => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches) return
    setMobileSheetHeight(10)
    setPreviewPlace(place)
  }, [])

  useEffect(() => {
    if (!previewPlace || typeof window === 'undefined' || !window.matchMedia) return undefined
    const media = window.matchMedia('(min-width: 1024px)')
    const clearDesktopPreview = () => {
      if (media.matches) setPreviewPlace(null)
    }
    clearDesktopPreview()
    media.addEventListener?.('change', clearDesktopPreview)
    return () => media.removeEventListener?.('change', clearDesktopPreview)
  }, [previewPlace])

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
  const effectiveMeta = useMemo(() => ({ ...(pendingSave ?? {}), ...(savedMeta ?? {}) }), [pendingSave, savedMeta])
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
  const startTimeForDay = (dayNum) => {
    const times = effectiveMeta?.dayStartTimes ?? effectiveMeta?.day_start_times
    if (Array.isArray(times) && times[dayNum - 1]) return times[dayNum - 1]
    return effectiveMeta?.startTime ?? '09:00'
  }

  // Chatbot confirmed a write → refresh the itinerary from the server.
  useEffect(() => {
    const onTripUpdated = (e) => { refresh(e.detail) }
    window.addEventListener('imove:trip-updated', onTripUpdated)
    return () => window.removeEventListener('imove:trip-updated', onTripUpdated)
  }, [refresh])

  // Estimated times for pending (dirty) days — computed purely from haversine, no API call
  const pendingTimes = useMemo(() => {
    if (!hasDirtyDays) return {}
    const hotel = allPlacesById['hotel'] ?? null
    const result = {}
    for (const [dayStr, placeIds] of Object.entries(pendingByDay)) {
      const places = placeIds.map((pid) => allPlacesById[pid]).filter(Boolean)
      result[Number(dayStr)] = computeHaversineTimes(places, hotel, startTimeForDay(Number(dayStr)))
    }
    return result
  }, [pendingByDay, allPlacesById, effectiveMeta, hasDirtyDays])

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
      // Other days' places are hidden entirely (not just dimmed) to declutter the live map.
      const todayIds = activeDayPlaceIds ?? new Set((trip.places ?? []).map(p => p.id))
      return (trip.places ?? [])
        .filter(p => todayIds.has(p.id))
        .filter(p => !visitedIds.has(p.id) || activeIds.has(p.id))
        .map(p => ({ ...p, _dim: !activeIds.has(p.id) }))
    }
    // Include pending places not yet on server as additional pins (no polylines — map stays clean)
    const serverIds = new Set((trip.places ?? []).map((p) => p.id))
    const pendingPins = Object.values(pendingPlaces).filter((p) => !serverIds.has(p.id))
    return [...(trip.places ?? []), ...pendingPins]
  }, [trip, isLive, currentDay, activeLeg, activeLegIndex, pendingPlaces, activeDayPlaceIds])

  const previewMap = useMemo(() => {
    if (!previewPlace || !trip) return null

    const sourceDay = (trip.days ?? []).find((day) => (
      timelineForDay(day, allPlacesById)
        .some((item) => item.type === 'place' && item.place.id === previewPlace.id)
    ))
    if (!sourceDay) {
      return {
        places: [previewPlace],
        legs: [],
        markerPlaceIds: new Set([previewPlace.id]),
        activeDayPlaceIds: new Set([previewPlace.id]),
        placeSequences: { [previewPlace.id]: placeSequences[previewPlace.id] },
      }
    }

    const items = timelineForDay(sourceDay, allPlacesById)
    const previewIndex = items.findIndex((item) => (
      item.type === 'place' && item.place.id === previewPlace.id
    ))
    const routePlaceIds = new Set([previewPlace.id])
    const legs = []

    for (let index = 0; index <= previewIndex; index += 1) {
      const item = items[index]
      if (!item) continue
      if (item.type === 'place') {
        routePlaceIds.add(item.place.id)
      } else if (item.type === 'leg') {
        legs.push(item.leg)
        if (item.leg.from_place_id) routePlaceIds.add(item.leg.from_place_id)
        if (item.leg.to_place_id) routePlaceIds.add(item.leg.to_place_id)
      }
    }

    const places = [...routePlaceIds].map((placeId) => allPlacesById[placeId]).filter(Boolean)
    return {
      places,
      legs,
      markerPlaceIds: new Set([previewPlace.id]),
      activeDayPlaceIds: new Set([previewPlace.id]),
      placeSequences: { [previewPlace.id]: placeSequences[previewPlace.id] },
    }
  }, [previewPlace, trip, allPlacesById, placeSequences])

  const effectiveMapPlaces = previewMap?.places ?? mapPlaces
  const effectiveMapLegs = previewMap?.legs ?? mapLegs
  const effectiveMarkerPlaceIds = previewMap?.markerPlaceIds ?? null
  const effectiveActiveDayPlaceIds = previewMap?.activeDayPlaceIds ?? activeDayPlaceIds
  const effectivePlaceSequences = previewMap?.placeSequences ?? placeSequences

  useEffect(() => {
    if (!trip?.days?.length) return
    if (!trip.days.some((day) => day.day === selectedDay)) setSelectedDay(trip.days[0].day)
  }, [trip, selectedDay])

  useEffect(() => {
    const tripStartDate = effectiveMeta?.start_date ?? effectiveMeta?.startDate
    if (!tripStartDate || tripStarted) return
    const today = new Date().toISOString().slice(0, 10)
    if (tripStartDate === today) setTodayBanner(true)
  }, [effectiveMeta, tripStarted])

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

  useEffect(() => {
    sessionStorage.setItem(`imove_selected_day_${id}`, String(selectedDay))
  }, [selectedDay, id])

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
              // A newly added/removed place leaves the day on haversine estimates even when the
              // visit order is unchanged (e.g. a place appended to the end). Reorder
              // (force_real_routes) whenever the day still has a non-GRAB estimated leg — not
              // only when the order differs — otherwise the new leg stays "Estimated".
              const orderChanged = JSON.stringify(finalIds) !== JSON.stringify(freshIds)
              const dayHasEstimated = (freshDay.legs ?? []).some(
                (l) => l.is_estimated && normalizeTransportMode(l.transport_mode) !== 'GRAB'
              )
              lastResult = (orderChanged || dayHasEstimated)
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
      // Surface OneMap-overload leftovers like the optimise path does, so a still-estimated
      // result isn't silent (parity with handleConfirmOptimise).
      const estimatedAfter = (lastResult?.days ?? []).flatMap((d) => d.legs ?? [])
        .filter((l) => l.is_estimated && normalizeTransportMode(l.transport_mode) !== 'GRAB').length
      if (estimatedAfter > 0) {
        setOptimizeMsg(t('tripMsgEstimatedLegs', estimatedAfter))
        setTimeout(() => setOptimizeMsg(null), 4000)
      }
    } catch (err) {
      setUiWarning(err.message)
      // A failure part-way through the sequence (e.g. OneMap overload on the final reorder) can
      // still leave the earlier add/remove persisted on the server. Re-sync from the authoritative
      // trip so Overview reflects what actually changed instead of silently keeping the pre-edit
      // places (the optimistic lastResult was never applied because we threw before refresh).
      await refresh()
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
      const orderAfter = (result?.days ?? []).flatMap((d) => (d.legs ?? []).map((l) => l.from_place_id))
      const daysAfter  = result?.days?.length ?? 0
      const reordered  = orderAfter.filter((v, i) => v !== orderBefore[i]).length
      const estimatedAfter = countEstimated(result?.days)
      if (daysAfter !== daysBefore) {
        setOptimizeMsg(t('tripMsgDistributed', daysAfter))
      } else if (reordered > 0) {
        setOptimizeMsg(t('tripMsgReordered', reordered))
      } else if (estimatedBefore > 0 && estimatedAfter === 0) {
        setOptimizeMsg(t('tripMsgRoutesUpdated'))
      } else if (estimatedAfter > 0) {
        setOptimizeMsg(
          t('tripMsgEstimatedLegs', estimatedAfter)
        )
      } else {
        setOptimizeMsg(t('tripMsgAlreadyOptimal'))
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
    setPendingByDay((prev) => ({ ...prev, [dayNum]: next }))
  }

  // Drag-and-drop reorder — accepts the full new order array from @dnd-kit
  const dragReorder = useCallback((dayNum, newIds) => {
    setPendingByDay((prev) => ({ ...prev, [dayNum]: newIds }))
  }, [])

  const startDay = (dayNum) => {
    setTripStarted(true)
    setSelectedDay(dayNum)
    setActiveLegIndex(0)
    setActiveTab(`day-${dayNum}`)
    api.checkAlerts(id, { session_id: getSessionId(), active_day: dayNum, active_leg_index: 0 }).catch(() => {})
  }

  // Task 7: step 1 — mark arrived; user sees Continue banner before leg advances.
  // dev20: capture the real arrival minute so the closing-risk projection can use
  // max(now, arrived + dwell) for the stop the user is now dwelling at. The active leg's
  // to_place is where they are → represent that as the *next* leg's from_place (idx + 1).
  const markArrived = () => {
    setArrivedPending(true)
    const arrived = sgtMinuteOfDay()
    sessionStorage.setItem(`imove_arrived_at_${id}`, String(arrived))
    api.checkAlerts(id, {
      session_id: getSessionId(), active_day: selectedDay,
      active_leg_index: activeLegIndex + 1, arrived_at_min: arrived,
    }).catch(() => {})
  }

  // Task 7: step 2 — record the real departure time, then advance to the next leg.
  const advanceLeg = () => {
    autoArrivedRef.current = false
    setArrivedPending(false)
    sessionStorage.removeItem(`imove_arrived_at_${id}`)
    setTrackingPath([])
    lastTrackPointRef.current = null
    const day = trip?.days?.find((item) => item.day === selectedDay)
    if (!day) return
    const nextIdx = activeLegIndex + 1
    api.checkAlerts(id, {
      session_id: getSessionId(), active_day: selectedDay,
      active_leg_index: nextIdx, anchor_min: sgtMinuteOfDay(),
    }).catch(() => {})
    if (activeLegIndex < (day.legs?.length ?? 0) - 1) {
      setActiveLegIndex(nextIdx)
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

  // Undo an accidental "Arrived" tap: cancel the pending Continue, or step back
  // to the previous leg (or previous day's last leg) if no Continue is pending.
  const goBackLeg = () => {
    autoArrivedRef.current = false
    if (arrivedPending) {
      setArrivedPending(false)
      return
    }
    setTrackingPath([])
    lastTrackPointRef.current = null
    if (activeLegIndex > 0) {
      setActiveLegIndex((value) => value - 1)
      return
    }
    const prevDay = trip?.days?.find((item) => item.day === selectedDay - 1)
    if (prevDay) {
      setSelectedDay(prevDay.day)
      setActiveLegIndex((prevDay.legs?.length ?? 1) - 1)
      setActiveTab(`day-${prevDay.day}`)
    }
  }

  const canGoBack = arrivedPending
    || activeLegIndex > 0
    || !!trip?.days?.find((item) => item.day === selectedDay - 1)

  if (loading) {
    return (
      <main aria-label="Loading trip" className="grid min-h-[calc(100dvh-56px)] place-items-center bg-slate-50">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
      </main>
    )
  }

  if (error || !trip) {
    const message = error?.status === 403
      ? t('tripAccessDenied')
      : error?.status === 401
        ? t('tripLoginRequired')
        : String(error?.message ?? t('tripNotFound'))

    return (
      <main className="grid min-h-[calc(100dvh-56px)] place-items-center bg-gradient-to-br from-slate-50 via-white to-blue-50/60 px-6">
        <div className="w-full max-w-[420px] rounded-3xl border border-slate-100 bg-white/95 p-8 text-center shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-red-50 text-red-600 shadow-inner">
            <Lock className="h-9 w-9" aria-hidden="true" />
          </div>
          <h1 className="mt-6 font-display text-2xl font-extrabold text-slate-950">
            {t('tripUnavailableTitle')}
          </h1>
          <p className="mx-auto mt-3 max-w-[300px] text-sm font-medium leading-6 text-slate-500">
            {t('tripUnavailableBody', message)}
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Button variant="outline" size="lg" onClick={() => navigate('/')} className="w-full">
              <Home className="h-4 w-4" aria-hidden="true" />
              {t('tripBackHome')}
            </Button>
            <Button size="lg" onClick={() => navigate('/plan')} className="w-full">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('tripStartNew')}
            </Button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-[calc(100dvh-56px)] flex-col bg-white lg:h-[calc(100dvh-56px)] lg:overflow-hidden">
      <header className={cn('shrink-0 border-b border-slate-200 bg-white px-4 py-2 sm:px-6 sm:py-4', previewPlace && 'hidden lg:block')}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <button onClick={() => navigate('/')} className="grid h-9 w-9 place-items-center rounded-md text-slate-500 hover:bg-slate-100">
              <ArrowLeft size={17} />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-[21px] font-extrabold text-slate-950 sm:text-[22px]">
                  {effectiveMeta?.name ?? t('tripDefaultName')}
                </h1>
                {/* Status Badges integrated directly into header */}
                <span className={cn(
                  'hidden items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border shrink-0 lg:inline-flex',
                  isLive
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : tripStarted && editMode
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                )}>
                  {isLive ? (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  ) : tripStarted && editMode ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  )}
                  {isLive
                    ? t('tripBannerLive', selectedDay)
                    : tripStarted && editMode
                      ? t('tripBannerEdit')
                      : t('tripBannerPlanning')}
                </span>
                {!isLive && (
                  <span className={cn(
                    'hidden items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold border shrink-0 lg:inline-flex',
                    needsRouteUpdate
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  )}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', needsRouteUpdate ? 'bg-amber-500' : 'bg-emerald-500')} />
                    {needsRouteUpdate ? t('tripEstimated') : t('tripGoodToGo')}
                  </span>
                )}
              </div>
              <p className="mt-1 hidden text-[12px] font-semibold text-slate-400 lg:block">
                {t('tripDaysCount', trip.days?.length ?? 0)} · {t('tripPlacesCount', trip.places?.length ?? 0)}
              </p>
            </div>
          </div>

          <nav className="hidden w-full items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1 scroll-thin lg:flex lg:w-auto">
            <button
              onClick={() => setActiveTab('overview')}
              className={cn('h-9 shrink-0 whitespace-nowrap rounded-md px-3 text-[13px] font-bold', activeTab === 'overview' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500')}
            >
              {t('tripOverview')}
            </button>
            {(trip.days ?? []).map((day) => (
              <div key={day.day} className="flex shrink-0 items-center">
                <button
                  onClick={() => !needsRouteUpdate && selectDayTab(day.day)}
                  disabled={needsRouteUpdate}
                  title={needsRouteUpdate ? t('tripUpdateRoutesFirst') : undefined}
                  className={cn('h-9 whitespace-nowrap rounded-md px-3 text-[13px] font-bold',
                    needsRouteUpdate
                      ? 'cursor-not-allowed opacity-40 text-slate-400'
                      : selectedDay === day.day && activeTab.startsWith('day-') ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
                  )}
                >
                  {t('tripDay', day.day)}
                </button>
                {(trip.days?.length ?? 0) > 1 && !isLive && (
                  <button
                    onClick={() => removeDay(day.day)}
                    className="mr-1 grid h-7 w-7 place-items-center rounded text-slate-300 hover:bg-red-50 hover:text-red-500"
                    title={t('tripRemoveDay')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            {/* Add day — co-located with the day tabs (browser-tab "+" pattern), not by settings */}
            {!isLive && (
              <button
                onClick={addDay}
                disabled={mutating}
                title={t('tripAddDay')}
                className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-blue-600 disabled:opacity-50"
              >
                {mutating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />}
              </button>
            )}
            <button
              onClick={() => setActiveTab('summary')}
              className={cn('h-9 shrink-0 whitespace-nowrap rounded-md px-3 text-[13px] font-bold', activeTab === 'summary' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500')}
            >
              {t('tripSummary')}
            </button>
          </nav>

          <div className="flex shrink-0 items-center gap-2 self-end lg:self-auto">
            {!isLive && (
              <button onClick={() => setSetupOpen(true)} className="grid h-9 w-9 place-items-center rounded-[10px] border border-slate-200 text-slate-500 hover:bg-slate-50" title={t('tripEditSetup')}>
                <Settings size={15} />
              </button>
            )}
            {tripStarted && editMode && (
              <Button variant="success" size="sm" onClick={resumeNavigation} className="h-9">
                <Navigation2 size={14} /> {t('tripResumeTrip')}
              </Button>
            )}
            {isLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[12px] font-bold text-emerald-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> {t('tripLive')}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className={cn(
        'relative flex-1 overflow-hidden bg-slate-100 lg:grid lg:min-h-0 lg:bg-slate-50 lg:overflow-hidden',
        mapOpen ? 'lg:grid-cols-[minmax(520px,0.9fr)_minmax(440px,1.1fr)]' : 'lg:grid-cols-1'
      )}>
        <button
          type="button"
          onClick={() => setMapOpen((v) => !v)}
          aria-label={mapOpen ? t('tripHideMap') : t('tripShowMap')}
          title={mapOpen ? t('tripHideMap') : t('tripShowMap')}
          className="absolute right-3 top-3 z-20 hidden items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-[12px] font-semibold text-slate-700 shadow-card backdrop-blur transition hover:bg-slate-50 lg:inline-flex"
        >
          {mapOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          {mapOpen ? t('tripHideMap') : t('tripShowMap')}
        </button>
        <section
          className={cn(
            'fixed inset-x-0 bottom-0 z-30 isolate flex flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_-18px_42px_rgba(15,23,42,0.18)] transition-[top] duration-200 lg:static lg:inset-auto lg:z-10 lg:order-1 lg:block lg:h-auto lg:rounded-none lg:bg-slate-50 lg:p-6 lg:shadow-none lg:overflow-y-auto lg:border-r lg:border-slate-200',
            isMobileSheetDragging && 'transition-none',
            previewPlace && 'hidden lg:block'
          )}
          style={{ top: mobileSheetTop }}
        >
          <div className="shrink-0 border-b border-slate-100 bg-white/95 px-4 pb-3 pt-2 backdrop-blur sm:px-6 lg:hidden">
            <button
              type="button"
              onPointerDown={startMobileSheetDrag}
              className="mx-auto mb-2 grid h-6 w-20 touch-none place-items-center rounded-full text-slate-400"
              aria-label="Resize trip panel"
              title="Drag or tap to resize"
            >
              <span className="h-1 w-12 rounded-full bg-slate-300" />
            </button>
            <nav className={cn('items-center gap-3 overflow-x-auto pb-1 scroll-thin', mobileSheetHeight <= 20 ? 'hidden' : 'flex')} aria-label="Trip sections">
              <button
                onClick={() => setActiveTab('overview')}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-2 text-[13px] font-extrabold transition-colors',
                  activeTab === 'overview' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'
                )}
              >
                <Route size={14} /> {t('tripOverview')}
              </button>
              {(trip.days ?? []).map((day) => (
                <button
                  key={day.day}
                  onClick={() => !needsRouteUpdate && selectDayTab(day.day)}
                  disabled={needsRouteUpdate}
                  title={needsRouteUpdate ? t('tripUpdateRoutesFirst') : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-2 text-[13px] font-extrabold transition-colors',
                    needsRouteUpdate
                      ? 'cursor-not-allowed border-transparent text-slate-300'
                      : selectedDay === day.day && activeTab.startsWith('day-')
                        ? 'border-blue-600 text-blue-700'
                        : 'border-transparent text-slate-500'
                  )}
                >
                  <Calendar size={14} /> {t('tripDay', day.day)}
                </button>
              ))}
              <button
                onClick={() => setActiveTab('summary')}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-2 text-[13px] font-extrabold transition-colors',
                  activeTab === 'summary' ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'
                )}
              >
                <FileText size={14} /> {t('tripSummary')}
              </button>
            </nav>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4 scroll-thin sm:px-6 lg:contents', mobileSheetHeight <= 20 && 'hidden lg:contents')}>
            {/* Warnings & Alerts placed inside the sidebar to connect map directly with toolbar */}
            {(isOffline || todayBanner || optimizeMsg || (isLive && geoError) || (ENABLE_TRIP_BANNERS && alerts.length > 0) || uiWarning) && (
              <div className="mb-4 space-y-2">
                {isLive && geoError && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
                    <MapPin size={15} className="shrink-0" />
                    {t('tripGpsOff')}
                  </div>
                )}
                {todayBanner && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-800">
                    <Navigation2 size={15} /> {t('tripStartsToday')}
                    <button onClick={() => setTodayBanner(false)} className="ml-auto"><X size={14} /></button>
                  </div>
                )}
                {optimizeMsg && (
                  <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] font-semibold text-blue-800">
                    <Sparkles size={15} /> {optimizeMsg}
                    <button onClick={() => setOptimizeMsg(null)} className="ml-auto"><X size={14} /></button>
                  </div>
                )}
                {isOffline && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
                    <WifiOff size={15} /> {t('tripOffline')}
                  </div>
                )}
                {uiWarning && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-700">
                    <AlertCircle size={15} /> {uiWarning}
                    <button onClick={() => setUiWarning(null)} className="ml-auto"><X size={14} /></button>
                  </div>
                )}
                {ENABLE_TRIP_BANNERS && otherAlerts.map((alert) => (
                  <AlertBanner key={alert.id} alert={alert} tripId={id} onDismiss={dismiss} onAdapted={refresh} />
                ))}
                {ENABLE_TRIP_BANNERS && weatherAlertsToShow.map((alert) => (
                  <AlertBanner key={alert.id} alert={alert} tripId={id} onDismiss={dismiss} onAdapted={refresh} />
                ))}
                {ENABLE_TRIP_BANNERS && weatherAlertsCollapsed.length > 0 && (
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3.5">
                    <button
                      onClick={() => setShowAllWeatherAlerts((v) => !v)}
                      className="flex w-full items-center gap-2 text-left text-[13px] font-semibold text-sky-900"
                    >
                      <CloudRain size={15} className="shrink-0 text-sky-500" />
                      {t('tripRainMore', weatherAlertsCollapsed.length)}
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
              </div>
            )}

            {activeTab === 'overview' && (
              <Overview
                trip={trip}
                allPlacesById={allPlacesById}
                pendingByDay={pendingByDay}
                pendingTimes={pendingTimes}
                onSelectDay={selectDayTab}
                onAddPlace={setAddDayFor}
                onRemovePlace={removePlace}
                onPreviewPlace={previewPlaceOnMobile}
                onReorder={reorderLocal}
                onDragReorder={dragReorder}
                onUpdateRoute={handleUpdateRoute}
                onOptimiseOrder={() => setConfirmOptimise(true)}
                onStartTrip={null}
                tripStarted={isLive}
                startTimeForDay={startTimeForDay}
                needsRouteUpdate={needsRouteUpdate}
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
                onGoBack={goBackLeg}
                canGoBack={canGoBack}
                arrivedPending={arrivedPending}
                onAddPlace={setAddDayFor}
                startTime={startTimeForDay(currentDay.day)}
                gapNotifications={trip.gap_notifications ?? []}
              />
            )}

            {activeTab === 'summary' && (
              <SummaryTab
                trip={trip}
                pendingSave={pendingSave}
                onSave={(name) => {
                  const meta = { ...effectiveMeta, name, confirmed: true }
                  saveTrip(id, meta)
                  setPendingSave(null)
                  sessionStorage.removeItem(pendingKey)
                }}
                onDelete={() => setConfirmDelete(true)}
              />
            )}
          </div>
        </section>

        {mapOpen && (
          <aside className="absolute inset-0 isolate overflow-hidden bg-white lg:relative lg:order-2 lg:h-auto lg:min-h-0">
            {previewPlace && (
              <div className="absolute left-3 right-3 top-3 z-[500] rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-[0_16px_40px_rgba(15,23,42,0.22)] backdrop-blur lg:hidden">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewPlace(null)
                      setMobileSheetHeight(54)
                    }}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100"
                    aria-label="Back to trip overview"
                    title="Back"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                    <MapPin size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Xem trước địa điểm</p>
                    <p className="mt-0.5 line-clamp-2 font-display text-[15px] font-extrabold leading-5 text-slate-950">
                      {previewPlace.name}
                    </p>
                    {previewPlace.formatted_address && (
                      <p className="mt-1 line-clamp-1 text-[12px] text-slate-500">{previewPlace.formatted_address}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="h-full w-full overflow-hidden">
              <TripMap
                places={effectiveMapPlaces}
                legs={effectiveMapLegs}
                userPosition={tripStarted ? position : null}
                activeLegId={previewPlace ? null : activeLeg?.id ?? null}
                trimActiveRoute={!previewPlace && !!(activeLeg?.id)}
                placeSequences={effectivePlaceSequences}
                activeDayPlaceIds={effectiveActiveDayPlaceIds}
                trackingPath={!previewPlace && isWalkOrCycle ? trackingPath : []}
                placeDays={placeDays}
                legDays={legDays}
                colorByDay={!previewPlace && (activeTab === 'overview' || activeTab === 'summary')}
                markerPlaceIds={effectiveMarkerPlaceIds}
                routeStyleOverride={previewPlace ? PREVIEW_ROUTE_STYLE : null}
                hideZoomControl={!!previewPlace}
              />
            </div>
          </aside>
        )}
      </div>

      <TripSetupModal
        open={setupOpen}
        savedMeta={effectiveMeta}
        tripHotel={allPlacesById['hotel'] ?? null}
        onClose={() => setSetupOpen(false)}
        onSave={async (meta) => {
          const nextMeta = { ...effectiveMeta, ...meta, confirmed: true }
          saveTrip(id, nextMeta)
          if (!trip?.places?.length) return
          setMutating(true)
          setUiWarning(null)
          try {
            await api.planTrip(id, {
              place_ids: trip.places.filter((p) => p.id !== 'hotel').map((p) => p.id),
              optimize_order: true,
              preferences: {
                budget_sgd: meta.budget_sgd ?? effectiveMeta?.budget_sgd ?? 100,
                ...(meta.routeWeights ?? meta.route_weights ?? {}),
                travel_style: meta.travelStyle ?? meta.travel_style ?? effectiveMeta?.travelStyle ?? null,
                travel_styles: meta.styles ?? [],
                group_type: meta.companion ?? 'solo',
              },
              hotel_name: meta.hotelName ?? null,
              hotel_lat: meta.hotelLat ?? null,
              hotel_lng: meta.hotelLng ?? null,
              day_start_times: meta.dayStartTimes ?? meta.day_start_times ?? effectiveMeta?.dayStartTimes ?? [],
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
            <h3 className="font-display text-[18px] font-extrabold text-slate-950">{t('tripOptimiseTitle')}</h3>
            <p className="mt-2 text-[13px] text-slate-500">
              {t('tripOptimiseDesc')}
            </p>
            <div className="mt-5 flex gap-3">
              <Button variant="outline" onClick={() => setConfirmOptimise(false)} className="flex-1">
                {t('tripCancel')}
              </Button>
              <Button onClick={handleConfirmOptimise} className="flex-1">
                {t('tripConfirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {addDayFor && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40">
          <div className="h-full w-[460px] overflow-y-auto bg-white p-6 shadow-pop">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-wide text-blue-600">{t('tripAddPlace')}</p>
                <h2 className="font-display text-[24px] font-extrabold text-slate-950">{t('tripDay', addDayFor)}</h2>
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

      <ConfirmDialog
        open={confirmDelete}
        title={t('confirmDeleteTitle')}
        message={t('tripDeleteConfirm')}
        confirmLabel={t('confirmDeleteBtn')}
        cancelLabel={t('cancelBtn')}
        onConfirm={async () => {
          setConfirmDelete(false)
          try {
            await api.deleteTrip(id)
            api.deleteSavedTrip(id, user?.id ?? null)
            navigate('/')
          } catch (e) {
            setUiWarning(e.message)
          }
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </main>
  )
}
