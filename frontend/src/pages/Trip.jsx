import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertTriangle, X, ArrowLeft, Maximize2, Minimize2, Map, WifiOff } from 'lucide-react'
import { useTrip } from '../hooks/useTrip'
import { useAlerts } from '../hooks/useAlerts'
import { useGeolocation } from '../hooks/useGeolocation'
import { buildPlacesById } from '../lib/tripUtils'
import { api } from '../services/api'
import DayPlan from '../components/planner/DayPlan'
import OverviewTab from '../components/planner/OverviewTab'
import SummaryTab from '../components/planner/SummaryTab'
import TripMap from '../components/map/TripMap'
import AlertBanner from '../components/adaptation/AlertBanner'
import { Skeleton } from '../components/ui/skeleton'
import { Alert, AlertDescription } from '../components/ui/alert'
import { cn } from '../lib/utils'
import { Plus } from 'lucide-react'

/* ── Day pill ────────────────────────────────────────────────────── */
const DayPill = ({ active, onClick, children, kind }) => (
  <button
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full h-8 px-3.5 text-[12.5px] font-semibold transition border whitespace-nowrap',
      active
        ? (kind === 'overview' || kind === 'summary'
          ? 'bg-slate-900 border-slate-900 text-white'
          : 'bg-indigo-600 border-indigo-600 text-white')
        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
    )}
  >
    {children}
  </button>
)

