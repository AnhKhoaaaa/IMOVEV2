import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { AlertTriangle, X, ArrowLeft, Maximize2, Minimize2, Map, WifiOff, Settings, CheckCircle } from 'lucide-react'
import { useTrip } from '../hooks/useTrip'
import { useAlerts } from '../hooks/useAlerts'
import { useSavedTrips } from '../hooks/useSavedTrips'
import { useGeolocation } from '../hooks/useGeolocation'
import { useAuth } from '../contexts/AuthContext'
import { buildPlacesById } from '../lib/tripUtils'
import { api } from '../services/api'
import DayPlan from '../components/planner/DayPlan'
import OverviewTab from '../components/planner/OverviewTab'
import SummaryTab from '../components/planner/SummaryTab'
import TripMap from '../components/map/TripMap'
import TripSetupModal from '../components/planner/TripSetupModal'
import DisruptionSimulator from '../components/adaptation/DisruptionSimulator'
import AlertBanner from '../components/adaptation/AlertBanner'
import { Skeleton } from '../components/ui/skeleton'
import { Alert, AlertDescription } from '../components/ui/alert'
import { cn } from '../lib/utils'
import { Plus, Loader2 } from 'lucide-react'

function haversineMeters(a, b) {
  const R = 6371000
  const φ1 = (a.lat * Math.PI) / 180, φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180, Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const x = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
}

/* ── Day pill ────────────────────────────────────────────────────── */
const DayPill = ({ active, onClick, children, kind, pulse }) => (
  <button
    onClick={onClick}
    className={cn(
      'relative inline-flex items-center gap-1.5 rounded-full h-8 px-3.5 text-[12.5px] font-semibold transition border whitespace-nowrap',
      active
        ? (kind === 'overview' || kind === 'summary'
          ? 'bg-slate-900 border-slate-900 text-white'
          : 'bg-indigo-600 border-indigo-600 text-white')
        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900'
    )}
  >
    {children}
    {pulse && (
      <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
      </span>
    )}
  </button>
)

