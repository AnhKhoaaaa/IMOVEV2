import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Clock,
  Loader2,
  MapPin,
  Navigation2,
  Plus,
  RadioTower,
  Route,
  Trash2,
} from 'lucide-react'
import { api } from '../services/api'
import { useSavedTrips } from '../hooks/useSavedTrips'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../contexts/LanguageContext'
import { formatDateRange } from '../lib/tripUtils'
import { cn } from '../lib/utils'
import { ImageCarouselHero } from '../components/ui/ai-image-generator-hero'
import { WaveLightShader } from '../components/ui/wave-light-shader'
import { AnimatedGlowingSearchBar } from '../components/ui/animated-glowing-search-bar'
import { CinematicFooter } from '../components/ui/motion-footer'
import ConfirmDialog from '../components/ui/ConfirmDialog'

const FILTERS = [
  { id: 'all', labelKey: 'filter_All' },
  { id: 'today', labelKey: 'filter_Today' },
  { id: 'upcoming', labelKey: 'filter_Upcoming' },
  { id: 'draft', labelKey: 'filter_Drafts' },
  { id: 'past', labelKey: 'filter_Past' },
]

const STATUS = {
  today: { labelKey: 'homeStatusToday', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500 animate-pulse' },
  upcoming: { labelKey: 'homeStatusUpcoming', tone: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  draft: { labelKey: 'homeStatusDraft', tone: 'border-slate-200 bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  past: { labelKey: 'homeStatusPast', tone: 'border-slate-200 bg-white text-slate-500', dot: 'bg-slate-300' },
}

const HERO_IMAGES = [
  { id: 'temple', src: '/imove-hero/buddha-tooth-temple.png', alt: 'Buddha Tooth Relic Temple in Chinatown', rotation: -8 },
  { id: 'jewel', src: '/imove-hero/jewel-changi.png', alt: 'Rain Vortex at Jewel Changi Airport', rotation: 5 },
  { id: 'sentosa', src: '/imove-hero/sentosa-beach.png', alt: 'Friends enjoying Sentosa beach', rotation: -5 },
  { id: 'merlion', src: '/imove-hero/merlion.png', alt: 'Merlion and Marina Bay Sands', rotation: 7 },
  { id: 'hawker', src: '/imove-hero/hawker-centre.png', alt: 'Family dining at a Singapore hawker centre', rotation: -7 },
  { id: 'helix', src: '/imove-hero/helix-bridge.png', alt: 'Helix Bridge and Singapore skyline at night', rotation: 5 },
  { id: 'supertree', src: '/imove-hero/supertree-grove.png', alt: 'Supertree Grove at Gardens by the Bay', rotation: -4 },
  { id: 'haji', src: '/imove-hero/haji-lane.png', alt: 'Visitors exploring colorful Haji Lane', rotation: 6 },
]

function isTodayOrTomorrow(trip) {
  if (!trip?.startDate) return false
  const today = new Date()
  const todayKey = today.toISOString().slice(0, 10)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const tomorrowKey = tomorrow.toISOString().slice(0, 10)
  return trip.startDate === todayKey || trip.startDate === tomorrowKey
}

function sessionBody() {
  const sessionId = localStorage.getItem('session_id')
  return sessionId ? { session_id: sessionId } : {}
}

function TripCard({ trip, hydrated, loading, onOpen, onStart, onDelete }) {
  const { t } = useT()
  const meta = STATUS[trip.status] ?? STATUS.draft
  const days = hydrated?.days?.length ?? trip.numDays ?? 1
  const stops = hydrated?.places?.length
  const warnings = hydrated?.warnings?.length ?? 0

  return (
    <article className="group rounded-lg border border-slate-200 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-pop">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-bold', meta.tone)}>
            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
            {t(meta.labelKey)}
          </span>
          <h2 className="mt-3 truncate font-display text-[20px] font-extrabold text-slate-950">
            {trip.name ?? t('tripDefaultName')}
          </h2>
          <p className="mt-1 text-[12px] text-slate-500">
            {trip.startDate ? formatDateRange(trip.startDate, trip.numDays ?? 1) : t('flexibleDates')}
          </p>
        </div>
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
          <Route size={18} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('homeDays')}</p>
          <p className="mt-1 font-display text-[18px] font-extrabold text-slate-900">{days}</p>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('homeStops')}</p>
          <p className="mt-1 font-display text-[18px] font-extrabold text-slate-900">
            {loading ? <Loader2 size={16} className="animate-spin" /> : stops ?? '-'}
          </p>
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{t('homeAlerts')}</p>
          <p className={cn('mt-1 font-display text-[18px] font-extrabold', warnings ? 'text-amber-600' : 'text-slate-900')}>
            {warnings}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onOpen(trip)}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 text-[13px] font-bold text-white btn-lift shadow-sm hover:shadow-md hover:bg-blue-700"
        >
          {t('openBtn')} <ArrowRight size={14} />
        </button>
        {trip.status === 'today' && (
          <button
            onClick={() => onStart(trip)}
            className="flex h-9 items-center justify-center gap-1.5 rounded-md border border-emerald-100 bg-emerald-50 px-3 text-[13px] font-bold text-emerald-700 hover:bg-emerald-100"
          >
            {t('homeStart')}
          </button>
        )}
        <button
          onClick={() => onDelete(trip)}
          className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-500"
          title={t('homeDeleteTitle')}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  )
}

function ScrollReveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        node.classList.add('is-visible')
        observer.unobserve(node)
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px' }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={cn('home-scroll-reveal', className)}
      style={{ '--home-reveal-delay': `${delay}ms` }}
    >
      {children}
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useT()
  const { trips, remove } = useSavedTrips(user?.id)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [hydrated, setHydrated] = useState({})
  const [loadingIds, setLoadingIds] = useState(new Set())
  const [openingId, setOpeningId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const inFlightRef = useRef(new Set())

  const heroFeatures = useMemo(() => [
    { title: t('homeFeature1Title'), description: t('homeFeature1Desc') },
    { title: t('homeFeature2Title'), description: t('homeFeature2Desc') },
    { title: t('homeFeature3Title'), description: t('homeFeature3Desc') },
  ], [t])

  useEffect(() => {
    setHydrated({})
    inFlightRef.current.clear()
    setLoadingIds(new Set())
  }, [user?.id])

  useEffect(() => {
    trips.forEach((trip) => {
      if (!trip.id || hydrated[trip.id] || inFlightRef.current.has(trip.id)) return
      inFlightRef.current.add(trip.id)
      setLoadingIds((ids) => new Set(ids).add(trip.id))
      api.getTrip(trip.id)
        .then((data) => {
          setHydrated((current) => ({ ...current, [trip.id]: data }))
        })
        .catch(() => {})
        .finally(() => {
          inFlightRef.current.delete(trip.id)
          setLoadingIds((ids) => {
            const next = new Set(ids)
            next.delete(trip.id)
            return next
          })
        })
    })
  }, [trips]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredTrips = useMemo(() => {
    const q = search.trim().toLowerCase()
    return trips.filter((trip) => {
      const matchesFilter = filter === 'all' || trip.status === filter
      const matchesSearch = !q || (trip.name ?? '').toLowerCase().includes(q)
      return matchesFilter && matchesSearch
    })
  }, [trips, filter, search])

  const stats = useMemo(() => ({
    all: trips.length,
    today: trips.filter((trip) => trip.status === 'today').length,
    upcoming: trips.filter((trip) => trip.status === 'upcoming').length,
    draft: trips.filter((trip) => trip.status === 'draft').length,
    past: trips.filter((trip) => trip.status === 'past').length,
  }), [trips])

  const primeAlerts = async (trip) => {
    if (!isTodayOrTomorrow(trip)) return
    await api.checkAlerts(trip.id, sessionBody()).catch(() => {})
  }

  const openTrip = async (trip, autoStart = false) => {
    setOpeningId(trip.id)
    await primeAlerts(trip)
    setOpeningId(null)
    navigate(`/trip/${trip.id}`, { state: autoStart ? { autoStart: true } : undefined })
  }

  const confirmDelete = async () => {
    const trip = pendingDelete
    setPendingDelete(null)
    if (!trip) return
    await api.deleteTrip(trip.id).catch(() => {})
    remove(trip.id)
  }

  return (
    <main className="min-h-[calc(100dvh-56px)] bg-slate-50">
      <ImageCarouselHero
        title={t('homeHeroCarouselTitle')}
        description={t('homeHeroCarouselDesc')}
        ctaText={t('homeHeroCta')}
        secondaryCtaText={t('homeHeroSecondaryCta')}
        onCtaClick={() => navigate('/plan')}
        onSecondaryCtaClick={() => navigate('/settings')}
        images={HERO_IMAGES}
        features={heroFeatures}
      />

      <section className="relative isolate overflow-hidden border-b border-slate-200 bg-gradient-to-r from-white via-blue-50/70 to-white">
        <WaveLightShader className="absolute -inset-x-[8%] -inset-y-20 h-[calc(100%+10rem)] w-[116%] opacity-50 mix-blend-multiply" />
        <div className="pointer-events-none absolute inset-0 bg-white/20" />
        <div className="relative mx-auto max-w-7xl px-6 py-6">
          <ScrollReveal>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="group stats-floating-card rounded-xl border border-white/15 bg-white/90 p-4 shadow-[0_12px_34px_-18px_rgba(59,130,246,0.8)] backdrop-blur-md">
                <CalendarDays className="stats-floating-icon h-5 w-5 text-blue-600" />
                <p className="mt-3 font-display text-[28px] font-extrabold text-slate-950">{stats.today}</p>
                <p className="text-[12px] font-semibold text-slate-500">{t('homeStatToday')}</p>
              </div>
              <div className="group stats-floating-card stats-floating-card-delay-1 rounded-xl border border-white/15 bg-white/90 p-4 shadow-[0_12px_34px_-18px_rgba(16,185,129,0.75)] backdrop-blur-md">
                <Clock className="stats-floating-icon stats-floating-icon-delay-1 h-5 w-5 text-emerald-600" />
                <p className="mt-3 font-display text-[28px] font-extrabold text-slate-950">{stats.upcoming}</p>
                <p className="text-[12px] font-semibold text-slate-500">{t('homeStatUpcoming')}</p>
              </div>
              <div className="group stats-floating-card stats-floating-card-delay-2 rounded-xl border border-white/15 bg-white/90 p-4 shadow-[0_12px_34px_-18px_rgba(245,158,11,0.75)] backdrop-blur-md">
                <RadioTower className="stats-floating-icon stats-floating-icon-delay-2 h-5 w-5 text-amber-600" />
                <p className="mt-3 font-display text-[28px] font-extrabold text-slate-950">{t('homeLive')}</p>
                <p className="text-[12px] font-semibold text-slate-500">{t('homeLtaWeather')}</p>
              </div>
              <div className="group stats-floating-card stats-floating-card-delay-3 rounded-xl border border-white/15 bg-white/90 p-4 shadow-[0_12px_34px_-18px_rgba(239,68,68,0.7)] backdrop-blur-md">
                <AlertTriangle className="stats-floating-icon stats-floating-icon-delay-3 h-5 w-5 text-red-500" />
                <p className="mt-3 font-display text-[28px] font-extrabold text-slate-950">0</p>
                <p className="text-[12px] font-semibold text-slate-500">{t('homeOpenAlerts')}</p>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      {(() => {
        const todayTrip = trips.find((tr) => tr.status === 'today')
        if (!todayTrip) return null
        return (
          <ScrollReveal>
            <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-3">
              <div className="mx-auto flex max-w-7xl items-center gap-3">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                <p className="text-[13px] font-semibold text-emerald-800">
                  <span className="font-bold">{todayTrip.name ?? t('tripDefaultName')}</span> {t('homeStartsTodaySuffix')}
                </p>
                <button
                  onClick={() => openTrip(todayTrip, true)}
                  className="ml-auto flex h-8 items-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[12px] font-bold text-white hover:bg-emerald-500"
                >
                  <Navigation2 size={13} /> {t('homeStart')}
                </button>
              </div>
            </div>
          </ScrollReveal>
        )
      })()}

      <section className="mx-auto max-w-7xl px-6 py-6">
        <ScrollReveal>
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex rounded-lg border border-slate-200 bg-white p-1 shadow-card">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    'h-9 rounded-md px-3 text-[13px] font-bold transition',
                    filter === item.id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                  )}
                >
                  {t(item.labelKey)}
                  <span className="ml-1.5 text-[11px] opacity-70">{stats[item.id] ?? stats.all}</span>
                </button>
              ))}
            </div>
            <AnimatedGlowingSearchBar
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('homeSearch')}
              className="w-[320px]"
            />
          </div>
        </ScrollReveal>

        {filteredTrips.length ? (
          <div className="grid grid-cols-3 gap-4">
            {filteredTrips.map((trip, index) => (
              <ScrollReveal key={trip.id} delay={Math.min(index, 5) * 90}>
                <div className="relative">
                  {openingId === trip.id && (
                    <div className="absolute inset-0 z-10 grid place-items-center rounded-lg bg-white/70 backdrop-blur-sm">
                      <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                    </div>
                  )}
                  <TripCard
                    trip={trip}
                    hydrated={hydrated[trip.id]}
                    loading={loadingIds.has(trip.id)}
                    onOpen={(item) => openTrip(item)}
                    onStart={(item) => openTrip(item, true)}
                    onDelete={(item) => setPendingDelete(item)}
                  />
                </div>
              </ScrollReveal>
            ))}
          </div>
        ) : (
          <ScrollReveal delay={100}>
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
              <MapPin className="mx-auto h-8 w-8 text-slate-300" />
              <h2 className="mt-3 font-display text-[22px] font-extrabold text-slate-950">{t('homeNoTrips')}</h2>
              <p className="mt-2 text-[14px] text-slate-500">{t('homeNoTripsDesc')}</p>
              <button
                onClick={() => navigate('/plan')}
                className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-[13px] font-bold text-white btn-lift shadow-sm hover:shadow-md hover:bg-blue-700"
              >
                <Plus size={15} /> {t('newTrip')}
              </button>
            </div>
          </ScrollReveal>
        )}
      </section>
      <CinematicFooter />

      <ConfirmDialog
        open={!!pendingDelete}
        title={t('confirmDeleteTitle')}
        message={pendingDelete ? t('homeDeleteConfirm', pendingDelete.name ?? t('tripDefaultName')) : ''}
        confirmLabel={t('confirmDeleteBtn')}
        cancelLabel={t('cancelBtn')}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </main>
  )
}