/* ── Skeleton ────────────────────────────────────────────────────── */
function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-16 w-3/4 rounded-2xl" />
    </div>
  )
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function Trip() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { trip, loading, error, refresh, isOffline } = useTrip(id)
  const { alerts, dismiss } = useAlerts(id)
  const { position } = useGeolocation()
  const lastLocationSent = useRef(0)

  const [tab, setTab] = useState('overview')
  const [mode, setMode] = useState('split')  // 'split' | 'expanded'
  const [dismissedWarnings, setDismissedWarnings] = useState(false)
  const [showMobileMap, setShowMobileMap] = useState(false)

  // Send position to backend at most once per 30 s for proximity-based LTA alerts (§3.2)
  useEffect(() => {
    if (!position || !id) return
    const now = Date.now()
    if (now - lastLocationSent.current < 30000) return
    lastLocationSent.current = now
    api.updateLocation(id, { lat: position.lat, lng: position.lng }).catch(() => {})
  }, [position, id])

  const savedMeta = useMemo(() => api.getSavedTrips().find((t) => t.id === id), [id])

  const placesById = useMemo(
    () => buildPlacesById(trip?.places ?? []),
    [trip]
  )

  const mapLegs = useMemo(() => {
    if (!trip) return []
    if (tab === 'overview' || tab === 'summary') return trip.days.flatMap((d) => d.legs)
    const dayNum = parseInt(tab.replace('d', ''), 10)
    return trip.days.find((d) => d.day === dayNum)?.legs ?? []
  }, [trip, tab])

  const hasAlertZone = isOffline || alerts.length > 0 || (!dismissedWarnings && (trip?.warnings?.length ?? 0) > 0)

  return (
    <div className="h-screen w-full flex bg-slate-50 overflow-hidden">

      {/* Left panel */}
      <main className={cn(
        'bg-white border-r border-slate-200 overflow-hidden flex flex-col transition-all',
        mode === 'expanded' ? 'basis-full max-w-full' : 'lg:basis-[58%] lg:max-w-[58%]',
        showMobileMap ? 'hidden lg:flex' : 'flex w-full'
      )}>

        {/* Alert zone */}
        {hasAlertZone && (
          <div className="shrink-0 space-y-2 border-b border-slate-100 bg-white px-4 py-2">
            {isOffline && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                <WifiOff className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                <p className="text-xs font-medium text-amber-800">
                  Offline Mode — Displaying scheduled fallback itinerary
                </p>
              </div>
            )}
            {alerts.map((a) => (
              <AlertBanner key={a.id} alert={a} tripId={id} onDismiss={dismiss} onAdapted={refresh} />
            ))}
            {!dismissedWarnings && (trip?.warnings?.length ?? 0) > 0 && (
              <Alert variant="warning" className="relative pr-10">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{trip.warnings.join(' · ')}</AlertDescription>
                <button
                  onClick={() => setDismissedWarnings(true)}
                  className="absolute right-3 top-3 opacity-60 hover:opacity-100"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </Alert>
            )}
          </div>
        )}

        {/* Sticky header */}
        <div className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-slate-200/70">
          {/* Trip title row */}
          <div className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => navigate('/')}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 transition"
                aria-label="Back"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="min-w-0">
                <p className="font-display font-bold text-[15px] text-slate-900 truncate">
                  {savedMeta?.name ?? 'Singapore Trip'}
                </p>
                {trip && (
                  <p className="text-[12px] text-slate-400">
                    {trip.days?.length ?? 0} days · {trip.places?.length ?? 0} stops
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setMode((m) => m === 'expanded' ? 'split' : 'expanded')}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                title={mode === 'expanded' ? 'Show map' : 'Expand panel'}
              >
                {mode === 'expanded' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            </div>
          </div>

          {/* Day pills */}
          <div className="px-5 pb-3 overflow-x-auto scroll-thin">
            <div className="flex items-center gap-1.5 min-w-max">
              <DayPill active={tab === 'overview'} onClick={() => setTab('overview')} kind="overview">
                Overview
              </DayPill>
              {(trip?.days ?? []).map((d) => (
                <DayPill key={d.day} active={tab === `d${d.day}`} onClick={() => setTab(`d${d.day}`)}>
                  Day {d.day}
                </DayPill>
              ))}
              <DayPill active={tab === 'summary'} onClick={() => setTab('summary')} kind="summary">
                Summary
              </DayPill>
              <button className="ml-1 grid h-8 w-8 place-items-center rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/40 transition">
                <Plus size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-5">
          {loading && <PanelSkeleton />}

          {error && !loading && (
            <Alert variant="destructive">
              <AlertDescription>
                Could not load trip: {String(error?.message ?? error)}
              </AlertDescription>
            </Alert>
          )}

          {trip && !loading && (
            <>
              {tab === 'overview' && (
                <OverviewTab
                  trip={trip}
                  savedMeta={savedMeta}
                  onJumpDay={(dayNum) => setTab(`d${dayNum}`)}
                />
              )}

              {(trip?.days ?? []).map((d) =>
                tab === `d${d.day}` ? (
                  <DayPlan
                    key={d.day}
                    day={d.day}
                    legs={d.legs}
                    placesById={placesById}
                    tripId={id}
                    onLegUpdated={refresh}
                  />
                ) : null
              )}

              {tab === 'summary' && <SummaryTab trip={trip} />}
            </>
          )}
        </div>
      </main>

      {/* Right panel — map */}
      {mode !== 'expanded' && (
        <aside className={cn(
          'p-3 sticky top-0 h-screen',
          'hidden lg:flex lg:basis-[42%] lg:max-w-[42%]',
          showMobileMap ? 'flex w-full' : ''
        )}>
          {trip ? (
            <TripMap places={trip.places} legs={mapLegs} />
          ) : (
            <div className="h-full w-full rounded-2xl bg-slate-100 animate-pulse" aria-hidden="true" />
          )}
        </aside>
      )}

      {/* Mobile map FAB */}
      <button
        onClick={() => setShowMobileMap((v) => !v)}
        className="lg:hidden fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 h-11 px-4 rounded-full bg-indigo-600 text-white font-semibold text-[13px] shadow-pop"
      >
        {showMobileMap
          ? <><ArrowLeft size={14} /> Itinerary</>
          : <><Map size={14} /> Map</>
        }
      </button>
    </div>
  )
}
