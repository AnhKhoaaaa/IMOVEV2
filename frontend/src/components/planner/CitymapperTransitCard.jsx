import { useState } from 'react'
import { Train, Bus, Footprints, Car, Bike, ChevronDown, Pencil } from 'lucide-react'
import { cn } from '../../lib/utils'

const MODE_CONFIG = {
  MRT: {
    label: 'MRT',
    Icon: Train,
    color: '#4f46e5',
    bg: '#eef2ff',
    border: 'border-indigo-200',
    accentText: 'text-indigo-700',
    crowding: 'Low',
    crowdingColor: 'bg-emerald-500',
    crowdingText: 'text-emerald-700',
    steps: (leg) => [
      { icon: Footprints, label: 'Walk to MRT station', sub: '3-5 min' },
      { icon: Train,     label: 'Board MRT - Platform 1', sub: 'Direction: East-West' },
      { icon: Train,     label: `Ride ${Math.max(2, Math.round((leg.duration_minutes ?? 15) * 0.6))} min`, sub: '2-4 stops' },
      { icon: Footprints, label: 'Alight - Exit B', sub: '2-3 min walk to destination' },
    ],
  },
  LRT: {
    label: 'LRT',
    Icon: Train,
    color: '#7c3aed',
    bg: '#f5f3ff',
    border: 'border-violet-200',
    accentText: 'text-violet-700',
    crowding: 'Low',
    crowdingColor: 'bg-emerald-500',
    crowdingText: 'text-emerald-700',
    steps: (leg) => [
      { icon: Footprints, label: 'Walk to LRT station', sub: '2-4 min' },
      { icon: Train,     label: 'Board LRT', sub: 'Platform A' },
      { icon: Train,     label: `Ride ${leg.duration_minutes ?? 8} min`, sub: '1-2 stops' },
      { icon: Footprints, label: 'Alight and walk', sub: '1-2 min to destination' },
    ],
  },
  BUS: {
    label: 'Bus',
    Icon: Bus,
    color: '#059669',
    bg: '#ecfdf5',
    border: 'border-emerald-200',
    accentText: 'text-emerald-700',
    crowding: 'Moderate',
    crowdingColor: 'bg-amber-500',
    crowdingText: 'text-amber-700',
    steps: (leg) => [
      { icon: Footprints, label: 'Walk to bus stop', sub: '3-5 min' },
      { icon: Bus,       label: 'Board Bus - Next in 3 min', sub: 'Platform A' },
      { icon: Bus,       label: `Ride ${leg.duration_minutes ?? 12} min`, sub: '3-5 stops' },
      { icon: Footprints, label: 'Alight and walk', sub: '2-4 min to destination' },
    ],
  },
  WALK: {
    label: 'Walk',
    Icon: Footprints,
    color: '#ea580c',
    bg: '#fff7ed',
    border: 'border-orange-200',
    accentText: 'text-orange-700',
    crowding: null,
    steps: (leg) => [
      { icon: Footprints, label: `Walk ${leg.duration_minutes ?? 10} min`, sub: 'Pedestrian route' },
    ],
  },
  DRIVE: {
    label: 'Drive / Taxi',
    Icon: Car,
    color: '#7c3aed',
    bg: '#f5f3ff',
    border: 'border-violet-200',
    accentText: 'text-violet-700',
    crowding: null,
    steps: (leg) => [
      { icon: Car, label: `Drive or take taxi - ${leg.duration_minutes ?? 10} min`, sub: 'Approx. S$8-15 by taxi' },
    ],
  },
  CYCLE: {
    label: 'Cycle',
    Icon: Bike,
    color: '#0d9488',
    bg: '#f0fdfa',
    border: 'border-teal-200',
    accentText: 'text-teal-700',
    crowding: null,
    steps: (leg) => [
      { icon: Bike, label: `Cycle ${leg.duration_minutes ?? 10} min`, sub: 'Bike-sharing available' },
    ],
  },
}

function StepRow({ step, isLast, accentColor }) {
  const { icon: StepIcon, label, sub } = step
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 bg-white"
          style={{ borderColor: accentColor }}
        >
          <StepIcon className="h-3 w-3" style={{ color: accentColor }} />
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-slate-100" style={{ minHeight: 16 }} />}
      </div>
      <div className="pb-3 pt-0.5 min-w-0">
        <p className="text-sm font-medium text-slate-900 leading-tight">{label}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export default function CitymapperTransitCard({ leg, onEdit }) {
  const [open, setOpen] = useState(false)
  const modeKey = (leg.transport_mode ?? 'BUS').toUpperCase()
  const config = MODE_CONFIG[modeKey] ?? MODE_CONFIG.BUS
  const { label, Icon, color, bg, border, accentText, crowding, crowdingColor, crowdingText, steps } = config
  const stepList = steps(leg)
  const cost = leg.cost_sgd != null ? `S$${leg.cost_sgd.toFixed(2)}` : null

  return (
    <div className={cn('rounded-2xl border bg-white shadow-card overflow-hidden', border)}>
      {/* Collapsed header */}
      <div className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={open}
        >
        <div
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{ background: bg }}
        >
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          <p className="text-xs text-slate-500">
            {leg.duration_minutes} min{cost ? ` - ${cost}` : ''}
            {leg.is_estimated && ' - ~Est.'}
          </p>
        </div>
        {crowding && (
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-100 bg-slate-50 px-2 h-6 text-xs font-medium">
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full', crowdingColor)} />
            <span className={cn(crowdingText)}>{crowding}</span>
          </span>
        )}
        <ChevronDown
          className={cn('h-4 w-4 text-slate-400 transition-transform shrink-0', open && 'rotate-180')}
        />
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"
            aria-label="Edit transport mode"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Expanded steps */}
      {open && (
        <div className="border-t border-slate-50 px-4 pb-3 pt-4 animate-fade-up">
          {stepList.map((step, i) => (
            <StepRow
              key={i}
              step={step}
              isLast={i === stepList.length - 1}
              accentColor={color}
            />
          ))}
          {leg.is_estimated && (
            <p className="mt-1 text-xs text-amber-600">~ Times are estimated based on typical route durations</p>
          )}
        </div>
      )}
    </div>
  )
}
