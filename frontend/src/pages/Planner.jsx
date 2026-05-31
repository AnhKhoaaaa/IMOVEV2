import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  MapPin, Sparkles, AlertCircle, Loader2, Navigation2, Calendar, Clock,
  ChevronDown, Plus, X, ChevronLeft, Pencil,
} from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../contexts/LanguageContext'
import { cn } from '../lib/utils'
import { Alert, AlertDescription } from '../components/ui/alert'
import PlaceSearch from '../components/planner/PlaceSearch'

/* ── Constants ───────────────────────────────────────────────────── */
const COMPANIONS = [
  { id: 'solo',    emoji: '🚶' },
  { id: 'family',  emoji: '👨‍👩‍👧‍👦' },
  { id: 'couple',  emoji: '💑' },
  { id: 'friends', emoji: '👬' },
  { id: 'elderly', emoji: '👵' },
]
const STYLES = [
  { id: 'cultural',   emoji: '🎭' },
  { id: 'classic',    emoji: '🌟' },
  { id: 'nature',     emoji: '🌿' },
  { id: 'cityscape',  emoji: '🏙️' },
  { id: 'historical', emoji: '🏛️' },
]
const PACES = [
  { id: 'ambitious', emoji: '📅', budget: 35,  walk: 5  },
  { id: 'moderate',  emoji: '⚖️', budget: 60,  walk: 15 },
  { id: 'relaxed',   emoji: '🌴', budget: 100, walk: 30 },
]

/* ── Helpers ─────────────────────────────────────────────────────── */
const generateId = () =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function haversineKm(a, b) {
  if (!a?.lat || !b?.lat) return 5
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
}

function dist(a, b) {
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
  const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
}

function selectPlaces(allPlaces, styles, numDays, pace) {
  const styleToCategory = {
    cultural: ['museum', 'heritage'], classic: ['landmark'],
    nature: ['nature'], cityscape: ['landmark', 'entertainment'], historical: ['heritage', 'museum'],
  }
  const preferredCats = [...new Set(styles.flatMap((s) => styleToCategory[s] ?? []))]
  const maxPlaces = Math.min(6, Math.max(3, numDays * 2))
  const MIN_KM = 1.0
  const sorted = [...allPlaces].sort((a, b) => {
    const aP = preferredCats.includes(a.category) ? 0 : 1
    const bP = preferredCats.includes(b.category) ? 0 : 1
    if (aP !== bP) return aP - bP
    if (pace === 'relaxed') return (a.is_outdoor ? 1 : 0) - (b.is_outdoor ? 1 : 0)
    return 0
  })
  const selected = []
  for (const p of sorted) {
    if (selected.length >= maxPlaces) break
    if (!selected.some((s) => dist(p, s) < MIN_KM)) selected.push(p)
  }
  return selected.map((p) => p.id)
}

/* ── Sub-components ──────────────────────────────────────────────── */

const Chip = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-2 rounded-full border px-3.5 h-9 text-[13.5px] font-medium transition whitespace-nowrap',
      active
        ? 'border-indigo-300 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
    )}
  >
    {children}
  </button>
)

