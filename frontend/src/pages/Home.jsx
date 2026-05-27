import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Navigation2, Sparkles, Plus, Clock, Wallet, Footprints, MapPin, Edit, Trash2 } from 'lucide-react'
import { useSavedTrips } from '../hooks/useSavedTrips'
import { formatDateRange, computeTripMetrics } from '../lib/tripUtils'
import { api } from '../services/api'
import { supabase } from '../lib/supabase'
import { useT } from '../contexts/LanguageContext'
import { cn } from '../lib/utils'

/* ── Status meta ─────────────────────────────────────────────────── */
const STATUS_META = {
  today:    { dot: 'bg-emerald-500 animate-pulse', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  upcoming: { dot: 'bg-indigo-500',               pill: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  draft:    { dot: 'bg-slate-400',                pill: 'bg-slate-100 text-slate-600 border-slate-200' },
  past:     { dot: 'bg-slate-300',                pill: 'bg-slate-50 text-slate-500 border-slate-200' },
}

const StatusTag = ({ status }) => {
  const { t } = useT()
  const m = STATUS_META[status] ?? STATUS_META.draft
  const labels = {
    today: t('statusToday'),
    upcoming: t('filter_Upcoming'),
    draft: t('filter_Drafts'),
    past: t('filter_Past'),
  }
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 h-6 text-[11px] font-semibold whitespace-nowrap', m.pill)}>
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', m.dot)} />
      {labels[status] ?? status}
    </span>
  )
}

/* ── Destination thumbnail ───────────────────────────────────────── */
const SKYLINE_HEIGHTS = [24, 36, 18, 48, 28, 56, 22, 40, 30]

const DestinationThumb = ({ trip }) => {
  const { t } = useT()
  const dateLabel = formatDateRange(trip.startDate, trip.numDays ?? 1)
  return (
    <div className="relative h-32 w-full overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500">
      <div className="absolute inset-0 opacity-50" style={{
        backgroundImage: 'radial-gradient(circle at 20% 80%,rgba(255,255,255,.4),transparent 40%),radial-gradient(circle at 80% 20%,rgba(255,255,255,.3),transparent 40%)'
      }} />
      <div className="absolute inset-x-0 bottom-0 h-1/2 flex items-end justify-around opacity-30">
        {SKYLINE_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="bg-white/40 mix-blend-overlay"
            style={{ width: 12 + (i % 3) * 4, height: h + (i % 5) * 4 }}
          />
        ))}
      </div>
      <div className="absolute inset-0 flex items-start justify-between p-4">
        <div className="text-white">
          <div className="font-display font-extrabold text-[24px] leading-none drop-shadow-sm">
            {trip.name ?? 'Singapore'}
          </div>
          <div className="text-[12px] text-white/85 mt-1.5">
            {t('daysUnit', trip.numDays ?? 1)}
            {trip.startDate ? ` · ${dateLabel}` : ` · ${t('flexibleDates')}`}
          </div>
        </div>
        {dateLabel && (
          <span className="max-w-[140px] truncate rounded-full bg-white/25 backdrop-blur border border-white/40 px-2 h-6 inline-flex items-center text-[11px] font-medium text-white">
            {dateLabel}
          </span>
        )}
      </div>
    </div>
  )
}

/* ── Stat badge ──────────────────────────────────────────────────── */
const StatBadge = ({ icon, label, value }) => (
  <div className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50/60 px-2 h-7 text-[11.5px]">
    <span className="text-slate-400">{icon}</span>
    {label && <span className="text-slate-500">{label}</span>}
    <span className="font-display font-bold text-slate-900 tabular-nums">{value}</span>
  </div>
)

