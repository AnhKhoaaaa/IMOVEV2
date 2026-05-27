import { useState } from 'react'
import { Train, Bus, Footprints, Car, Bike, ChevronDown, CheckCircle2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { api } from '../../services/api'

const MODE_MAP = {
  MRT:   { id: 'transit', label: 'Transit',  Icon: Train,      distFactor: 100 },
  LRT:   { id: 'transit', label: 'Transit',  Icon: Train,      distFactor: 100 },
  BUS:   { id: 'transit', label: 'Transit',  Icon: Bus,        distFactor: 100 },
  WALK:  { id: 'walk',    label: 'Walking',  Icon: Footprints, distFactor: 80  },
  DRIVE: { id: 'drive',   label: 'Driving',  Icon: Car,        distFactor: 500 },
  CYCLE: { id: 'walk',    label: 'Walking',  Icon: Bike,       distFactor: 100 },
}

const OPTS = [
  { id: 'drive',   label: 'Driving',  Icon: Car,       apiMode: 'DRIVE' },
  { id: 'transit', label: 'Transit',  Icon: Bus,       apiMode: 'MRT'   },
  { id: 'walk',    label: 'Walking',  Icon: Footprints, apiMode: 'WALK' },
]

function getMeta(transportMode) {
  return MODE_MAP[(transportMode ?? '').toUpperCase()] ?? MODE_MAP.BUS
}

function formatDist(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`
}

export default function TransitSegment({ leg, tripId, onUpdated }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const meta = getMeta(leg.transport_mode)
  const { Icon, label } = meta
  const distM = leg.distance_km != null
    ? Math.round(leg.distance_km * 1000)
    : Math.round((leg.duration_minutes ?? 10) * meta.distFactor)

  const currentOptId = meta.id // 'drive' | 'transit' | 'walk'

  const handleSelect = async (opt) => {
    if (opt.id === currentOptId || !tripId || !leg.id) { setOpen(false); return }
    setSaving(true)
    try {
      await api.updateLeg(tripId, leg.id, { transport_mode: opt.apiMode })
      if (onUpdated) await onUpdated()
    } catch { /* ignore, refresh will revert */ }
    finally { setSaving(false); setOpen(false) }
  }

  return (
    <div className="relative pl-12 py-1">
      {/* Dashed vertical line */}
      <div className="absolute left-[19px] top-0 bottom-0 w-px border-l border-dashed border-slate-300" />

      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          disabled={saving}
          className={cn(
            'group inline-flex items-center gap-2 rounded-full border bg-white px-3 h-8 text-[12.5px] font-medium transition focus-ring shadow-card',
            open
              ? 'border-indigo-300 ring-2 ring-indigo-100 text-slate-900'
              : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
          )}
        >
          <span className="text-slate-500"><Icon size={13} /></span>
          <span className="text-slate-900 font-semibold">{label}</span>
          <span className="text-slate-400">·</span>
          <span className="tabular-nums">
            {leg.duration_minutes} min · {formatDist(distM)}
            {leg.cost_sgd != null && ` · S$${leg.cost_sgd.toFixed(2)}`}
          </span>
          {leg.is_estimated && (
            <span className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide">~ Est.</span>
          )}
          <ChevronDown size={12} className={cn('text-slate-400 transition', open && 'rotate-180')} />
        </button>

        {open && (
          <div className="absolute left-0 top-9 z-20 w-[360px] rounded-xl border border-slate-200 bg-white shadow-pop animate-slide-up overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 text-[11px] uppercase tracking-wide font-semibold text-slate-500">
              Choose mode of transport
            </div>
            {OPTS.map((opt) => {
              const selected = opt.id === currentOptId
              const detail = opt.id === 'walk'
                ? `${leg.duration_minutes} min · ${formatDist(distM)}`
                : opt.id === 'drive'
                ? `${Math.max(1, Math.round((leg.duration_minutes ?? 10) * 0.4))} min · ${formatDist(distM)}`
                : `${leg.duration_minutes} min · ${formatDist(distM)}`
              return (
                <button
                  key={opt.id}
                  onClick={() => handleSelect(opt)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50 transition focus-ring"
                >
                  <span className={cn('inline-flex items-center gap-2 text-[13.5px] font-semibold', selected ? 'text-indigo-700' : 'text-slate-800')}>
                    <opt.Icon size={15} /> {opt.label}
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
            <div className="border-t border-slate-100 px-3 py-2.5 flex items-center justify-between text-[12.5px] text-slate-600 bg-slate-50/60">
              <span className="inline-flex items-center gap-2">
                Straight-line distance
              </span>
              <span className="font-mono-code tabular-nums">{formatDist(distM + 310)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