function PlaceRow({ place, index, onRemove }) {
  const { t } = useT()
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 group">
      <span className="text-[11px] font-bold text-slate-400 w-4 shrink-0 tabular-nums">{index + 1}</span>
      <MapPin size={13} className="text-slate-400 shrink-0" />
      <span className="flex-1 text-[13px] font-medium text-slate-800 truncate">{place.name}</span>
      {place.category && (
        <span className="text-[10.5px] text-slate-400 capitalize shrink-0 hidden sm:block">{place.category}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="grid h-5 w-5 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 opacity-0 group-hover:opacity-100 transition shrink-0"
        aria-label={t('noPlacesTitle')}
      >
        <X size={11} />
      </button>
    </div>
  )
}

/* ── Main ────────────────────────────────────────────────────────── */
export default function Planner() {
  const navigate = useNavigate()
  const { t } = useT()
  const { user: authUser } = useAuth() ?? {}

  const [planMode, setPlanMode] = useState(null)

  /* ── Shared ────────────────────────── */
  const [loading, setLoading]       = useState(false)
  const [submitError, setSubmitError] = useState(null)

  /* ── Manual state ──────────────────── */
  const [tripName, setTripName]             = useState('')
  const [manFlexible, setManFlexible]       = useState(true)
  const [manStartDate, setManStartDate]     = useState('')
  const [manNumDays, setManNumDays]         = useState(3)
  const [builder, setBuilder]   = useState({ places: [] })
  const [showSearch, setShowSearch] = useState(false)

  const addPlace = (place) => {
    if (builder.places.some(p => p.id === place.id)) return
    setBuilder(prev => ({ places: [...prev.places, place] }))
  }

  const removePlace = (idx) => {
    setBuilder(prev => ({ places: prev.places.filter((_, i) => i !== idx) }))
  }

  const submitManual = async () => {
    if (builder.places.length === 0) { setSubmitError(t('addAtLeastOne')); return }
    setLoading(true); setSubmitError(null)
    try {
      const sessionId = localStorage.getItem('session_id') ?? generateId()
      localStorage.setItem('session_id', sessionId)

      const trip = await api.createTrip({ session_id: sessionId, num_days: manNumDays, budget_sgd: 60 })
      await api.planTrip(trip.trip_id, {
        place_ids: builder.places.map(p => p.id),
        optimize_order: false,
        preferences: {
          prefer_mrt: true,
          max_walk_minutes: 20,
          travel_styles: [],
          group_type: 'solo',
        },
      })
      const draftName = tripName.trim() || 'Singapore Trip'
      const draftMeta = { name: draftName, startDate: manFlexible ? null : manStartDate, numDays: manNumDays, isDraft: true }
      // Auto-save as draft immediately — trip survives tab close before user hits Save
      api.saveTrip(trip.trip_id, draftMeta, authUser?.id ?? null)
      navigate(`/trip/${trip.trip_id}`, {
        state: { pendingSave: { name: draftName, startDate: manFlexible ? null : manStartDate, numDays: manNumDays } },
      })
    } catch (e) {
      setSubmitError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /* ── AI state ──────────────────────── */
  const [aiStartDate, setAiStartDate]       = useState('')
  const [aiFlexible, setAiFlexible]         = useState(false)
  const [aiNumDays, setAiNumDays]           = useState(3)
  const [companion, setCompanion]           = useState('solo')
  const [travelStyles, setTravelStyles]     = useState([])
  const [pace, setPace]                     = useState('moderate')
  const [prefsOpen, setPrefsOpen]           = useState(true)

  const toggleStyle = (id) =>
    setTravelStyles(p => p.includes(id) ? p.filter(s => s !== id) : [...p, id])

  const paceConfig = PACES.find(p => p.id === pace) ?? PACES[1]
  const aiCanSubmit = !loading && (aiFlexible || aiStartDate !== '')

  const submitAI = async () => {
    setLoading(true); setSubmitError(null)
    try {
      const sessionId = localStorage.getItem('session_id') ?? generateId()
      localStorage.setItem('session_id', sessionId)
      const allPlaces = await api.getCuratedPlaces()
      const placeIds = selectPlaces(allPlaces, travelStyles, aiNumDays, pace)
      const trip = await api.createTrip({ session_id: sessionId, num_days: aiNumDays, budget_sgd: paceConfig.budget })
      await api.planTrip(trip.trip_id, {
        place_ids: placeIds,
        optimize_order: true,
        preferences: {
          prefer_mrt: true,
          max_walk_minutes: paceConfig.walk,
          travel_styles: travelStyles,
          group_type: companion,
        },
      })
      const draftStartDate = aiFlexible || !aiStartDate ? null : aiStartDate
      const draftMeta = { name: 'Singapore Trip', startDate: draftStartDate, numDays: aiNumDays, isDraft: true }
      // Auto-save as draft immediately — trip survives tab close before user hits Save
      api.saveTrip(trip.trip_id, draftMeta, authUser?.id ?? null)
      navigate(`/trip/${trip.trip_id}`, {
        state: { pendingSave: { name: 'Singapore Trip', startDate: draftStartDate, numDays: aiNumDays } },
      })
    } catch (e) {
      setSubmitError(e.message)
    } finally {
      setLoading(false)
    }
  }

  /* ── Mode chooser ───────────────────────────────────────────────── */
  if (planMode === null) {
    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="w-[min(480px,calc(100vw-32px))] mx-auto px-4 sm:px-0 space-y-5">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500 text-white shadow-pop mb-4">
              <Navigation2 size={22} strokeWidth={2.5} />
            </div>
            <h1 className="font-display font-extrabold text-[28px] text-slate-900 leading-tight">
              {t('planYourTrip')}
            </h1>
            <p className="text-[14px] text-slate-500 mt-1.5">{t('choosePlanMethod')}</p>
          </div>

          {/* PRIMARY: Manual */}
          <button
            onClick={() => setPlanMode('manual')}
            className="w-full rounded-2xl bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500 p-px shadow-pop group"
          >
            <div className="rounded-[calc(1rem-1px)] bg-white p-5 text-left hover:bg-indigo-50/30 transition">
              <div className="flex items-start gap-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500 text-white">
                  <Pencil size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-display font-bold text-[17px] text-slate-900">
                      {t('buildYourselfTitle')}
                    </span>
                    <span className="rounded-full bg-indigo-100 text-indigo-700 text-[10.5px] font-bold px-2 h-5 inline-flex items-center">
                      {t('recommendedBadge')}
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-500 leading-relaxed">
                    {t('buildYourselfDesc')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {[t('tag_freeChoice'), t('tag_transport'), t('tag_customizable')].map(tag => (
                      <span key={tag} className="text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full px-2 h-5 inline-flex items-center font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-indigo-400 group-hover:translate-x-0.5 transition-transform shrink-0 mt-1">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>
          </button>

          {/* SECONDARY: AI */}
          <button
            onClick={() => setPlanMode('ai')}
            className="w-full rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-slate-300 hover:bg-slate-50/50 transition group shadow-card"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 group-hover:bg-fuchsia-50 group-hover:text-fuchsia-600 transition">
                <Sparkles size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-[17px] text-slate-900 mb-1">
                  {t('planWithAITitle')}
                </div>
                <p className="text-[13px] text-slate-500 leading-relaxed">
                  {t('planWithAIDesc')}
                </p>
              </div>
              <div className="text-slate-300 group-hover:translate-x-0.5 transition-transform shrink-0 mt-1">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </button>
        </div>
      </div>
    )
  }

  /* ── Shared header wrapper ──────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="w-[min(520px,calc(100vw-32px))] mx-auto px-4 sm:px-0">

        {/* Back link */}
        <button
          onClick={() => { setPlanMode(null); setSubmitError(null) }}
          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-700 mb-4 transition"
        >
          <ChevronLeft size={14} />
          {t('changeMethod')}
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">

          {/* ── MANUAL MODE ─────────────────────────────────────── */}
          {planMode === 'manual' && (
            <>
              {/* Header */}
              <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500 px-5 pt-5 pb-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-white/70 mb-1">{t('manualHeaderLabel')}</div>
                    <div className="font-display font-extrabold text-[26px] text-white leading-none">Singapore</div>
                    <div className="text-[13px] text-white/75 mt-2">{t('manualHeaderSub')}</div>
                  </div>
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/20 border border-white/30">
                    <Pencil size={16} className="text-white" />
                  </div>
                </div>
              </div>

              <div className="px-5 pb-5 pt-5 space-y-6">

                {/* Trip basics */}
                <section className="space-y-4">
                  <p className="text-[12px] uppercase tracking-wide font-semibold text-slate-500">{t('tripInfoSection')}</p>

                  {/* Trip name */}
                  <div>
                    <label className="text-[12px] font-semibold text-slate-600 block mb-1.5">{t('tripNameLabel')}</label>
                    <input
                      type="text"
                      value={tripName}
                      onChange={e => setTripName(e.target.value)}
                      placeholder={t('tripNamePlaceholder')}
                      className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
                    />
                  </div>

                  {/* Date toggle */}
                  <div className="flex rounded-xl border border-slate-200 p-1 bg-slate-50 gap-1">
                    {[
                      { id: true,  label: t('flexibleLabel'), icon: <Clock size={13} /> },
                      { id: false, label: t('specificDatesLabel'), icon: <Calendar size={13} /> },
                    ].map(({ id, label, icon }) => (
                      <button
                        key={String(id)}
                        type="button"
                        onClick={() => setManFlexible(id)}
                        className={cn(
                          'flex-1 h-9 rounded-lg text-[13px] font-medium transition inline-flex items-center justify-center gap-1.5',
                          manFlexible === id
                            ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                            : 'text-slate-500 hover:text-slate-700'
                        )}
                      >
                        {icon} {label}
                      </button>
                    ))}
                  </div>

                  {!manFlexible ? (
                    <input
                      type="date"
                      value={manStartDate}
                      onChange={e => setManStartDate(e.target.value)}
                      className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-900 focus:outline-none focus:border-indigo-400"
                    />
                  ) : (
                    <p className="text-[12.5px] text-slate-500 italic px-1">{t('flexibleHint')}</p>
                  )}

                  {/* Duration */}
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-medium text-slate-700">{t('numDaysLabel')}</p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setManNumDays(n => Math.max(1, n - 1))}
                        className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition font-bold"
                      >−</button>
                      <div className="h-11 w-20 rounded-xl border border-slate-200 bg-slate-50/40 grid place-items-center">
                        <span className="font-display font-bold text-[22px] text-slate-900 tabular-nums">{manNumDays}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setManNumDays(n => Math.min(14, n + 1))}
                        className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition font-bold"
                      >+</button>
                    </div>
                  </div>
                </section>

                {/* Place builder */}
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[12px] uppercase tracking-wide font-semibold text-slate-500">
                      {t('placesSection', builder.places.length)}
                    </p>
                    {builder.places.length > 0 && (
                      <span className="text-[11px] text-slate-400">
                        {t('clickToChange')}
                      </span>
                    )}
                  </div>

                  {builder.places.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 py-8 text-center">
                      <MapPin size={24} className="mx-auto text-slate-300 mb-2" />
                      <p className="text-[13px] font-medium text-slate-500">{t('noPlacesTitle')}</p>
                      <p className="text-[12px] text-slate-400 mt-0.5">{t('noPlacesHint')}</p>
                    </div>
                  ) : (
                    <div className="space-y-0">
                      {builder.places.map((place, i) => (
                        <PlaceRow
                          key={place.id}
                          place={place}
                          index={i}
                          onRemove={() => removePlace(i)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Search panel */}
                  {showSearch ? (
                    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/30 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-indigo-700">{t('searchPlaceTitle')}</span>
                        <button
                          type="button"
                          onClick={() => setShowSearch(false)}
                          className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-200"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <PlaceSearch
                        onAdd={addPlace}
                        addedIds={new Set(builder.places.map(p => p.id))}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowSearch(true)}
                      className="mt-3 w-full h-10 rounded-xl border-2 border-dashed border-slate-300 text-[13px] font-semibold text-slate-500 hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/30 transition inline-flex items-center justify-center gap-2"
                    >
                      <Plus size={14} /> {t('addPlaceBtn')}
                    </button>
                  )}
                </section>

                {/* Error */}
                {submitError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                )}

                {/* CTA */}
                <button
                  onClick={submitManual}
                  disabled={loading || builder.places.length === 0}
                  className="w-full h-14 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-500 text-white font-display font-bold text-[16px] shadow-pop hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {loading
                    ? <><Loader2 size={18} className="animate-spin" /> {t('creatingTrip')}</>
                    : <><Navigation2 size={18} /> {t('createTripBtn', builder.places.length)}</>
                  }
                </button>
                {builder.places.length === 0 && !loading && (
                  <p className="text-center text-[12px] text-slate-400 -mt-4">
                    {t('addAtLeastOne')}
                  </p>
                )}

              </div>
            </>
          )}

          {/* ── AI MODE ─────────────────────────────────────────── */}
          {planMode === 'ai' && (
            <>
              {/* Gradient header */}
              <div className="bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 px-5 pt-5 pb-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-white/60 mb-1">{t('aiHeaderLabel')}</div>
                    <div className="font-display font-extrabold text-[28px] text-white leading-none">Singapore</div>
                    <div className="text-[13px] text-white/65 mt-2">{t('aiHeaderSub')}</div>
                  </div>
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 border border-white/20">
                    <Sparkles size={18} className="text-white" />
                  </div>
                </div>
              </div>

              <div className="px-5 pb-5 pt-5 space-y-6">

                {/* Dates */}
                <section>
                  <p className="text-[12px] uppercase tracking-wide font-semibold text-slate-500 mb-3">{t('whenGoingLabel')}</p>
                  <div className="flex rounded-xl border border-slate-200 p-1 bg-slate-50 gap-1 mb-4">
                    {[
                      { id: false, label: t('specificDatesLabel'), icon: <Calendar size={13} /> },
                      { id: true,  label: t('flexibleLabel'),      icon: <Clock size={13} /> },
                    ].map(({ id, label, icon }) => (
                      <button
                        key={String(id)}
                        type="button"
                        onClick={() => setAiFlexible(id)}
                        className={cn(
                          'flex-1 h-9 rounded-lg text-[13px] font-medium transition inline-flex items-center justify-center gap-1.5',
                          aiFlexible === id
                            ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                            : 'text-slate-500 hover:text-slate-700'
                        )}
                      >
                        {icon} {label}
                      </button>
                    ))}
                  </div>
                  {!aiFlexible ? (
                    <input
                      type="date"
                      value={aiStartDate}
                      onChange={e => setAiStartDate(e.target.value)}
                      className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-900 focus:outline-none focus:border-indigo-400 mb-4"
                    />
                  ) : (
                    <p className="text-[12.5px] text-slate-500 italic px-1 mb-4">
                      {t('flexibleDatesHint')}
                    </p>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-medium text-slate-700">{t('numDaysLabel')}</p>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setAiNumDays(n => Math.max(1, n - 1))} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition font-bold">−</button>
                      <div className="h-11 w-20 rounded-xl border border-slate-200 bg-slate-50/40 grid place-items-center">
                        <span className="font-display font-bold text-[22px] text-slate-900 tabular-nums">{aiNumDays}</span>
                      </div>
                      <button onClick={() => setAiNumDays(n => Math.min(7, n + 1))} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition font-bold">+</button>
                    </div>
                  </div>
                </section>

                {/* Preferences — collapsible */}
                <section>
                  <button
                    type="button"
                    onClick={() => setPrefsOpen(o => !o)}
                    className="w-full flex items-center justify-between text-left mb-3"
                  >
                    <p className="text-[12px] uppercase tracking-wide font-semibold text-slate-500">{t('preferencesLabel')}</p>
                    <ChevronDown size={14} className={cn('text-slate-400 transition-transform', prefsOpen && 'rotate-180')} />
                  </button>

                  {prefsOpen && (
                    <div className="space-y-5 animate-fade-up">
                      <div>
                        <p className="text-[11.5px] font-semibold text-slate-500 mb-2">{t('travellingWithLabel')}</p>
                        <div className="flex flex-wrap gap-2">
                          {COMPANIONS.map(({ id, emoji }) => (
                            <Chip key={id} active={companion === id} onClick={() => setCompanion(id)}>
                              <span className="text-[15px] leading-none">{emoji}</span>
                              <span>{t(`comp_${id}`)}</span>
                            </Chip>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11.5px] font-semibold text-slate-500 mb-2">{t('travelStyleLabel')}</p>
                        <div className="flex flex-wrap gap-2">
                          {STYLES.map(({ id, emoji }) => (
                            <Chip key={id} active={travelStyles.includes(id)} onClick={() => toggleStyle(id)}>
                              <span className="text-[15px] leading-none">{emoji}</span>
                              <span>{t(`style_${id}`)}</span>
                            </Chip>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-[11.5px] font-semibold text-slate-500 mb-2">{t('tripPaceLabel')}</p>
                        <div className="flex gap-2">
                          {PACES.map(({ id, emoji, budget, walk }) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => setPace(id)}
                              className={cn(
                                'flex-1 flex flex-col items-center gap-1 rounded-xl border py-3 px-2 text-[13px] font-medium transition',
                                pace === id
                                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'
                              )}
                            >
                              <span className="text-[20px]">{emoji}</span>
                              <span>{t(`pace_${id}`)}</span>
                              <span className="text-[10px] text-slate-400 tabular-nums">≤S${budget} · {walk}m walk</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                <div className="rounded-xl border border-fuchsia-100 bg-fuchsia-50/60 px-4 py-3 flex items-start gap-3">
                  <Sparkles size={15} className="text-fuchsia-500 mt-0.5 shrink-0" />
                  <p className="text-[12.5px] text-fuchsia-800 leading-relaxed">
                    {t('aiHint')}
                  </p>
                </div>

                {submitError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{submitError}</AlertDescription>
                  </Alert>
                )}

                <button
                  onClick={submitAI}
                  disabled={!aiCanSubmit}
                  className="w-full h-14 rounded-2xl bg-gradient-to-r from-slate-700 to-slate-900 text-white font-display font-bold text-[16px] shadow-pop hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {loading
                    ? <><Loader2 size={18} className="animate-spin" /> {t('planningBtn')}</>
                    : <><Sparkles size={18} /> {t('planWithAIBtn')}</>
                  }
                </button>
                {!aiCanSubmit && !loading && (
                  <p className="text-center text-[12px] text-slate-400">
                    {aiFlexible ? '' : t('selectStartDate')}
                  </p>
                )}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