/* ── Skeleton ────────────────────────────────────────────────────── */
function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading trip" aria-busy="true">
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
  const location = useLocation()
  const { state: navState } = location
  const { user } = useAuth()
  const authUserId = user?.id ?? null
  const { trip, loading, error, refresh, isOffline } = useTrip(id, authUserId)
  const { trips: savedTrips, save: saveTrip } = useSavedTrips(authUserId)
  const { alerts, dismiss } = useAlerts(id)
  const { position } = useGeolocation()
  const lastLocationSent = useRef(0)

  // ── Pending save (navigated from Planner before saving) ───────
  // Persisted in sessionStorage so a page refresh doesn't orphan the trip.
  const pendingKey = `imove_pending_${id}`
  const [pendingSave, setPendingSave] = useState(() => {
    if (navState?.pendingSave) {
      try { sessionStorage.setItem(pendingKey, JSON.stringify(navState.pendingSave)) } catch {}
      return navState.pendingSave
    }
    try {
      const stored = sessionStorage.getItem(pendingKey)
      return stored ? JSON.parse(stored) : null
    } catch { return null }
  })

  // ── Navigation state ──────────────────────────────────────────
  const [tab, setTab] = useState(navState?.pendingSave ? 'd1' : (navState?.autoStart ? 'd1' : 'overview'))
  const [mode, setMode] = useState('split')
  const [dismissedWarnings, setDismissedWarnings] = useState(false)
  const [showMobileMap, setShowMobileMap] = useState(false)

  // ── Active leg / trip started state ───────────────────────────
  const [tripStarted, setTripStarted] = useState(navState?.autoStart ?? false)
  const [activeDayNum, setActiveDayNum] = useState(1)
  const [activeLegIndex, setActiveLegIndex] = useState(0)
  const [weatherAlert, setWeatherAlert] = useState(null)
  const [transitAlert, setTransitAlert] = useState(null)
  const [transitVariant, setTransitVariant] = useState('mrt')

  // ── Edit setup modal ──────────────────────────────────────────
  const [setupOpen, setSetupOpen] = useState(false)
  const [savedConfirm, setSavedConfirm] = useState(false)
  const [dayMutating, setDayMutating] = useState(false)
  const [virtualStartLeg, setVirtualStartLeg] = useState(null)

  // P6-BUG-6: derive from savedTrips so auth changes and saves auto-update
  // without a second getSavedTrips call.
  const savedMeta = useMemo(
    () => savedTrips.find((t) => t.id === id) ?? null,
    [savedTrips, id]
  )

  // ── Optimization log (for SummaryTab) ─────────────────────────
  const [optimizationLog, setOptimizationLog] = useState([])

  // Auto-switch to active day tab when trip starts and data loads
  useEffect(() => {
    if (tripStarted && trip) {
      const firstDay = trip.days?.[0]?.day ?? 1
      setActiveDayNum(firstDay)
      setTab(`d${firstDay}`)
    }
  }, [tripStarted, trip?.days?.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Virtual start leg: when trip starts, check GPS distance to Stop 1
  useEffect(() => {
    if (!tripStarted || !position || !trip) return
    const currentDay = trip.days.find((d) => d.day === activeDayNum)
    const firstLeg = currentDay?.legs?.[0]
    if (!firstLeg) return
    const stop1 = placesById[firstLeg.from_place_id]
    if (!stop1) return
    const dist = haversineMeters(position, { lat: stop1.lat, lng: stop1.lng })
    if (dist < 1000) { setVirtualStartLeg(null); return }
    api.compareRoutes(position.lat, position.lng, stop1.lat, stop1.lng)
      .then((result) => setVirtualStartLeg({ toPlace: stop1, routeComparison: result }))
      .catch(() => setVirtualStartLeg(null))
  }, [tripStarted]) // eslint-disable-line react-hooks/exhaustive-deps

  // Send position to backend at most once per 30 s for proximity-based LTA alerts
  useEffect(() => {
    if (!position || !id) return
    const now = Date.now()
    if (now - lastLocationSent.current < 30000) return
    lastLocationSent.current = now
    api.updateLocation(id, { lat: position.lat, lng: position.lng }).catch(() => {})
  }, [position, id])

  // ── Arrive handler ────────────────────────────────────────────
  const handleArrive = useCallback(() => {
    if (!trip) return
    const currentDay = trip.days.find((d) => d.day === activeDayNum)
    if (!currentDay) return

    setWeatherAlert(null)
    setTransitAlert(null)
    setTransitVariant('mrt')

    if (activeLegIndex < currentDay.legs.length - 1) {
      setActiveLegIndex((i) => i + 1)
    } else {
      const nextDay = trip.days.find((d) => d.day === activeDayNum + 1)
      if (nextDay) {
        const next = activeDayNum + 1
        setActiveDayNum(next)
        setActiveLegIndex(0)
        setTab(`d${next}`)
      } else {
        setTripStarted(false)
        setTab('summary')
      }
    }
  }, [trip, activeDayNum, activeLegIndex])

  // ── Disruption handlers ───────────────────────────────────────
  const handleWeatherDisrupt = useCallback(() => {
    if (!trip) return
    const currentDay = trip.days.find((d) => d.day === activeDayNum)
    const activeLeg = currentDay?.legs[activeLegIndex]
    if (!activeLeg) return
    const placesById = buildPlacesById(trip.places)
    const fromPlace = placesById[activeLeg.from_place_id]
    const toPlace = placesById[activeLeg.to_place_id]
    setWeatherAlert({
      legIndex: activeLegIndex,
      attractionName: toPlace?.name ?? 'your next stop',
      swapName: fromPlace?.is_outdoor === false ? fromPlace.name : 'ArtScience Museum',
    })
  }, [trip, activeDayNum, activeLegIndex])

  const handleTransitDisrupt = useCallback(() => {
    setTransitAlert({ legIndex: activeLegIndex })
  }, [activeLegIndex])

  const handleResetTrip = useCallback(() => {
    setTripStarted(false)
    setActiveLegIndex(0)
    setActiveDayNum(1)
    setWeatherAlert(null)
    setTransitAlert(null)
    setTransitVariant('mrt')
  }, [])

  const handleSwitchToBus = useCallback(() => {
    setTransitVariant('bus')
    setTransitAlert(null)
    setOptimizationLog((log) => [
      ...log,
      {
        type: 'transit_reroute',
        title: 'Switched to Bus Route',
        detail: 'MRT disruption — rerouted via Bus 7',
        time: new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }),
      },
    ])
  }, [])

  const handleApproveSwap = useCallback(() => {
    if (!weatherAlert) return
    setOptimizationLog((log) => [
      ...log,
      {
        type: 'weather_swap',
        title: `Venue swap: ${weatherAlert.attractionName} → ${weatherAlert.swapName}`,
        detail: 'Heavy rain forecast — moved to indoor venue',
        time: new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }),
      },
    ])
    setWeatherAlert(null)
  }, [weatherAlert])

  // ── Save setup ────────────────────────────────────────────────
  // P6-BUG-1: use hook saveTrip (carries authUserId) not api.saveTrip directly.
  // savedMeta is derived from savedTrips so it updates automatically after save.
  const handleSaveSetup = useCallback((updatedMeta) => {
    saveTrip(id, { ...savedMeta, ...updatedMeta })
  }, [saveTrip, savedMeta, id])

  const placesById = useMemo(
    () => buildPlacesById(trip?.places ?? []),
    [trip]
  )

  const mapLegs = useMemo(() => {
    if (!trip) return []
    // Active leg mode: show only the current active leg on map
    if (tripStarted) {
      const currentDay = trip.days.find((d) => d.day === activeDayNum)
      const activeLeg = currentDay?.legs[activeLegIndex]
      return activeLeg ? [activeLeg] : []
    }
    if (tab === 'overview' || tab === 'summary') return trip.days.flatMap((d) => d.legs)
    const dayNum = parseInt(tab.replace('d', ''), 10)
    return trip.days.find((d) => d.day === dayNum)?.legs ?? []
  }, [trip, tab, tripStarted, activeDayNum, activeLegIndex])

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
                  aria-label="Dismiss warnings"
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
                    {tripStarted && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-emerald-600 font-semibold">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                        Live
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Edit setup button */}
              <button
                onClick={() => setSetupOpen(true)}
                className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                title="Edit setup"
              >
                <Settings size={14} />
              </button>
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
                <DayPill
                  key={d.day}
                  active={tab === `d${d.day}`}
                  onClick={() => setTab(`d${d.day}`)}
                  pulse={tripStarted && d.day === activeDayNum}
                >
                  Day {d.day}
                  {!tripStarted && (trip?.days?.length ?? 0) > 1 && (
                    <span
                      role="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (dayMutating) return
                        setDayMutating(true)
                        try { await api.removeDay(id, d.day); await refresh() }
                        catch (err) { console.error('removeDay failed:', err) }
                        finally { setDayMutating(false) }
                      }}
                      className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full hover:bg-red-100 hover:text-red-500 transition"
                    >
                      <X size={9} />
                    </span>
                  )}
                </DayPill>
              ))}
              <DayPill active={tab === 'summary'} onClick={() => setTab('summary')} kind="summary">
                Summary
              </DayPill>
              <button
                onClick={async () => {
                  if (dayMutating) return
                  setDayMutating(true)
                  try { await api.addDay(id); await refresh() }
                  catch (err) { console.error('addDay failed:', err) }
                  finally { setDayMutating(false) }
                }}
                disabled={dayMutating || tripStarted}
                className="ml-1 grid h-8 w-8 place-items-center rounded-full border border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/40 transition disabled:opacity-40"
                title="Add day"
              >
                {dayMutating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={13} />}
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
                  onOptimize={tripStarted ? undefined : async () => { await api.optimizeRoute(id); await refresh() }}
                />
              )}

              {(trip?.days ?? []).map((d) =>
                tab === `d${d.day}` ? (
                  <div key={d.day}>
                    {pendingSave && (
                      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                        <p className="text-[12px] font-medium text-emerald-700">
                          Review your days, then save from Summary
                        </p>
                        <button
                          onClick={() => setTab('summary')}
                          className="shrink-0 text-[12px] font-bold text-emerald-700 hover:text-emerald-900 transition"
                        >
                          Save →
                        </button>
                      </div>
                    )}
                    <DayPlan
                      day={d.day}
                      legs={d.legs}
                      placesById={placesById}
                      tripId={id}
                      onLegUpdated={refresh}
                      isActiveDay={tripStarted && d.day === activeDayNum}
                      activeLegIndex={activeLegIndex}
                      position={position}
                      onArrive={handleArrive}
                      weatherAlert={weatherAlert}
                      transitAlert={transitAlert}
                      transitVariant={transitVariant}
                      onSwitchToBus={handleSwitchToBus}
                      onApproveSwap={handleApproveSwap}
                      onDismissWeather={() => setWeatherAlert(null)}
                      onDismissTransit={() => setTransitAlert(null)}
                      virtualStartLeg={tripStarted && d.day === activeDayNum ? virtualStartLeg : null}
                      onVirtualArrive={() => setVirtualStartLeg(null)}
                    />
                  </div>
                ) : null
              )}

              {tab === 'summary' && (
                <SummaryTab
                  trip={trip}
                  optimizationLog={optimizationLog}
                  pendingSave={pendingSave}
                  onSave={(name) => {
                    const meta = { ...pendingSave, name }
                    saveTrip(id, meta)
                    setPendingSave(null)
                    try { sessionStorage.removeItem(pendingKey) } catch {}
                    setSavedConfirm(true)
                  }}
                />
              )}
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

      {/* Save confirmation overlay */}
      {savedConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-[min(360px,calc(100vw-32px))] rounded-2xl bg-white p-6 shadow-pop space-y-4">
            <div className="text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-100">
                <CheckCircle size={24} className="text-emerald-600" />
              </div>
              <p className="font-display font-bold text-[18px] text-slate-900">Itinerary saved!</p>
              <p className="text-[13px] text-slate-500 mt-1">Your trip has been saved successfully.</p>
            </div>
            <button
              onClick={() => navigate('/')}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-display font-bold text-[14px] shadow-card inline-flex items-center justify-center gap-2 hover:opacity-90 transition"
            >
              Go to Home
            </button>
          </div>
        </div>
      )}

      {/* Trip Setup Modal */}
      <TripSetupModal
        open={setupOpen}
        savedMeta={savedMeta}
        onClose={() => setSetupOpen(false)}
        onSave={handleSaveSetup}
      />

      {/* Disruption Simulator (debug overlay, active leg mode only) */}
      {tripStarted && (
        <DisruptionSimulator
          onWeatherDisrupt={handleWeatherDisrupt}
          onTransitDisrupt={handleTransitDisrupt}
          onResetTrip={handleResetTrip}
        />
      )}
    </div>
  )
}
