import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  Building2,
  Calendar,
  Check,
  ChevronLeft,
  Clock,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
  Zap,
  Banknote,
  Footprints,
  Shuffle,
  User,
  ArrowLeft,
  ArrowUp,
  HelpCircle,
  SlidersHorizontal,
  Route,
  Minus,
  PencilLine,
  Wallet,
  ArrowRight,
  Sparkles,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../contexts/LanguageContext'
import { cn } from '../lib/utils'
import PlaceBrowser from '../components/planner/PlaceBrowser'
import AuroraBackground from '../components/planner/AuroraBackground'
import { Button } from '../components/ui/button'
import DateRangePicker, { isoToDate, dateToIso, daysBetweenInclusive } from '../components/ui/DateRangePicker'
import TimePicker from '../components/ui/TimePicker'

// Maps the chosen travel-style preset to a localized short label (Trip Config Summary).
const STYLE_LABEL_KEY = {
  fastest: 'plnFastest',
  cheapest: 'plnCheapest',
  leisure: 'plnLeastWalking',
  direct: 'plnLeastTransfers',
  user: 'plnUseProfile',
}

const PRESETS = {
  fastest: { duration_w: 0.70, cost_w: 0.10, walking_w: 0.10, transfers_w: 0.10 },
  cheapest: { duration_w: 0.10, cost_w: 0.70, walking_w: 0.10, transfers_w: 0.10 },
  leisure: { duration_w: 0.20, cost_w: 0.10, walking_w: 0.60, transfers_w: 0.10 },
  direct: { duration_w: 0.20, cost_w: 0.20, walking_w: 0.10, transfers_w: 0.50 },
}

// Qualitative priority shown to users instead of raw percentages (matches Preferences).
const LEVEL_META = {
  high: { labelKey: 'lvlHigh', segs: 3 },
  med: { labelKey: 'lvlMed', segs: 2 },
  low: { labelKey: 'lvlLow', segs: 1 },
}
function weightLevel(weight) {
  const w = Number(weight ?? 0)
  if (w >= 0.30) return 'high'
  if (w >= 0.18) return 'med'
  return 'low'
}

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