/* ── Trip card ───────────────────────────────────────────────────── */
const TripCard = ({ trip, onOpen, onStart, onDelete }) => {
  const { t } = useT()
  const isToday = trip.status === 'today'
  const metrics = computeTripMetrics(api.getCachedTripData(trip.id))

  return (
    <div className={cn(
      'group rounded-2xl bg-white border shadow-card overflow-hidden transition hover:shadow-pop hover:-translate-y-0.5',
      isToday ? 'border-emerald-300 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-slate-300'
    )}>
      <DestinationThumb trip={trip} />

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <StatusTag status={trip.status} />
          <span className="text-[11.5px] text-slate-500 inline-flex items-center gap-1">
            <Clock size={11} className="text-slate-400" />
            {t('daysUnit', trip.numDays ?? 1)}
          </span>
        </div>

        {metrics ? (
          <div className="flex flex-wrap gap-1.5">
            <StatBadge icon={<Clock size={11} />} value={metrics.activeTime} />
            <StatBadge icon={<Wallet size={11} />} value={metrics.transitCost} />
            <StatBadge icon={<Footprints size={11} />} value={metrics.walkingDist} />
            <StatBadge icon={<MapPin size={11} />} value={t('stopsUnit', metrics.stopsCount)} />
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <StatBadge icon={<MapPin size={11} />} label={t('dest')} value="Singapore" />
            {trip.savedAt && (
              <StatBadge
                icon={<Clock size={11} />}
                label={t('savedLabel')}
                value={new Date(trip.savedAt).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })}
              />
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onOpen}
            className="flex-1 h-9 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition focus-ring inline-flex items-center justify-center gap-1.5"
          >
            <Edit size={12} /> {t('openBtn')}
          </button>
          <button
            onClick={onDelete}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition focus-ring shrink-0"
            aria-label="Delete trip"
          >
            <Trash2 size={13} />
          </button>
          {isToday && (
            <button
              onClick={onStart}
              className="relative inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-4 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-display font-bold text-[13px] shadow-card hover:shadow-pop transition focus-ring overflow-hidden"
            >
              <span className="absolute inset-0 rounded-lg ring-4 ring-emerald-400/50 animate-ping pointer-events-none" />
              <Navigation2 size={13} /> {t('startTripBtn')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Today modal ─────────────────────────────────────────────────── */
const StartTodayModal = ({ trip, onStart, onClose }) => {
  const { t } = useT()
  if (!trip) return null
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="w-[min(440px,calc(100vw-32px))] rounded-2xl bg-white shadow-pop border border-slate-200 overflow-hidden animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-fuchsia-500" />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="inline-flex items-center gap-2.5">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200">
                <Navigation2 size={18} />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700 inline-flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {t('liveLabel')}
                </div>
                <div className="font-display font-extrabold text-[18px] text-slate-900">
                  {t('startsTodayTitle')}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
          <p className="mt-3 text-[13.5px] text-slate-600 leading-relaxed">
            {t('startsTodayDesc')}
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex-1 h-10 rounded-md border border-slate-200 text-slate-700 font-semibold text-[14px] hover:bg-slate-50 transition"
            >
              {t('laterBtn')}
            </button>
            <button
              onClick={onStart}
              className="flex-1 h-10 rounded-md bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-display font-bold text-[14px] shadow-card inline-flex items-center justify-center gap-1.5 hover:shadow-pop transition"
            >
              <Navigation2 size={14} /> {t('readyToNavigate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Main ────────────────────────────────────────────────────────── */
const FILTERS = ['All', 'Today', 'Upcoming', 'Drafts', 'Past']
const FILTER_MAP = { All: null, Today: 'today', Upcoming: 'upcoming', Drafts: 'draft', Past: 'past' }
const STATUS_FOR_FILTER = { Today: 'today', Upcoming: 'upcoming', Drafts: 'draft', Past: 'past' }

export default function Home() {
  const navigate = useNavigate()
  const { t } = useT()
  const [authUser, setAuthUser] = useState(null)
  const { trips, remove } = useSavedTrips(authUser?.id)
  const [filter, setFilter] = useState('All')
  const [modalTrip, setModalTrip] = useState(null)

  const handleDelete = async (trip) => {
    if (!window.confirm(`Delete "${trip.name ?? 'this trip'}"? This cannot be undone.`)) return
    try { await api.deleteTrip(trip.id) } catch { /* best-effort — remove locally regardless */ }
    remove(trip.id)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthUser(data.session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const todayTrip = trips.find((t) => t.status === 'today')
    if (todayTrip) {
      const timer = setTimeout(() => setModalTrip(todayTrip), 350)
      return () => clearTimeout(timer)
    }
  }, [trips])

  const statusFilter = FILTER_MAP[filter]
  const filtered = statusFilter ? trips.filter((t) => t.status === statusFilter) : trips

  const countByStatus = {
    today: trips.filter((t) => t.status === 'today').length,
    upcoming: trips.filter((t) => t.status === 'upcoming').length,
    draft: trips.filter((t) => t.status === 'draft').length,
    past: trips.filter((t) => t.status === 'past').length,
  }
  const todayCount = countByStatus.today
  const upcomingCount = countByStatus.upcoming

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="max-w-6xl mx-auto px-6 pt-8 pb-16">
        {/* Hero header */}
        <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 inline-flex items-center gap-1.5">
              <Sparkles size={12} className="text-fuchsia-600" /> {t('yourItineraries')}
            </div>
            <h1 className="font-display font-extrabold text-[34px] sm:text-[40px] leading-[1.05] tracking-tight text-slate-900 mt-1">
              {authUser
                ? t('welcomeUser', authUser.user_metadata?.username || authUser.email?.split('@')[0])
                : t('welcomeBack')}
            </h1>
            <p className="text-[14px] text-slate-500 mt-2">
              {t('tripsCount', trips.length)}
              {todayCount > 0 && (
                <span> · <span className="font-semibold text-emerald-700">{t('happeningToday', todayCount)}</span></span>
              )}
              {upcomingCount > 0 && <span> · {t('upcomingCount', upcomingCount)}</span>}
            </p>
          </div>
          <button
            onClick={() => navigate('/plan')}
            className="group relative inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-500 text-white font-display font-bold text-[14px] shadow-pop overflow-hidden focus-ring"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            <Plus size={15} strokeWidth={2.5} /> {t('createNewItinerary')}
          </button>
        </div>

        {/* Filter chips with count pills */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {FILTERS.map((f) => {
            const count = STATUS_FOR_FILTER[f] ? countByStatus[STATUS_FOR_FILTER[f]] : null
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'h-8 px-3.5 rounded-full text-[12.5px] font-semibold border transition inline-flex items-center gap-1.5',
                  filter === f
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                )}
              >
                {t(`filter_${f}`)}
                {count != null && count > 0 && (
                  <span className={cn(
                    'grid h-4 min-w-4 px-1 place-items-center rounded-full text-[10px] font-bold tabular-nums',
                    filter === f ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-700'
                  )}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Grid */}
        {trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500 text-white shadow-pop mb-6">
              <Navigation2 size={40} />
            </div>
            <h2 className="font-display font-bold text-2xl text-slate-900">{t('noTripsTitle')}</h2>
            <p className="text-slate-500 mt-2 max-w-sm">{t('noTripsDesc')}</p>
            <button
              onClick={() => navigate('/plan')}
              className="mt-6 inline-flex items-center gap-2 h-11 px-8 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-500 text-white font-display font-bold text-[14px] shadow-pop hover:opacity-90 transition focus-ring"
            >
              <Plus size={15} strokeWidth={2.5} /> {t('startPlanning')}
            </button>
          </div>
        ) : (
          <>
            {filtered.length === 0 && (
              <div className="text-center py-16 text-slate-400 text-[14px]">
                {t('noTripsCategory')}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((trip) => (
                <TripCard
                  key={trip.id}
                  trip={trip}
                  onOpen={() => navigate(`/trip/${trip.id}`)}
                  onStart={() => setModalTrip(trip)}
                  onDelete={() => handleDelete(trip)}
                />
              ))}

              {/* Create card */}
              <button
                onClick={() => navigate('/plan')}
                className="rounded-2xl border-2 border-dashed border-slate-300 bg-white/40 min-h-[280px] grid place-items-center hover:border-indigo-400 hover:bg-indigo-50/30 transition group focus-ring"
              >
                <div className="text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-indigo-100 to-fuchsia-100 text-indigo-600 group-hover:scale-110 transition mb-2">
                    <Plus size={18} strokeWidth={2.5} />
                  </div>
                  <div className="font-display font-bold text-[15px] text-slate-700 group-hover:text-indigo-700">
                    {t('planNewTrip')}
                  </div>
                  <div className="text-[12px] text-slate-500 mt-0.5">{t('freshItinerary')}</div>
                </div>
              </button>
            </div>
          </>
        )}
      </main>

      <StartTodayModal
        trip={modalTrip}
        onStart={() => {
          const tripId = modalTrip.id
          setModalTrip(null)
          navigate(`/trip/${tripId}`, { state: { autoStart: true } })
        }}
        onClose={() => setModalTrip(null)}
      />
    </div>
  )
}
