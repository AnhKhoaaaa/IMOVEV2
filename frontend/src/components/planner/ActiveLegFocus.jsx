import { useState } from 'react'
import {
  CheckCircle, ChevronDown, Navigation2, CloudRain, ArrowRight, MapPin,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import CitymapperTransitCard from './CitymapperTransitCard'
import { useT } from '../../contexts/LanguageContext'

function haversineMeters(a, b) {
  const R = 6371000
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}

/* ── Completed stack ─────────────────────────────────────────────── */
function CompletedStack({ places }) {
  const { t } = useT()
  const [expanded, setExpanded] = useState(false)
  if (!places.length) return null
  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[12.5px] font-semibold hover:bg-emerald-100 transition"
      >
        <CheckCircle size={13} className="text-emerald-600 shrink-0" />
        <span>{t('alStopsCompleted', places.length)}</span>
        <ChevronDown size={12} className={cn('ml-auto transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 pl-2 animate-fade-up">
          {places.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2 text-[12px] text-slate-400 py-1">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-bold shrink-0">
                {i + 1}
              </span>
              <span className="line-through">{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Up-next stack ───────────────────────────────────────────────── */
function UpNextStack({ places }) {
  const { t } = useT()
  const [expanded, setExpanded] = useState(false)
  if (!places.length) return null
  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-[12.5px] font-semibold hover:bg-slate-100 transition"
      >
        <ArrowRight size={13} className="text-slate-400 shrink-0" />
        <span>{t('alStopsUpNext', places.length)}</span>
        <ChevronDown size={12} className={cn('ml-auto transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 pl-2 animate-fade-up">
          {places.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2 text-[12px] text-slate-500 py-1">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold shrink-0">
                {i + 1}
              </span>
              <span>{p.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Weather swap banner ─────────────────────────────────────────── */
function WeatherSwapBanner({ alert, onApprove, onDismiss }) {
  const { t } = useT()
  if (!alert) return null
  return (
    <div className="rounded-xl border border-sky-300 bg-sky-50 p-3 animate-fade-up">
      <div className="flex items-start gap-2">
        <CloudRain size={14} className="text-sky-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12.5px] font-semibold text-sky-900">
            {t('alRainExpected', alert.attractionName)}
          </p>
          {alert.swapName && (
            <p className="text-[12px] text-sky-700 mt-0.5">
              {t('alSwapToPre')}<span className="font-semibold">{alert.swapName}</span>{t('alSwapToPost')}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2 justify-end">
        <button
          onClick={onDismiss}
          className="h-7 px-3 rounded-full border border-sky-200 bg-white text-sky-700 text-[12px] font-medium hover:bg-sky-50 transition"
        >
          {t('alertDismiss')}
        </button>
        <button
          onClick={onApprove}
          className="h-7 px-3 rounded-full bg-sky-600 text-white text-[12px] font-semibold hover:bg-sky-700 transition inline-flex items-center gap-1"
        >
          {t('alApproveSwap')}
        </button>
      </div>
    </div>
  )
}

/* ── Target venue card ───────────────────────────────────────────── */
const PHOTO_GRADIENTS = [
  'from-indigo-400 to-purple-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
]

function TargetVenueCard({ place, index, onArrive, note, onNoteChange }) {
  const { t } = useT()
  const [arriving, setArriving] = useState(false)

  const handleArrive = () => {
    setArriving(true)
    setTimeout(() => {
      setArriving(false)
      onArrive()
    }, 600)
  }

  if (!place) return null

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
      {/* Photo strip */}
      <div className="grid grid-cols-3 gap-1 p-1.5">
        {PHOTO_GRADIENTS.map((g, i) => (
          <div key={i} className={cn('rounded-xl h-20 bg-gradient-to-br opacity-70', g)} />
        ))}
      </div>

      <div className="px-4 pb-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-indigo-600 text-white font-bold text-[11px] shrink-0">
                {index}
              </span>
              <span className="font-display font-bold text-[17px] text-slate-900">{place.name}</span>
            </div>
            {place.best_time_start && (
              <p className="text-[12px] text-slate-500 ml-7">
                {t('alOpenRange', place.best_time_start, place.best_time_end)}
              </p>
            )}
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 h-6 text-[11px] font-semibold text-amber-700 shrink-0">
            ★ 4.7
          </span>
        </div>

        {/* Category badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {place.category && (
            <span className="rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 h-5 text-[11px] font-medium inline-flex items-center">
              {place.category}
            </span>
          )}
          {place.is_outdoor && (
            <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 h-5 text-[11px] font-medium inline-flex items-center">
              {t('alOutdoor')}
            </span>
          )}
          {place.dwell_minutes && (
            <span className="rounded-full bg-slate-50 text-slate-600 border border-slate-200 px-2 h-5 text-[11px] font-medium inline-flex items-center">
              {t('alMinVisit', place.dwell_minutes)}
            </span>
          )}
        </div>

        {/* Note textarea */}
        <textarea
          rows={2}
          value={note ?? ''}
          onChange={(e) => onNoteChange?.(e.target.value)}
          placeholder={t('alNotePlaceholder')}
          className="w-full rounded-lg border border-slate-200 bg-slate-50/30 px-3 py-2 text-[12.5px] placeholder:text-slate-400 resize-none mb-3 focus:outline-none focus:border-indigo-300"
        />

        {/* Arrived CTA */}
        <button
          onClick={handleArrive}
          disabled={arriving}
          className={cn(
            'w-full h-11 rounded-xl font-display font-bold text-[14px] transition inline-flex items-center justify-center gap-2 focus:outline-none',
            arriving
              ? 'bg-emerald-500 text-white scale-95'
              : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-card hover:shadow-pop'
          )}
        >
          {arriving
            ? <><CheckCircle size={15} /> {t('alArrivedExcl')}</>
            : <><Navigation2 size={15} /> {t('alArrivedDest')}</>
          }
        </button>
      </div>
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────────── */
export default function ActiveLegFocus({
  legs,
  placesById,
  position,
  activeLegIndex,
  onArrive,
  weatherAlert,
  transitAlert,
  transitVariant = 'mrt',
  onSwitchToBus,
  onApproveSwap,
  onDismissWeather,
  onDismissTransit,
  virtualStartLeg = null,
  onVirtualArrive,
}) {
  const { t } = useT()
  const [placeNotes, setPlaceNotes] = useState({})

  if (!legs || legs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/40 p-10 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 mb-2">
          <MapPin size={20} />
        </div>
        <div className="font-display font-bold text-[15px] text-slate-700">{t('alNoRoute')}</div>
      </div>
    )
  }

  const clamped = Math.min(activeLegIndex, legs.length - 1)
  const activeLeg = legs[clamped]
  if (!activeLeg) return null

  const originPlace = placesById[activeLeg.from_place_id]
  const targetPlace = placesById[activeLeg.to_place_id]

  // Completed places: all unique places before the current origin
  const completedPlaces = []
  const completedSeen = new Set()
  for (let i = 0; i < clamped; i++) {
    const leg = legs[i]
    if (!completedSeen.has(leg.from_place_id) && placesById[leg.from_place_id]) {
      completedSeen.add(leg.from_place_id)
      completedPlaces.push(placesById[leg.from_place_id])
    }
  }

  // Up-next places: unique places after current target
  const upNextPlaces = []
  const upNextSeen = new Set()
  for (let i = clamped + 1; i < legs.length; i++) {
    const leg = legs[i]
    if (!upNextSeen.has(leg.from_place_id) && placesById[leg.from_place_id]) {
      upNextSeen.add(leg.from_place_id)
      upNextPlaces.push(placesById[leg.from_place_id])
    }
    if (i === legs.length - 1 && !upNextSeen.has(leg.to_place_id) && placesById[leg.to_place_id]) {
      upNextPlaces.push(placesById[leg.to_place_id])
    }
  }

  const distToTarget =
    position && targetPlace
      ? haversineMeters(position, { lat: targetPlace.lat, lng: targetPlace.lng })
      : null

  const targetIndex = completedPlaces.length + (virtualStartLeg ? 1 : 2)

  const activeWeatherAlert =
    weatherAlert && weatherAlert.legIndex === clamped ? weatherAlert : null
  const activeTransitAlert =
    transitAlert && transitAlert.legIndex === clamped ? transitAlert : null

  return (
    <div className="space-y-3 animate-fade-up">
      {/* Completed stack */}
      <CompletedStack places={completedPlaces} />

      {/* Virtual start leg — Get to Start */}
      {virtualStartLeg && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3 animate-fade-up">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-[13px] text-amber-900">{t('alGetToStart')}</span>
            <span className="text-[12px] text-amber-700">→ {virtualStartLeg.toPlace.name}</span>
          </div>
          {virtualStartLeg.routeComparison && (() => {
            const best = virtualStartLeg.routeComparison.pt?.available
              ? virtualStartLeg.routeComparison.pt
              : virtualStartLeg.routeComparison.walk
            return best ? (
              <p className="text-[12.5px] text-amber-800 ml-1">
                {t('tripMinShort', best.duration_minutes)} · {best.summary || t('alToFirstStop')}
                {best.fare_sgd > 0 && ` · S$${best.fare_sgd.toFixed(2)}`}
              </p>
            ) : null
          })()}
          <button
            onClick={onVirtualArrive}
            className="w-full h-10 rounded-xl bg-amber-500 text-white font-display font-bold text-[13.5px] hover:bg-amber-600 transition inline-flex items-center justify-center gap-2"
          >
            <Navigation2 size={14} /> {t('alArrivedAt', virtualStartLeg.toPlace.name)}
          </button>
        </div>
      )}

      {/* YOU ARE HERE block */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-40 animate-ping" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-indigo-600" />
          </span>
          <span className="font-display font-bold text-[13px] text-indigo-900">{t('alYouAreHere')}</span>
          {originPlace && (
            <span className="text-[12px] text-indigo-600 opacity-75 truncate">
              {t('alNear', originPlace.name)}
            </span>
          )}
        </div>
        {position ? (
          <p className="text-[12px] text-indigo-700 tabular-nums ml-7">
            {position.lat.toFixed(4)}°N · {position.lng.toFixed(4)}°E
          </p>
        ) : (
          <p className="text-[12px] text-indigo-400 italic ml-7">{t('alAcquiringGps')}</p>
        )}
        {distToTarget != null && (
          <p className="text-[12px] font-semibold text-indigo-800 ml-7 mt-1">
            {t('alDistTo', fmtDist(distToTarget), targetPlace?.name)}
          </p>
        )}
      </div>

      {/* Weather swap banner (above transit) */}
      <WeatherSwapBanner
        alert={activeWeatherAlert}
        onApprove={onApproveSwap}
        onDismiss={onDismissWeather}
      />

      {/* CitymapperTransitCard — active/expanded mode */}
      <CitymapperTransitCard
        leg={activeLeg}
        isActive
        transitAlert={activeTransitAlert}
        transitVariant={transitVariant}
        onSwitchToBus={onSwitchToBus}
        onDismissTransit={onDismissTransit}
      />

      {/* Target venue card */}
      {targetPlace && (
        <TargetVenueCard
          place={targetPlace}
          index={targetIndex}
          onArrive={onArrive}
          note={placeNotes[targetPlace.id]}
          onNoteChange={(v) => setPlaceNotes((n) => ({ ...n, [targetPlace.id]: v }))}
        />
      )}

      {/* Up next stack */}
      <UpNextStack places={upNextPlaces} />
    </div>
  )
}
