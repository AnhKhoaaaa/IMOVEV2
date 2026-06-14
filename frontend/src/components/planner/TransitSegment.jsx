import { useState } from 'react'
import { Train, Bus, Footprints, Car, Bike, ChevronDown, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { api } from '../../services/api'
import { useT } from '../../contexts/LanguageContext'

const MODE_MAP = {
  MRT:   { id: 'transit', labelKey: 'tsTransit',  Icon: Train,      distFactor: 100 },
  LRT:   { id: 'transit', labelKey: 'tsTransit',  Icon: Train,      distFactor: 100 },
  BUS:   { id: 'transit', labelKey: 'tsTransit',  Icon: Bus,        distFactor: 100 },
  WALK:  { id: 'walk',    labelKey: 'tsWalking',  Icon: Footprints, distFactor: 80  },
  CYCLE: { id: 'cycle',   labelKey: 'tsCycling',  Icon: Bike,       distFactor: 100 },
}

const OPTS = [
  { id: 'transit', labelKey: 'tsTransit',  Icon: Bus,        apiMode: 'MRT',  compareKey: 'pt'    },
  { id: 'walk',    labelKey: 'tsWalking',  Icon: Footprints, apiMode: 'WALK', compareKey: 'walk'  },
  { id: 'cycle',   labelKey: 'tsCycling',  Icon: Bike,        apiMode: null,   compareKey: 'cycle' },
]

function getMeta(transportMode) {
  return MODE_MAP[(transportMode ?? '').toUpperCase()] ?? MODE_MAP.BUS
}

function formatDist(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`
}

function buildGrabDeepLink(from, to) {
  if (!from || !to) return null
  return (
    `grab://open` +
    `?pickup[latitude]=${from.lat}&pickup[longitude]=${from.lng}` +
    `&pickup[address]=${encodeURIComponent(from.name ?? '')}` +
    `&dropoff[latitude]=${to.lat}&dropoff[longitude]=${to.lng}` +
    `&dropoff[address]=${encodeURIComponent(to.name ?? '')}`
  )
}

export default function TransitSegment({ leg, tripId, fromPlace, toPlace, onUpdated }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [comparison, setComparison] = useState(null)
  const [loadingComparison, setLoadingComparison] = useState(false)

  const meta = getMeta(leg.transport_mode)
  const { Icon } = meta
  const distM = leg.distance_km != null
    ? Math.round(leg.distance_km * 1000)
    : Math.round((leg.duration_minutes ?? 10) * meta.distFactor)

  const currentOptId = meta.id

  const handleOpen = async () => {
    const next = !open
    setOpen(next)
    if (next && fromPlace?.lat && toPlace?.lat && !comparison && !loadingComparison) {
      setLoadingComparison(true)
      try {
        const result = await api.compareRoutes(fromPlace.lat, fromPlace.lng, toPlace.lat, toPlace.lng)
        setComparison(result)
      } catch { /* fall back to estimates silently */ }
      finally { setLoadingComparison(false) }
    }
  }

  const getDetail = (opt) => {
    if (comparison) {
      const m = comparison[opt.compareKey]
      if (!m?.available) return t('tripUnavailable')
      const cost = m.fare_sgd > 0 ? ` · S$${m.fare_sgd.toFixed(2)}` : ''
      const dist = m.distance_km > 0 ? ` · ${(m.distance_km).toFixed(1)} km` : ''
      const summary = m.summary ? ` · ${m.summary}` : ''
      return `${t('tripMinShort', m.duration_minutes)}${dist}${cost}${summary}`
    }
    // Fallback estimates while comparison is loading or unavailable
    return `${t('tripMinShort', leg.duration_minutes)} · ${formatDist(distM)}`
  }

  const handleSelect = async (opt) => {
    if (!opt.apiMode || opt.apiMode === leg.transport_mode || !tripId || !leg.id) { setOpen(false); return }
    setSaving(true)
    try {
      await api.updateLeg(tripId, leg.id, { transport_mode: opt.apiMode })
      if (onUpdated) await onUpdated()
    } catch (err) {
      console.error('updateLeg failed:', err)
    }
    finally { setSaving(false); setOpen(false) }
  }

  const grabLink = buildGrabDeepLink(fromPlace, toPlace)

  return (
    <div className="relative pl-12 py-1.5">
      {/* Dashed vertical line */}
      <div className="absolute left-[19px] top-0 bottom-0 w-px border-l border-dashed border-slate-300" />

      {/* Centered chip */}
      <div className="relative flex justify-center">
        <button
          onClick={handleOpen}
          disabled={saving}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-3 h-7 text-[12px] font-medium transition focus-ring shadow-card',
            open
              ? 'border-indigo-300 bg-white ring-1 ring-indigo-100 text-slate-900'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
          )}
        >
          <Icon size={12} className={open ? 'text-indigo-500' : 'text-slate-400'} />
          <span className="tabular-nums font-semibold">{t('tripMinShort', leg.duration_minutes)}</span>
          {leg.is_estimated && <span className="text-[9.5px] font-bold text-amber-500 uppercase">~</span>}
          <ChevronDown size={11} className={cn('text-slate-400 transition', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute left-1/2 -translate-x-1/2 top-8 z-20 w-[340px] rounded-xl border border-slate-200 bg-white shadow-pop animate-slide-up overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">{t('tsChooseMode')}</span>
              {loadingComparison && <Loader2 size={11} className="animate-spin text-slate-400" />}
            </div>

            {OPTS.map((opt) => {
              const selected = opt.apiMode === leg.transport_mode
              const detail = getDetail(opt)
              const unavailable = comparison && !comparison[opt.compareKey]?.available
              if (unavailable) return null
              return (
                <button
                  key={opt.id}
                  onClick={() => handleSelect(opt)}
                  className={cn(
                    'w-full flex items-center justify-between gap-3 px-3 py-2.5 transition focus-ring hover:bg-slate-50'
                  )}
                >
                  <span className={cn('inline-flex items-center gap-2 text-[13.5px] font-semibold', selected ? 'text-indigo-700' : 'text-slate-800')}>
                    <opt.Icon size={15} /> {t(opt.labelKey)}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className={cn('text-[12.5px] tabular-nums', selected ? 'text-indigo-700 font-semibold' : 'text-slate-500')}>
                      {detail}
                    </span>
                    {selected && <CheckCircle2 size={14} className="text-indigo-600" />}
                  </span>
                </button>
              )
            })}
            {comparison && OPTS.every((o) => !comparison[o.compareKey]?.available) && (
              <div className="px-3 py-2.5 text-[12.5px] text-slate-400 italic">
                {t('tsNoRoute')}
              </div>
            )}

            {/* Taxi / Grab deep-link row */}
            <div className="border-t border-slate-100">
              <a
                href={grabLink ?? '#'}
                onClick={(e) => { if (!grabLink) e.preventDefault() }}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-amber-50 transition"
              >
                <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-slate-800">
                  <Car size={15} /> {t('tsTaxiGrab')}
                </span>
                <span className="text-[12px] text-amber-700 font-semibold">{t('tsOpenGrab')}</span>
              </a>
            </div>

            <div className="border-t border-slate-100 px-3 py-2.5 flex items-center justify-between text-[12.5px] text-slate-600 bg-slate-50/60">
              <span>{t('tsStraightLine')}</span>
              <span className="font-mono-code tabular-nums">{formatDist(distM + 310)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
