import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Navigation2, Search, User, Sparkles, Plus, Clock, Wallet, Footprints, MapPin, Edit } from 'lucide-react'
import { useSavedTrips } from '../hooks/useSavedTrips'
import { formatDateRange } from '../lib/tripUtils'
import { cn } from '../lib/utils'

/* ── Status meta ─────────────────────────────────────────────────── */
const STATUS_META = {
  today:    { label: 'Happening Today', dot: 'bg-emerald-500 animate-pulse', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  upcoming: { label: 'Upcoming',        dot: 'bg-indigo-500',               pill: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  draft:    { label: 'Draft',           dot: 'bg-slate-400',                pill: 'bg-slate-100 text-slate-600 border-slate-200' },
  past:     { label: 'Past',            dot: 'bg-slate-300',                pill: 'bg-slate-50 text-slate-500 border-slate-200' },
}

const StatusTag = ({ status }) => {
  const m = STATUS_META[status] ?? STATUS_META.draft
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 h-6 text-[11px] font-semibold whitespace-nowrap', m.pill)}>
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  )
}

/* ── Destination thumbnail ───────────────────────────────────────── */
const SKYLINE_HEIGHTS = [24, 36, 18, 48, 28, 56, 22, 40, 30]

const DestinationThumb = ({ trip }) => {
  const dateLabel = formatDateRange(trip.startDate, trip.numDays ?? 1)
  return (
    <div className="relative h-32 w-full overflow-hidden bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500">
      {/* Radial highlights */}
      <div className="absolute inset-0 opacity-50" style={{
        backgroundImage: 'radial-gradient(circle at 20% 80%,rgba(255,255,255,.4),transparent 40%),radial-gradient(circle at 80% 20%,rgba(255,255,255,.3),transparent 40%)'
      }} />
      {/* Abstract skyline bars */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 flex items-end justify-around opacity-30">
        {SKYLINE_HEIGHTS.map((h, i) => (
          <div
            key={i}
            className="bg-white/40 mix-blend-overlay"
            style={{ width: 12 + (i % 3) * 4, height: h + (i % 5) * 4 }}
          />
        ))}
      </div>
      {/* Text overlay */}
      <div className="absolute inset-0 flex items-start justify-between p-4">
        <div className="text-white">
          <div className="font-display font-extrabold text-[24px] leading-none drop-shadow-sm">
            {trip.name ?? 'Singapore'}
          </div>
          <div className="text-[12px] text-white/85 mt-1.5">
            {trip.numDays ?? 1} day{(trip.numDays ?? 1) !== 1 ? 's' : ''}
            {trip.startDate ? ` · ${dateLabel}` : ' · Flexible dates'}
          </div>
        </div>
        {dateLabel && (
          <span className="rounded-full bg-white/25 backdrop-blur border border-white/40 px-2 h-6 inline-flex items-center text-[11px] font-medium text-white">
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
    <span className="text-slate-500">{label}</span>
    <span className="font-display font-bold text-slate-900 tabular-nums">{value}</span>
  </div>
)

/* ── Trip card ───────────────────────────────────────────────────── */
const TripCard = ({ trip, onOpen, onStart }) => {
  const isToday = trip.status === 'today'
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
            {trip.numDays ?? 1} day{(trip.numDays ?? 1) !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <StatBadge icon={<MapPin size={11} />} label="Dest." value="Singapore" />
          {trip.savedAt && (
            <StatBadge
              icon={<Clock size={11} />}
              label="Saved"
              value={new Date(trip.savedAt).toLocaleDateString('en-SG', { month: 'short', day: 'numeric' })}
            />
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onOpen}
            className="flex-1 h-9 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition focus-ring inline-flex items-center justify-center gap-1.5"
          >
            <Edit size={12} /> Open
          </button>
          {isToday && (
            <button
              onClick={onStart}
              className="relative inline-flex items-center justify-center gap-1.5 h-9 rounded-lg px-4 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-display font-bold text-[13px] shadow-card hover:shadow-pop transition focus-ring overflow-hidden"
            >
              <span className="absolute inset-0 rounded-lg ring-4 ring-emerald-400/50 animate-ping pointer-events-none" />
              <Navigation2 size={13} /> Start Trip
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Today modal ─────────────────────────────────────────────────── */
const StartTodayModal = ({ trip, onStart, onClose }) => {
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
                  Live trip
                </div>
                <div className="font-display font-extrabold text-[18px] text-slate-900">
                  Your trip to Singapore starts today!
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
            Ready to explore? We'll navigate you through your itinerary.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={onClose}
              className="flex-1 h-10 rounded-md border border-slate-200 text-slate-700 font-semibold text-[14px] hover:bg-slate-50 transition"
            >
              Later
            </button>
            <button
              onClick={onStart}
              className="flex-1 h-10 rounded-md bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-display font-bold text-[14px] shadow-card inline-flex items-center justify-center gap-1.5 hover:shadow-pop transition"
            >
              <Navigation2 size={14} /> Ready to navigate
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

export default function Home() {
  const navigate = useNavigate()
  const { trips } = useSavedTrips()
  const [filter, setFilter] = useState('All')
  const [modalTrip, setModalTrip] = useState(null)

  useEffect(() => {
    const todayTrip = trips.find((t) => t.status === 'today')
    if (todayTrip) {
      const timer = setTimeout(() => setModalTrip(todayTrip), 350)
      return () => clearTimeout(timer)
    }
  }, [trips])

  const statusFilter = FILTER_MAP[filter]
  const filtered = statusFilter ? trips.filter((t) => t.status === statusFilter) : trips
  const todayCount = trips.filter((t) => t.status === 'today').length
  const upcomingCount = trips.filter((t) => t.status === 'upcoming').length

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top app bar */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-slate-200/70">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500 text-white shadow-card">
              <Navigation2 size={16} strokeWidth={2.5} />
            </div>
            <span className="font-display font-extrabold text-[18px] tracking-tight text-slate-900">IMOVE</span>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <button className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
              <Search size={15} />
            </button>
            <button className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
              <User size={15} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 pt-8 pb-16">
        {/* Hero header */}
        <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 inline-flex items-center gap-1.5">
              <Sparkles size={12} className="text-fuchsia-600" /> Your itineraries
            </div>
            <h1 className="font-display font-extrabold text-[34px] sm:text-[40px] leading-[1.05] tracking-tight text-slate-900 mt-1">
              Welcome back
            </h1>
            <p className="text-[14px] text-slate-500 mt-2">
              {trips.length} trip{trips.length !== 1 ? 's' : ''} saved
              {todayCount > 0 && (
                <span> · <span className="font-semibold text-emerald-700">{todayCount} happening today</span></span>
              )}
              {upcomingCount > 0 && <span> · {upcomingCount} upcoming</span>}
            </p>
          </div>
          <button
            onClick={() => navigate('/plan')}
            className="group relative inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-500 text-white font-display font-bold text-[14px] shadow-pop overflow-hidden focus-ring"
          >
            <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            <Plus size={15} strokeWidth={2.5} /> Create New Itinerary
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {FILTERS.map((f, i) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'h-8 px-3.5 rounded-full text-[12.5px] font-semibold border transition',
                filter === f
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Grid */}
        {trips.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500 text-white shadow-pop mb-6">
              <Navigation2 size={40} />
            </div>
            <h2 className="font-display font-bold text-2xl text-slate-900">Plan your Singapore adventure</h2>
            <p className="text-slate-500 mt-2 max-w-sm">
              Create your first trip with real MRT and bus routes, timed itineraries, and AI-powered suggestions.
            </p>
            <button
              onClick={() => navigate('/plan')}
              className="mt-6 inline-flex items-center gap-2 h-11 px-8 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-500 text-white font-display font-bold text-[14px] shadow-pop hover:opacity-90 transition focus-ring"
            >
              <Plus size={15} strokeWidth={2.5} /> Start Planning
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => (
              <TripCard
                key={t.id}
                trip={t}
                onOpen={() => navigate(`/trip/${t.id}`)}
                onStart={() => navigate(`/trip/${t.id}`)}
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
                  Plan a new trip
                </div>
                <div className="text-[12px] text-slate-500 mt-0.5">Start a fresh itinerary</div>
              </div>
            </button>
          </div>
        )}
      </main>

      <StartTodayModal
        trip={modalTrip}
        onStart={() => { setModalTrip(null); navigate(`/trip/${modalTrip.id}`) }}
        onClose={() => setModalTrip(null)}
      />
    </div>
  )
}
