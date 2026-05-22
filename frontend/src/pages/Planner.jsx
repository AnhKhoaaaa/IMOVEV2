import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Sparkles, AlertCircle, Loader2, Navigation2, Calendar, Clock } from 'lucide-react'
import { api } from '../services/api'
import { useSavedTrips } from '../hooks/useSavedTrips'
import { cn } from '../lib/utils'
import { Alert, AlertDescription } from '../components/ui/alert'

/* ── Data ────────────────────────────────────────────────────────── */
const COMPANIONS = [
  { id: 'solo',    emoji: '🚶',    label: 'Solo' },
  { id: 'family',  emoji: '👨‍👩‍👧‍👦', label: 'Family' },
  { id: 'couple',  emoji: '💑',    label: 'Couple' },
  { id: 'friends', emoji: '👬',    label: 'Friends' },
  { id: 'elderly', emoji: '👵',    label: 'Elderly' },
]

const STYLES = [
  { id: 'cultural',   emoji: '🎭', label: 'Cultural' },
  { id: 'classic',    emoji: '🌟', label: 'Classic' },
  { id: 'nature',     emoji: '🌿', label: 'Nature' },
  { id: 'cityscape',  emoji: '🏙️', label: 'Cityscape' },
  { id: 'historical', emoji: '🏛️', label: 'Historical' },
]

const PACES = [
  { id: 'ambitious', emoji: '📅', label: 'Ambitious', budget: 35,  walk: 5  },
  { id: 'moderate',  emoji: '⚖️', label: 'Moderate',  budget: 60,  walk: 15 },
  { id: 'relaxed',   emoji: '🌴', label: 'Relaxed',   budget: 100, walk: 30 },
]

const generateId = () =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/* ── Chip ────────────────────────────────────────────────────────── */
const Chip = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-2 rounded-full border px-3.5 h-9 text-[13.5px] font-medium transition focus-ring whitespace-nowrap',
      active
        ? 'border-indigo-300 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
    )}
  >
    {children}
  </button>
)

