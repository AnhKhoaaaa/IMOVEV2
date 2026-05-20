import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, X, CalendarDays, MapPin } from 'lucide-react'
import { useTrip } from '../hooks/useTrip'
import { useAlerts } from '../hooks/useAlerts'
import DayPlan from '../components/planner/DayPlan'
import TravelTips from '../components/planner/TravelTips'
import TripMap from '../components/map/TripMap'
import AlertBanner from '../components/adaptation/AlertBanner'
import { Skeleton } from '../components/ui/skeleton'
import { Alert, AlertDescription } from '../components/ui/alert'

function PanelSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label="Đang tải hành trình">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-3/4 rounded-xl" />
    </div>
  )
}

export default function Trip() {
  const { id } = useParams()
  const { trip, loading, error, refresh } = useTrip(id)
  const { alerts, dismiss } = useAlerts(id)
  const [dismissedWarnings, setDismissedWarnings] = useState(false)
  const [activeDay, setActiveDay] = useState(null) // null = tất cả ngày
  const [showMobileMap, setShowMobileMap] = useState(false)

  const allLegs = useMemo(
    () => trip?.days?.flatMap((d) => d.legs) ?? [],
    [trip],
  )

  const visibleDays = useMemo(() => {
    if (!trip?.days) return []
    return activeDay ? trip.days.filter((d) => d.day === activeDay) : trip.days
  }, [trip, activeDay])

  const mapLegs = useMemo(() => {
    if (!activeDay) return allLegs
    return trip?.days?.find((d) => d.day === activeDay)?.legs ?? []
  }, [trip, activeDay, allLegs])

  const hasAlertZone =
    alerts.length > 0 || (!dismissedWarnings && (trip?.warnings?.length ?? 0) > 0)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-100">
            <CalendarDays className="h-3.5 w-3.5 text-sky-600" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              Hành trình Singapore
            </p>
            {trip && (
              <p className="text-xs text-slate-400">
                {trip.days?.length ?? 0} ngày · {trip.places?.length ?? 0} địa điểm
              </p>
            )}
          </div>
        </div>

        {/* Mobile: toggle map visibility */}
        <button
          onClick={() => setShowMobileMap((v) => !v)}
          aria-pressed={showMobileMap}
          className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 lg:hidden"
        >
          <MapPin className="h-3.5 w-3.5" />
          {showMobileMap ? 'Ẩn bản đồ' : 'Xem bản đồ'}
        </button>
      </header>

      {/* ── Alert zone ─────────────────────────────────────────────── */}
      {hasAlertZone && (
        <div className="shrink-0 space-y-2 border-b border-slate-100 bg-white px-4 py-2">
          {alerts.map((a) => (
            <AlertBanner key={a.id} alert={a} tripId={id} onDismiss={dismiss} onAdapted={refresh} />
          ))}
          {!dismissedWarnings && (trip?.warnings?.length ?? 0) > 0 && (
            <Alert variant="warning" className="relative pr-10">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{trip.warnings.join(' · ')}</AlertDescription>
              <button
                onClick={() => setDismissedWarnings(true)}
                aria-label="Dismiss warnings"
                className="absolute right-3 top-3 opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="h-4 w-4" />
              </button>
            </Alert>
          )}
        </div>
      )}

      {/* ── 2-panel main area ──────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left panel — scrollable itinerary */}
        <div
          className={`w-full shrink-0 overflow-y-auto border-r border-slate-200 bg-white lg:flex lg:w-[420px] lg:flex-col xl:w-[460px] ${
            showMobileMap ? 'hidden' : 'flex flex-col'
          }`}
        >
          {loading && <PanelSkeleton />}

          {error && !loading && (
            <div className="p-4">
              <Alert variant="destructive">
                <AlertDescription>
                  Không thể tải hành trình: {String(error?.message ?? error)}
                </AlertDescription>
              </Alert>
            </div>
          )}

          {trip && !loading && (
            <>
              {/* Day filter tabs — only for multi-day trips */}
              {(trip.days?.length ?? 0) > 1 && (
                <div
                  className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-100 bg-slate-50 px-4 py-2.5"
                  role="tablist"
                  aria-label="Chọn ngày"
                >
                  <button
                    role="tab"
                    aria-selected={activeDay === null}
                    onClick={() => setActiveDay(null)}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      activeDay === null
                        ? 'bg-sky-500 text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:border-sky-300'
                    }`}
                  >
                    Tất cả
                  </button>
                  {trip.days.map((d) => (
                    <button
                      key={d.day}
                      role="tab"
                      aria-selected={activeDay === d.day}
                      onClick={() => setActiveDay(d.day)}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        activeDay === d.day
                          ? 'bg-sky-500 text-white'
                          : 'border border-slate-200 bg-white text-slate-600 hover:border-sky-300'
                      }`}
                    >
                      Ngày {d.day}
                    </button>
                  ))}
                </div>
              )}

              {/* Day plans */}
              <div className="flex-1 space-y-0 p-4">
                {visibleDays.map((day) => (
                  <DayPlan
                    key={day.day}
                    day={day.day}
                    legs={day.legs}
                    tripId={id}
                    onLegUpdated={refresh}
                  />
                ))}
                <TravelTips places={trip.places ?? []} />
              </div>
            </>
          )}
        </div>

        {/* Right panel — map (always visible on desktop, toggled on mobile) */}
        <div
          className={`relative flex-1 ${showMobileMap ? 'block' : 'hidden lg:block'}`}
        >
          {trip ? (
            <TripMap places={trip.places} legs={mapLegs} />
          ) : (
            <div
              className="h-full w-full animate-pulse bg-slate-100"
              aria-hidden="true"
            />
          )}
        </div>

      </div>
    </div>
  )
}