function PlaceMiniCard({ place, onRemove }) {
  const { t } = useT()
  return (
    <div className="group flex items-center gap-2.5 rounded-xl border border-slate-100 bg-white p-2 shadow-[0_4px_16px_-14px_rgba(15,23,42,0.35)] transition-shadow hover:shadow-md">
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-blue-50 via-emerald-50 to-amber-50">
        <div className="absolute inset-0 grid place-items-center text-blue-500">
          <MapPin size={15} />
        </div>
        {place.image_url ? (
          <img
            src={place.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="relative h-full w-full object-cover"
            onError={(event) => { event.currentTarget.style.display = 'none' }}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-extrabold text-slate-900">{place.name}</p>
        <p className="mt-0.5 truncate text-[9px] font-semibold capitalize text-slate-400">
          {place.category || t('tripCategoryFallback')} · {t('tripMinShort', place.dwell_minutes ?? place.suggested_duration_minutes ?? 60)}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
        title={t('tripRemove')}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

function SelectedList({ places, onRemove }) {
  const { t } = useT()
  if (!places.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
        <MapPin className="mx-auto h-6 w-6 text-slate-300" />
        <p className="mt-2 text-[12.5px] font-bold text-slate-600">{t('plnNoSelected')}</p>
        <p className="mt-1 text-[11.5px] text-slate-400">{t('plnNoSelectedDesc')}</p>
      </div>
    )
  }

  return (
    <div className="max-h-[240px] space-y-2 overflow-y-auto pr-1 xl:max-h-[calc(100dvh-550px)]">
      {places.map((place) => (
        <PlaceMiniCard key={place.id} place={place} onRemove={() => onRemove(place.id)} />
      ))}
    </div>
  )
}

// Editorial step header: brand icon chip + title + description (replaces plain "1/2/3/4")
function StepHeader({ Icon, title, desc, badge }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
        <Icon size={20} />
      </span>
      <div>
        <h2 className="font-display flex items-center gap-2 text-[19px] font-bold leading-tight text-slate-900">
          {title}
          {badge && <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{badge}</span>}
        </h2>
        {desc && <p className="text-[12.5px] text-slate-500">{desc}</p>}
      </div>
    </div>
  )
}

export default function Planner() {
  const navigate = useNavigate()
  const auth = useAuth()
  const user = auth?.user
  const { t } = useT()

  // Wizard steps: 1: Essentials, 2: Hotel, 3: Travel Style, 4: Places
  const [currentStep, setCurrentStep] = useState(1)

  const [placesById, setPlacesById] = useState({})
  const [placesLoading, setPlacesLoading] = useState(false)
  const [selected, setSelected] = useState([])
  const [tripName, setTripName] = useState('Singapore Trip')

  // Step 1: Essentials States
  const [numDays, setNumDays] = useState(3)
  const [budget, setBudget] = useState(50)
  const [flexible, setFlexible] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [optimizeOrder, setOptimizeOrder] = useState(true)
  const [dayStartTimes, setDayStartTimes] = useState(() => Array(3).fill('09:00'))
  // Daily-start mode: true = one time for every day (synced), false = per-day pickers
  const [syncDailyStart, setSyncDailyStart] = useState(true)

  // Sidebar states
  const [summaryOpen, setSummaryOpen] = useState(false)

  // Step 2: Hotel States (Optional)
  const [hotelQuery, setHotelQuery] = useState('')
  const [hotelResult, setHotelResult] = useState(null)
  const [hotelLoading, setHotelLoading] = useState(false)
  const [hotelNotFound, setHotelNotFound] = useState(false)
  const [hotel, setHotel] = useState(null)
  const hotelTimerRef = useRef(null)

  // Step 3: Travel Style Preset States
  const [selectedPreset, setSelectedPreset] = useState('fastest')

  // UI Flow States
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)

  // Floating "back to top" button for the long Sightseeing list (step 4)
  const [showScrollTop, setShowScrollTop] = useState(false)
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Fetch Curated Places
  useEffect(() => {
    setPlacesLoading(true)
    api.getCuratedPlaces()
      .then((places) => setPlacesById(Object.fromEntries((places ?? []).map((place) => [place.id, place]))))
      .catch(() => setPlacesById({}))
      .finally(() => setPlacesLoading(false))
  }, [])

  // Sync dayStartTimes array length when numDays changes (or when switching to synced mode)
  useEffect(() => {
    setDayStartTimes((prev) => {
      if (syncDailyStart) return Array(numDays).fill(prev[0] ?? '09:00')
      const next = Array(numDays).fill('09:00')
      for (let i = 0; i < Math.min(prev.length, numDays); i++) next[i] = prev[i]
      return next
    })
  }, [numDays, syncDailyStart])

  // Apply one time to every day (used by the synced daily-start picker)
  const setAllDayStart = (val) => setDayStartTimes(Array(numDays).fill(val))

  // Geocoding debounce for hotel search
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
  const curatedPlaces = useMemo(() => Object.values(placesById), [placesById])

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

  const createPlan = async () => {
    if (selected.length < 2) {
      setError(t('plnMin2Places'))
      return
    }
    setCreating(true)
    setError(null)
    try {
      const sessionId = localStorage.getItem('session_id') ?? generateId()
      localStorage.setItem('session_id', sessionId)

      const planStartDate = flexible ? null : startDate || null
      const planEndDate = flexible || !startDate ? null : endDate(startDate, numDays)
      const weightsObj = selectedPreset === 'user' ? {} : PRESETS[selectedPreset]
      const preferencesObj = {
        budget_sgd: Number(budget),
        ...weightsObj,
      }
      const tripMeta = {
        name: tripName.trim() || 'Singapore Trip',
        budget_sgd: Number(budget),
        startDate: planStartDate,
        start_date: planStartDate,
        endDate: planEndDate,
        end_date: planEndDate,
        numDays,
        dayStartTimes,
        startTime: dayStartTimes[0] ?? '09:00',
        travelStyle: selectedPreset,
        routeWeights: weightsObj,
        optimizeOrder,
        hotelName: hotel?.name ?? null,
        hotelLat: hotel?.lat ?? null,
        hotelLng: hotel?.lng ?? null,
      }

      const body = {
        session_id: sessionId,
        num_days: numDays,
        budget_sgd: Number(budget),
        start_date: planStartDate,
        end_date: planEndDate,
        day_start_times: dayStartTimes,
        name: tripMeta.name,
      }

      const trip = await api.createTrip(body)

      await api.planTrip(trip.trip_id, {
        place_ids: selected.map((place) => place.id),
        optimize_order: optimizeOrder,
        preferences: preferencesObj,
        hotel_name: hotel?.name ?? null,
        hotel_lat: hotel?.lat ?? null,
        hotel_lng: hotel?.lng ?? null,
        day_start_times: dayStartTimes,
      })

      // Auto-persist as unconfirmed draft so the trip survives navigation away from the planner
      api.saveTrip(trip.trip_id, { ...tripMeta, confirmed: false }, user?.id ?? null)

      navigate(`/trip/${trip.trip_id}`, {
        state: { pendingSave: tripMeta },
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  // Wizard Step triggers
  const goToStep = (step) => {
    if (step >= 1 && step <= 4) {
      startTransition(() => setCurrentStep(step))
    }
  }

  const handleNext = () => {
    if (currentStep === 4) {
      createPlan()
    } else {
      goToStep(currentStep + 1)
    }
  }

  const handlePrev = () => {
    goToStep(currentStep - 1)
  }

  return (
    <AuroraBackground>
      <div className="px-3 py-5 pb-24 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-7xl">

          {/* Header section */}
          <div className="mb-4 flex items-center gap-3 sm:mb-6 sm:gap-4">
            <button
              onClick={() => navigate('/')}
              className="grid h-9 w-9 place-items-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 hover:shadow-sm transition"
              title={t('plnBackHome')}
            >
              <ChevronLeft size={18} />
            </button>
            <div>
              <p className="text-[12px] font-bold uppercase tracking-wide text-blue-600">{t('plnEyebrow')}</p>
              <h1 className="font-display text-[24px] font-extrabold text-slate-900 sm:text-[28px]">{t('plnTitle')}</h1>
            </div>
          </div>

          {/* 2-Panel Layout */}
          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[1fr_360px] lg:gap-6">

            {/* Main Wizard Form Card (Left) */}
            <div className="flex min-h-[420px] min-w-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:min-h-[500px] sm:p-6">
              <div>
                {/* Steps Dot Indicator */}
                <div className="relative mb-5 grid grid-cols-4 gap-1 sm:mb-8 sm:flex sm:justify-between sm:px-6">
                  <div className="absolute left-10 right-10 top-[21px] -z-10 hidden h-0.5 bg-slate-100 sm:block" />
                  <div
                    className="absolute left-10 top-[21px] -z-10 hidden h-0.5 bg-blue-600 transition-all duration-300 sm:block"
                    style={{ width: `${((currentStep - 1) / 3) * 82}%` }}
                  />

                  {[
                    { label: t('plnStep1'), num: 1, Icon: SlidersHorizontal },
                    { label: t('plnStep2'), num: 2, Icon: Building2 },
                    { label: t('plnStep3'), num: 3, Icon: Route },
                    { label: t('plnStep4'), num: 4, Icon: MapPin },
                  ].map((s) => (
                    <button
                      key={s.num}
                      type="button"
                      onClick={() => goToStep(s.num)}
                      className="flex min-w-0 flex-col items-center focus:outline-none"
                    >
                      <div
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-full border transition sm:h-10 sm:w-10',
                          currentStep === s.num
                            ? 'border-blue-600 bg-blue-600 text-white shadow-card ring-2 ring-blue-100'
                            : currentStep > s.num
                              ? 'border-emerald-500 bg-emerald-500 text-white'
                              : 'border-slate-200 bg-white text-slate-400'
                        )}
                      >
                        {currentStep > s.num ? <Check size={16} /> : <s.Icon size={16} />}
                      </div>
                      <span
                        className={cn(
                          'mt-1.5 text-center text-[10px] font-semibold leading-tight transition sm:text-[12px]',
                          currentStep >= s.num ? 'text-slate-900' : 'text-slate-400'
                        )}
                      >
                        {s.label}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Form Contents */}
                <div className="space-y-4">

                  {/* STEP 1: Essentials */}
                  {currentStep === 1 && (
                    <div className="animate-fade-in">
                      <StepHeader Icon={SlidersHorizontal} title={t('plnGeneralSettings')} desc={t('plnGeneralDesc')} />

                      {/* Trip name — hero */}
                      <div className="border-t border-slate-100 py-4">
                        <label className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                          <PencilLine size={14} className="text-slate-400" /> {t('plnTripName')}
                        </label>
                        <input
                          value={tripName}
                          onChange={(e) => setTripName(e.target.value)}
                          style={{ height: 52 }}
                          className="font-display w-full rounded-[10px] border border-slate-200 bg-white px-4 text-[17px] font-semibold text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        />
                      </div>

                      {/* Budget — slider + presets */}
                      <div className="border-t border-slate-100 py-4">
                        <label className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                          <Wallet size={14} className="text-slate-400" /> {t('plnBudget')}
                        </label>
                        <div className="font-display text-[24px] font-bold text-slate-900">
                          S${budget} <span className="text-[13px] font-semibold text-slate-400">{t('plnBudgetPerDay')}</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="150"
                          step="5"
                          value={Math.min(150, Math.max(10, budget))}
                          onChange={(e) => setBudget(Number(e.target.value))}
                          className="mt-3 w-full accent-blue-600"
                          aria-label={t('plnBudget')}
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[30, 50, 80, 120].map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setBudget(v)}
                              className={cn(
                                'rounded-full border px-4 py-1.5 text-[13px] font-semibold transition',
                                budget === v
                                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                              )}
                            >
                              S${v}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Dates — segmented + stepper / calendar */}
                      <div className="border-t border-slate-100 py-4">
                        <label className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                          <Calendar size={14} className="text-slate-400" /> {t('plnDatesMode')}
                        </label>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                            <button
                              type="button"
                              onClick={() => setFlexible(true)}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition',
                                flexible ? 'btn-lift bg-blue-600 text-white shadow-btn' : 'text-slate-500 hover:text-slate-900'
                              )}
                            >
                              <Clock size={13} /> {t('plnFlexible')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setFlexible(false)}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition',
                                !flexible ? 'btn-lift bg-blue-600 text-white shadow-btn' : 'text-slate-500 hover:text-slate-900'
                              )}
                            >
                              <Calendar size={13} /> {t('plnCalendar')}
                            </button>
                          </div>
                          {flexible && (
                            <div className="inline-flex items-center overflow-hidden rounded-full border border-slate-200">
                              <button
                                type="button"
                                onClick={() => setNumDays(Math.max(1, numDays - 1))}
                                disabled={numDays <= 1}
                                className="grid h-11 w-11 place-items-center text-blue-600 transition hover:bg-slate-50 disabled:opacity-30"
                                aria-label="-1"
                              >
                                <Minus size={16} />
                              </button>
                              <span className="font-display min-w-[96px] text-center text-[15px] font-bold text-slate-900">{t('plnDaysValue', numDays)}</span>
                              <button
                                type="button"
                                onClick={() => setNumDays(Math.min(14, numDays + 1))}
                                disabled={numDays >= 14}
                                className="grid h-11 w-11 place-items-center text-blue-600 transition hover:bg-slate-50 disabled:opacity-30"
                                aria-label="+1"
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                        {!flexible && (
                          <div className="mt-3 animate-fade-in">
                            <DateRangePicker
                              appearance="scheduler"
                              from={isoToDate(startDate)}
                              to={isoToDate(endDate(startDate, numDays))}
                              onSelect={(range) => {
                                setStartDate(dateToIso(range.from))
                                if (range.from && range.to) setNumDays(daysBetweenInclusive(range.from, range.to))
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Daily start — synced / per-day */}
                      <div className="border-t border-slate-100 py-4">
                        <label className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                          <Clock size={14} className="text-slate-400" /> {t('plnDailyStart')}
                        </label>
                        <div className="mb-3 inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                          <button
                            type="button"
                            onClick={() => setSyncDailyStart(true)}
                            className={cn(
                              'rounded-full px-4 py-2 text-[12.5px] font-semibold transition',
                              syncDailyStart ? 'btn-lift bg-blue-600 text-white shadow-btn' : 'text-slate-500 hover:text-slate-900'
                            )}
                          >
                            {t('plnSyncSame')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSyncDailyStart(false)}
                            className={cn(
                              'rounded-full px-4 py-2 text-[12.5px] font-semibold transition',
                              !syncDailyStart ? 'btn-lift bg-blue-600 text-white shadow-btn' : 'text-slate-500 hover:text-slate-900'
                            )}
                          >
                            {t('plnSyncPer')}
                          </button>
                        </div>
                        {syncDailyStart ? (
                          <div className="flex max-w-[260px] items-center gap-2 rounded-[10px] border border-slate-200 bg-slate-50/50 px-3 py-2">
                            <Clock size={14} className="shrink-0 text-blue-600" />
                            <TimePicker
                              appearance="scheduler"
                              value={dayStartTimes[0] ?? '09:00'}
                              onChange={setAllDayStart}
                              ariaLabel={t('plnDailyStart')}
                              className="min-w-0 flex-1"
                            />
                          </div>
                        ) : (
                          <div className={cn('grid gap-2', numDays > 4 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
                            {Array.from({ length: numDays }, (_, i) => (
                              <div key={i} className="flex items-center gap-2 rounded-[10px] border border-slate-200 bg-slate-50/50 px-3 py-2">
                                <span className="w-9 shrink-0 text-[11px] font-bold text-slate-400">{t('tripDay', i + 1)}</span>
                                <TimePicker
                                  appearance="scheduler"
                                  value={dayStartTimes[i] ?? '09:00'}
                                  onChange={(val) => {
                                    const next = [...dayStartTimes]
                                    next[i] = val
                                    setDayStartTimes(next)
                                  }}
                                  ariaLabel={`${t('tripDay', i + 1)} ${t('plnDailyStart')}`}
                                  className="min-w-0 flex-1"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* STEP 2: Hotel Setup (Optional) */}
                  {currentStep === 2 && (
                    <div className="space-y-4 animate-fade-in">
                      <StepHeader Icon={Building2} title={t('plnHotelTitle')} desc={t('plnHotelDesc')} badge={t('plnOptional')} />

                      {hotel ? (
                        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm animate-pop-in">
                          <Building2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-bold text-slate-900">{hotel.name}</p>
                            {hotel.address && <p className="truncate text-[11.5px] text-slate-500 mt-0.5">{hotel.address}</p>}
                          </div>
                          <button
                            type="button"
                            onClick={() => { setHotel(null); setHotelQuery('') }}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-white hover:text-red-500 hover:shadow-sm transition"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <label className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-slate-500"><Search size={14} className="text-slate-400" />{t('plnHotelSearch')}</label>
                          <div className="relative">
                            <MapPin className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <input
                              value={hotelQuery}
                              onChange={(e) => setHotelQuery(e.target.value)}
                              placeholder={t('plnHotelPlaceholder')}
                              className="font-display h-12 w-full rounded-[10px] border border-slate-200 bg-white pl-10 pr-9 text-[15px] font-medium text-slate-900 placeholder:font-normal placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            />
                            {hotelLoading && (
                              <Loader2 size={16} className="absolute right-3.5 top-3.5 animate-spin text-slate-400" />
                            )}
                          </div>

                          {hotelResult && !hotelLoading && (
                            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-md z-10 absolute left-0 right-0">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px] font-semibold text-slate-800">{hotelQuery}</p>
                                <p className="truncate text-[11px] text-slate-500">{hotelResult.address}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setHotel({ name: hotelQuery.trim(), lat: hotelResult.lat, lng: hotelResult.lng, address: hotelResult.address })
                                  setHotelResult(null)
                                  setHotelQuery('')
                                }}
                                className="flex shrink-0 items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500 shadow-sm"
                              >
                                <Check size={11} /> {t('plnUse')}
                              </button>
                            </div>
                          )}
                          {hotelNotFound && !hotelLoading && (
                            <p className="mt-1.5 text-[11.5px] font-medium text-red-500 inline-flex items-center gap-1">
                              <AlertCircle size={12} /> {t('plnHotelNotFound')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* STEP 3: Travel Style Presets */}
                  {currentStep === 3 && (
                    <div className="space-y-4 animate-fade-in">
                      <StepHeader Icon={Route} title={t('plnTransitWeights')} desc={t('plnTransitDesc')} />

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <motion.button
                          type="button"
                          onClick={() => setSelectedPreset('fastest')}
                          whileHover={{ scale: 1.025, transition: { duration: 0.2 } }}
                          className={cn(
                            'flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition-colors transition-shadow hover:shadow-md',
                            selectedPreset === 'fastest'
                              ? 'border-blue-400 bg-blue-50/30 ring-1 ring-blue-300 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50'
                          )}
                        >
                          <div className="flex items-center gap-1.5 font-bold text-[14px] text-slate-900">
                            <Zap size={14} className="text-amber-500" /> {t('plnFastest')}
                          </div>
                          <p className="text-[11.5px] text-slate-400 leading-relaxed">{t('plnFastestDesc')}</p>
                        </motion.button>

                        <motion.button
                          type="button"
                          onClick={() => setSelectedPreset('cheapest')}
                          whileHover={{ scale: 1.025, transition: { duration: 0.2 } }}
                          className={cn(
                            'flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition-colors transition-shadow hover:shadow-md',
                            selectedPreset === 'cheapest'
                              ? 'border-blue-400 bg-blue-50/30 ring-1 ring-blue-300 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50'
                          )}
                        >
                          <div className="flex items-center gap-1.5 font-bold text-[14px] text-slate-900">
                            <Banknote size={14} className="text-emerald-500" /> {t('plnCheapest')}
                          </div>
                          <p className="text-[11.5px] text-slate-400 leading-relaxed">{t('plnCheapestDesc')}</p>
                        </motion.button>

                        <motion.button
                          type="button"
                          onClick={() => setSelectedPreset('leisure')}
                          whileHover={{ scale: 1.025, transition: { duration: 0.2 } }}
                          className={cn(
                            'flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition-colors transition-shadow hover:shadow-md',
                            selectedPreset === 'leisure'
                              ? 'border-blue-400 bg-blue-50/30 ring-1 ring-blue-300 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50'
                          )}
                        >
                          <div className="flex items-center gap-1.5 font-bold text-[14px] text-slate-900">
                            <Footprints size={14} className="text-blue-500" /> {t('plnLeastWalking')}
                          </div>
                          <p className="text-[11.5px] text-slate-400 leading-relaxed">{t('plnLeastWalkingDesc')}</p>
                        </motion.button>

                        <motion.button
                          type="button"
                          onClick={() => setSelectedPreset('direct')}
                          whileHover={{ scale: 1.025, transition: { duration: 0.2 } }}
                          className={cn(
                            'flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition-colors transition-shadow hover:shadow-md',
                            selectedPreset === 'direct'
                              ? 'border-blue-400 bg-blue-50/30 ring-1 ring-blue-300 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-slate-50'
                          )}
                        >
                          <div className="flex items-center gap-1.5 font-bold text-[14px] text-slate-900">
                            <Shuffle size={14} className="text-blue-500" /> {t('plnLeastTransfers')}
                          </div>
                          <p className="text-[11.5px] text-slate-400 leading-relaxed">{t('plnLeastTransfersDesc')}</p>
                        </motion.button>

                        {user && (
                          <motion.button
                            type="button"
                            onClick={() => setSelectedPreset('user')}
                            whileHover={{ scale: 1.025, transition: { duration: 0.2 } }}
                            style={{ gridColumn: '1 / -1' }}
                            className={cn(
                              'flex flex-col items-start gap-1 p-4 rounded-xl border text-left transition-colors transition-shadow hover:shadow-md',
                              selectedPreset === 'user'
                                ? 'border-emerald-400 bg-emerald-50/30 ring-1 ring-emerald-300 shadow-sm'
                                : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-slate-50'
                            )}
                          >
                            <div className="flex items-center gap-1.5 font-bold text-[14px] text-slate-900">
                              <User size={14} className="text-emerald-600" /> {t('plnUseProfile')}
                            </div>
                            <p className="text-[11.5px] text-slate-400 leading-relaxed">{t('plnUseProfileDesc')}</p>
                          </motion.button>
                        )}
                      </div>

                      {/* Preset breakdown preview */}
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mt-2">
                        <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400 mb-3">{t('plnWeightsAlloc')}</p>

                        {selectedPreset === 'user' ? (
                          <div className="py-2 text-center text-[12.5px] font-medium text-slate-500 flex items-center justify-center gap-1.5">
                            <Check size={14} className="text-emerald-600" /> {t('plnLoadsProfile')}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {[
                              { label: t('plnDimDuration'), key: 'duration_w', icon: Clock },
                              { label: t('plnDimCost'), key: 'cost_w', icon: Banknote },
                              { label: t('plnDimWalking'), key: 'walking_w', icon: Footprints },
                              { label: t('plnDimTransfers'), key: 'transfers_w', icon: Shuffle },
                            ].map((dim) => {
                              const meta = LEVEL_META[weightLevel(PRESETS[selectedPreset][dim.key])]
                              return (
                                <div key={dim.key} className="flex items-center justify-between gap-3">
                                  <span className="text-[12px] font-medium text-slate-700 inline-flex items-center gap-1.5">
                                    <dim.icon size={13} className="text-slate-400" />
                                    {dim.label}
                                  </span>
                                  <span className="inline-flex items-center gap-2">
                                    <span className="flex gap-0.5" aria-hidden="true">
                                      {[1, 2, 3].map((s) => (
                                        <span
                                          key={s}
                                          className={cn(
                                            'h-1.5 w-4 rounded-full transition-colors',
                                            s <= meta.segs ? 'bg-blue-600' : 'bg-slate-200'
                                          )}
                                        />
                                      ))}
                                    </span>
                                    <span className="w-14 text-right text-[12px] font-bold text-blue-700">{t(meta.labelKey)}</span>
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* STEP 4: Places Selection — full-width browser; selected + actions live in the sidebar */}
                  {currentStep === 4 && (
                    <div className="space-y-4 animate-fade-in">
                      <StepHeader Icon={MapPin} title={t('plnAttractions')} desc={t('plnPickSights')} badge={t('plnStep4of4')} />
                      <PlaceBrowser
                        selectedIds={selectedIds}
                        onToggle={togglePlace}
                        places={curatedPlaces}
                        loading={placesLoading}
                      />
                    </div>
                  )}

                </div>
              </div>

              {/* Navigation buttons */}
              {currentStep !== 4 && (
                <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePrev}
                    disabled={currentStep === 1}
                  >
                    <ArrowLeft size={15} /> {t('tripBack')}
                  </Button>
                  <Button type="button" onClick={handleNext} disabled={creating} className="px-6">
                    {t('plnNextIdle')} <ArrowRight size={15} />
                  </Button>
                </div>
              )}

            </div>

            {/* Sidebar Info/JSON Panel (Right) */}
            <aside className="hidden space-y-4 lg:block">

              {/* Summary Info */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
                  <div className="grid h-7 w-7 place-items-center rounded bg-blue-50 text-blue-600"><Calendar size={16} /></div>
                  <h3 className="font-display font-bold text-[15px] text-slate-900">{t('plnConfigSummary')}</h3>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between border-b border-slate-100/50 pb-2">
                    <span className="text-[12px] text-slate-400 font-medium">{t('plnTripName')}</span>
                    <span className="text-[12.5px] font-bold text-slate-800 max-w-[160px] truncate" title={tripName}>{tripName}</span>
                  </div>

                  <div className="flex justify-between border-b border-slate-100/50 pb-2">
                    <span className="text-[12px] text-slate-400 font-medium">{t('plnDuration')}</span>
                    <span className="text-[12.5px] font-bold text-slate-800">{t('plnDaysValue', numDays)}</span>
                  </div>

                  <div className="flex justify-between border-b border-slate-100/50 pb-2">
                    <span className="text-[12px] text-slate-400 font-medium">{t('plnSumBudget')}</span>
                    <span className="text-[12.5px] font-bold text-slate-800">S${budget.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between border-b border-slate-100/50 pb-2">
                    <span className="text-[12px] text-slate-400 font-medium">{t('plnHotelStart')}</span>
                    <span
                      className={cn('text-[12.5px] font-bold max-w-[180px] truncate', hotel ? 'text-blue-600' : 'text-slate-400')}
                      title={hotel ? hotel.name : t('plnStartsFirstStop')}
                    >
                      {hotel ? hotel.name : t('plnNotSet')}
                    </span>
                  </div>

                  <div className="flex justify-between border-b border-slate-100/50 pb-2">
                    <span className="text-[12px] text-slate-400 font-medium">{t('plnTravelStyle')}</span>
                    <span className="text-[12.5px] font-bold text-amber-600">{t(STYLE_LABEL_KEY[selectedPreset] ?? 'plnFastest')}</span>
                  </div>

                  <div className="flex justify-between pb-1">
                    <span className="text-[12px] text-slate-400 font-medium">{t('plnStopsSelected')}</span>
                    <span className="text-[12.5px] font-bold text-slate-800">{t('plnStopsValue', selected.length)}</span>
                  </div>
                </div>
              </section>

              {/* Step 4 — selected shortlist, auto-optimize, and the generate action live here */}
              {currentStep === 4 && (
                <>
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-display text-[14px] font-bold text-slate-900">{t('plnSelectedShortlist', selected.length)}</h3>
                      <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">{selected.length}</span>
                    </div>
                    <SelectedList places={selected} onRemove={removePlace} />
                  </section>

                  <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-0.5 pr-3">
                      <span className="text-[13px] font-bold text-slate-900">{t('plnAutoOptimize')}</span>
                      <span className="text-[11.5px] text-slate-400">{t('plnAutoOptimizeDesc')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOptimizeOrder(!optimizeOrder)}
                      aria-pressed={optimizeOrder}
                      className={cn(
                        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none',
                        optimizeOrder ? 'bg-blue-600' : 'bg-slate-200'
                      )}
                    >
                      <span className={cn('pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition', optimizeOrder ? 'translate-x-5' : 'translate-x-0')} />
                    </button>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      size="lg"
                      onClick={createPlan}
                      disabled={creating || selected.length < 2}
                      className="w-full"
                    >
                      {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      {creating ? t('plnGenerating') : t('plnGeneratePlan')}
                    </Button>
                    <Button type="button" variant="outline" onClick={handlePrev} className="w-full">
                      <ArrowLeft size={15} /> {t('tripBack')}
                    </Button>
                  </div>
                </>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 shadow-sm animate-pop-in">
                  <AlertCircle size={14} className="text-red-600 shrink-0 mt-0.5" />
                  <p className="text-[12px] font-medium text-red-700 leading-normal">{error}</p>
                </div>
              )}
            </aside>

          </div>
        </div>

        <div className="lg:hidden">
          <button
            type="button"
            onClick={() => setSummaryOpen(true)}
            aria-expanded={summaryOpen}
            aria-controls="planner-summary-drawer"
            aria-label={t('plnConfigSummary')}
            className="fixed right-0 top-1/2 z-40 grid h-12 w-10 -translate-y-1/2 place-items-center rounded-l-2xl border border-r-0 border-slate-200 bg-white text-blue-700 shadow-pop active:scale-95"
          >
            <HelpCircle size={18} />
          </button>

          {summaryOpen && (
            <div className="fixed inset-0 z-50">
              <button
                type="button"
                aria-label={t('chatClose')}
                onClick={() => setSummaryOpen(false)}
                className="absolute inset-0 bg-slate-950/35 backdrop-blur-[2px]"
              />
              <aside
                id="planner-summary-drawer"
                className="absolute right-0 top-0 flex h-full w-[min(88vw,360px)] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl animate-pop-in"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                  <div>
                    <p className="text-[11px] font-extrabold uppercase tracking-wide text-blue-600">{t('plnEyebrow')}</p>
                    <h2 className="font-display text-[17px] font-extrabold text-slate-950">{t('plnConfigSummary')}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSummaryOpen(false)}
                    aria-label={t('chatClose')}
                    className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-4 flex items-center gap-1.5 border-b border-slate-100 pb-3">
                      <div className="grid h-7 w-7 place-items-center rounded bg-blue-50 text-blue-600"><Calendar size={16} /></div>
                      <h3 className="font-display text-[15px] font-bold text-slate-900">{t('plnConfigSummary')}</h3>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between gap-3 border-b border-slate-100/50 pb-2">
                        <span className="text-[12px] font-medium text-slate-400">{t('plnTripName')}</span>
                        <span className="max-w-[160px] truncate text-[12.5px] font-bold text-slate-800" title={tripName}>{tripName}</span>
                      </div>

                      <div className="flex justify-between gap-3 border-b border-slate-100/50 pb-2">
                        <span className="text-[12px] font-medium text-slate-400">{t('plnDuration')}</span>
                        <span className="text-[12.5px] font-bold text-slate-800">{t('plnDaysValue', numDays)}</span>
                      </div>

                      <div className="flex justify-between gap-3 border-b border-slate-100/50 pb-2">
                        <span className="text-[12px] font-medium text-slate-400">{t('plnSumBudget')}</span>
                        <span className="text-[12.5px] font-bold text-slate-800">S${budget.toFixed(2)}</span>
                      </div>

                      <div className="flex justify-between gap-3 border-b border-slate-100/50 pb-2">
                        <span className="text-[12px] font-medium text-slate-400">{t('plnHotelStart')}</span>
                        <span
                          className={cn('max-w-[180px] truncate text-right text-[12.5px] font-bold', hotel ? 'text-blue-600' : 'text-slate-400')}
                          title={hotel ? hotel.name : t('plnStartsFirstStop')}
                        >
                          {hotel ? hotel.name : t('plnNotSet')}
                        </span>
                      </div>

                      <div className="flex justify-between gap-3 border-b border-slate-100/50 pb-2">
                        <span className="text-[12px] font-medium text-slate-400">{t('plnTravelStyle')}</span>
                        <span className="text-right text-[12.5px] font-bold text-amber-600">{t(STYLE_LABEL_KEY[selectedPreset] ?? 'plnFastest')}</span>
                      </div>

                      <div className="flex justify-between gap-3 pb-1">
                        <span className="text-[12px] font-medium text-slate-400">{t('plnStopsSelected')}</span>
                        <span className="text-[12.5px] font-bold text-slate-800">{t('plnStopsValue', selected.length)}</span>
                      </div>
                    </div>
                  </section>

                  {currentStep === 4 && (
                    <>
                      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="mb-3 flex items-center justify-between">
                          <h3 className="font-display text-[14px] font-bold text-slate-900">{t('plnSelectedShortlist', selected.length)}</h3>
                          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">{selected.length}</span>
                        </div>
                        <SelectedList places={selected} onRemove={removePlace} />
                      </section>

                      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-0.5 pr-3">
                          <span className="text-[13px] font-bold text-slate-900">{t('plnAutoOptimize')}</span>
                          <span className="text-[11.5px] text-slate-400">{t('plnAutoOptimizeDesc')}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setOptimizeOrder(!optimizeOrder)}
                          aria-pressed={optimizeOrder}
                          className={cn(
                            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none',
                            optimizeOrder ? 'bg-blue-600' : 'bg-slate-200'
                          )}
                        >
                          <span className={cn('pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition', optimizeOrder ? 'translate-x-5' : 'translate-x-0')} />
                        </button>
                      </div>
                    </>
                  )}

                  {error && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 shadow-sm animate-pop-in">
                      <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-600" />
                      <p className="text-[12px] font-medium leading-normal text-red-700">{error}</p>
                    </div>
                  )}
                </div>

                {currentStep === 4 && (
                  <div className="shrink-0 space-y-2 border-t border-slate-200 bg-white/95 p-4 shadow-[0_-12px_30px_-24px_rgba(15,23,42,0.35)] backdrop-blur">
                    <Button
                      type="button"
                      size="lg"
                      onClick={createPlan}
                      disabled={creating || selected.length < 2}
                      className="w-full"
                    >
                      {creating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      {creating ? t('plnGenerating') : t('plnGeneratePlan')}
                    </Button>
                    <Button type="button" variant="outline" onClick={handlePrev} className="w-full">
                      <ArrowLeft size={15} /> {t('tripBack')}
                    </Button>
                  </div>
                )}
              </aside>
            </div>
          )}
        </div>

        {showScrollTop && (
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            title={t('plnBackToTop')}
            aria-label={t('plnBackToTop')}
            className="fixed bottom-[88px] right-5 z-40 grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-pop transition hover:bg-slate-50 active:scale-95 sm:left-5 sm:right-auto sm:z-[60]"
          >
            <ArrowUp size={18} />
          </button>
        )}
      </div>
    </AuroraBackground>
  )
}