/* ── Main ────────────────────────────────────────────────────────── */
export default function Planner() {
  const navigate = useNavigate()
  const { save: saveTrip } = useSavedTrips()

  const [startDate, setStartDate]     = useState('')
  const [isFlexible, setIsFlexible]   = useState(false)
  const [numDays, setNumDays]         = useState(3)
  const [companion, setCompanion]     = useState('solo')
  const [travelStyles, setTravelStyles] = useState([])
  const [pace, setPace]               = useState('moderate')
  const [loading, setLoading]         = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const toggleStyle = (id) =>
    setTravelStyles((p) => p.includes(id) ? p.filter((s) => s !== id) : [...p, id])

  const paceConfig = PACES.find((p) => p.id === pace) ?? PACES[1]

  // Haversine distance in km
  function dist(a, b) {
    const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180
    const x = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x))
  }

  // Select places with min 1km spacing → avoids "no route" errors from OneMap
  function selectPlaces(allPlaces, styles, numDays, pace) {
    const styleToCategory = {
      cultural: ['museum', 'heritage'],
      classic: ['landmark'],
      nature: ['nature'],
      cityscape: ['landmark', 'entertainment'],
      historical: ['heritage', 'museum'],
    }
    const preferredCats = [...new Set(styles.flatMap((s) => styleToCategory[s] ?? []))]
    const maxPlaces = Math.min(6, Math.max(3, numDays * 2))
    const MIN_KM = 1.0  // minimum distance between any two selected places

    // Sort pool: preferred categories first, relaxed → indoor first
    const sorted = [...allPlaces].sort((a, b) => {
      const aP = preferredCats.includes(a.category) ? 0 : 1
      const bP = preferredCats.includes(b.category) ? 0 : 1
      if (aP !== bP) return aP - bP
      if (pace === 'relaxed') return (a.is_outdoor ? 1 : 0) - (b.is_outdoor ? 1 : 0)
      return 0
    })

    // Greedy: pick each place only if it's ≥1km from all already-selected places
    const selected = []
    for (const p of sorted) {
      if (selected.length >= maxPlaces) break
      const tooClose = selected.some((s) => dist(p, s) < MIN_KM)
      if (!tooClose) selected.push(p)
    }

    return selected.map((p) => p.id)
  }

  const submit = async () => {
    setLoading(true)
    setSubmitError(null)
    try {
      let sessionId
      try {
        sessionId = localStorage.getItem('session_id') ?? generateId()
        localStorage.setItem('session_id', sessionId)
      } catch { sessionId = generateId() }

      // 1. Get curated places (fast, no AI)
      const allPlaces = await api.getCuratedPlaces()
      const placeIds = selectPlaces(allPlaces, travelStyles, numDays, pace)

      // 2. Create trip record
      const trip = await api.createTrip({
        session_id: sessionId,
        num_days: numDays,
        budget_sgd: paceConfig.budget,
      })

      // 3. Generate itinerary
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

      // 4. Save metadata locally
      saveTrip(trip.trip_id, {
        name: 'Singapore Trip',
        startDate: isFlexible || !startDate ? null : startDate,
        numDays,
      })

      navigate(`/trip/${trip.trip_id}`)
    } catch (e) {
      setSubmitError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="w-[min(520px,calc(100vw-32px))] mx-auto px-4 sm:px-0">

        <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">

          {/* Gradient header */}
          <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500 px-5 pt-5 pb-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide font-semibold text-white/70 mb-1">Destination</div>
                <div className="font-display font-extrabold text-[28px] text-white leading-none">Singapore</div>
                <div className="text-[13px] text-white/75 mt-2">Lion City · Southeast Asia's Transit Hub</div>
              </div>
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/20 border border-white/30">
                <MapPin size={18} className="text-white" />
              </div>
            </div>
          </div>

          <div className="px-5 pb-5 pt-5 space-y-6">

            {/* Dates */}
            <section>
              <p className="text-[12px] uppercase tracking-wide font-semibold text-slate-500 mb-3">When are you going?</p>

              {/* Specific / Flexible toggle */}
              <div className="flex rounded-xl border border-slate-200 p-1 bg-slate-50 gap-1 mb-4">
                {[
                  { id: false, label: 'Specific dates',    icon: <Calendar size={13} /> },
                  { id: true,  label: 'Flexible duration', icon: <Clock size={13} /> },
                ].map(({ id, label, icon }) => (
                  <button
                    key={String(id)}
                    onClick={() => setIsFlexible(id)}
                    className={cn(
                      'flex-1 h-9 rounded-lg text-[13px] font-medium transition inline-flex items-center justify-center gap-1.5',
                      isFlexible === id
                        ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                        : 'text-slate-500 hover:text-slate-700'
                    )}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>

              {!isFlexible ? (
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] text-slate-900 focus-ring focus:border-indigo-400 mb-4"
                />
              ) : (
                <p className="text-[12.5px] text-slate-500 italic px-1 mb-4">
                  Dates are flexible — you can set them later from your trip page.
                </p>
              )}

              {/* Duration stepper */}
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-medium text-slate-700">Duration</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setNumDays((n) => Math.max(1, n - 1))}
                    className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition font-bold"
                  >−</button>
                  <div className="h-11 w-20 rounded-xl border border-slate-200 bg-slate-50/40 grid place-items-center">
                    <span className="font-display font-bold text-[22px] text-slate-900 tabular-nums">{numDays}</span>
                  </div>
                  <button
                    onClick={() => setNumDays((n) => Math.min(7, n + 1))}
                    className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition font-bold"
                  >+</button>
                </div>
              </div>
            </section>

            {/* Companions */}
            <section>
              <p className="text-[12px] uppercase tracking-wide font-semibold text-slate-500 mb-3">Travelling with</p>
              <div className="flex flex-wrap gap-2">
                {COMPANIONS.map(({ id, emoji, label }) => (
                  <Chip key={id} active={companion === id} onClick={() => setCompanion(id)}>
                    <span className="text-[15px] leading-none">{emoji}</span>
                    <span>{label}</span>
                  </Chip>
                ))}
              </div>
            </section>

            {/* Travel style */}
            <section>
              <p className="text-[12px] uppercase tracking-wide font-semibold text-slate-500 mb-3">Travel style</p>
              <div className="flex flex-wrap gap-2">
                {STYLES.map(({ id, emoji, label }) => (
                  <Chip key={id} active={travelStyles.includes(id)} onClick={() => toggleStyle(id)}>
                    <span className="text-[15px] leading-none">{emoji}</span>
                    <span>{label}</span>
                  </Chip>
                ))}
              </div>
            </section>

            {/* Pace */}
            <section>
              <p className="text-[12px] uppercase tracking-wide font-semibold text-slate-500 mb-3">Trip pace</p>
              <div className="flex gap-2">
                {PACES.map(({ id, emoji, label, budget, walk }) => (
                  <button
                    key={id}
                    onClick={() => setPace(id)}
                    className={cn(
                      'flex-1 flex flex-col items-center gap-1 rounded-xl border py-3 px-2 text-[13px] font-medium transition focus-ring',
                      pace === id
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200'
                    )}
                  >
                    <span className="text-[20px]">{emoji}</span>
                    <span>{label}</span>
                    <span className="text-[10px] text-slate-400 tabular-nums">≤S${budget} · {walk}m walk</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Hint */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 flex items-start gap-3">
              <Sparkles size={15} className="text-indigo-500 mt-0.5 shrink-0" />
              <p className="text-[12.5px] text-indigo-800 leading-relaxed">
                <span className="font-semibold">We'll curate the best places for you</span> based on your travel style and pace, then build a full day-by-day itinerary with real MRT and bus routes.
              </p>
            </div>

            {/* Error */}
            {submitError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            {/* CTA */}
            <button
              onClick={submit}
              disabled={loading}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-500 text-white font-display font-bold text-[16px] shadow-pop hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
            >
              {loading
                ? <><Loader2 size={18} className="animate-spin" /> Planning your trip…</>
                : <><Navigation2 size={18} /> Create Itinerary</>
              }
            </button>

          </div>
        </div>
      </div>
    </div>
  )
}
