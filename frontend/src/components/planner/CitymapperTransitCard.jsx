import { useState } from 'react'
import { Train, Bus, Footprints, Car, Bike, ChevronDown, AlertTriangle, X } from 'lucide-react'
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
    lineBadge: 'EW',
    lineBadgeColor: 'bg-indigo-600',
    steps: (leg) => [
      { icon: Footprints, label: 'Walk to MRT station', sub: '3–5 min · ~350 m' },
      { icon: Train,      label: 'Board MRT · East-West Line', sub: 'Platform 1 · Direction: Pasir Ris · Next in 3 min' },
      { icon: Train,      label: `Ride ${Math.max(2, Math.round((leg.duration_minutes ?? 15) * 0.6))} min`, sub: '2–4 stops' },
      { icon: Footprints, label: 'Alight · Exit B', sub: '2–3 min walk to destination' },
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
    lineBadge: 'BP',
    lineBadgeColor: 'bg-violet-600',
    steps: (leg) => [
      { icon: Footprints, label: 'Walk to LRT station', sub: '2–4 min' },
      { icon: Train,      label: 'Board LRT', sub: 'Platform A' },
      { icon: Train,      label: `Ride ${leg.duration_minutes ?? 8} min`, sub: '1–2 stops' },
      { icon: Footprints, label: 'Alight and walk', sub: '1–2 min to destination' },
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
    lineBadge: '7',
    lineBadgeColor: 'bg-rose-600',
    steps: (leg) => [
      { icon: Footprints, label: 'Walk to bus stop', sub: '3–5 min · ~300 m' },
      { icon: Bus,        label: 'Board Bus · Next in 3 min', sub: 'Platform A' },
      { icon: Bus,        label: `Ride ${leg.duration_minutes ?? 12} min`, sub: '3–5 stops' },
      { icon: Footprints, label: 'Alight and walk', sub: '2–4 min to destination' },
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
      { icon: Car, label: `Drive or take taxi · ${leg.duration_minutes ?? 10} min`, sub: 'Approx. S$8–15 by taxi' },
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

/* ── Step row ─────────────────────────────────────────────────────── */
function StepRow({ step, isLast, accentColor, alertHighlight }) {
  const { icon: StepIcon, label, sub } = step
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 bg-white transition',
            alertHighlight && 'ring-2 ring-red-400 animate-pulse'
          )}
          style={{ borderColor: alertHighlight ? '#ef4444' : accentColor }}
        >
          <StepIcon
            className="h-3 w-3"
            style={{ color: alertHighlight ? '#ef4444' : accentColor }}
          />
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-slate-100" style={{ minHeight: 16 }} />}
      </div>
      <div className="pb-3 pt-0.5 min-w-0">
        <p className={cn('text-sm font-medium leading-tight', alertHighlight ? 'text-red-700' : 'text-slate-900')}>
          {label}
        </p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

/* ── Transit alert strip ──────────────────────────────────────────── */
function TransitAlertStrip({ onDismiss }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 mt-2 animate-fade-up">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <AlertTriangle size={13} className="text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-[12.5px] font-semibold text-red-900">Live alert · Signal fault</p>
            <p className="text-[12px] text-red-700 mt-0.5">
              Delays up to 15 mins between Somerset and Bugis
            </p>
          </div>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="grid h-5 w-5 place-items-center text-red-400 hover:text-red-600 shrink-0">
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Alternative bus panel ────────────────────────────────────────── */
function AlternativeBusPanel({ leg, onSwitchToBus }) {
  const busDuration = Math.round((leg.duration_minutes ?? 14) * 0.9)
  const timeSaved = (leg.duration_minutes ?? 14) - busDuration
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mt-2 animate-fade-up">
      <p className="text-[12px] font-semibold text-slate-700 mb-2">Alternative route available</p>
      <div className="flex items-center gap-3 text-[11.5px] text-slate-600 mb-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 h-5 text-rose-700 font-semibold">
          Bus 7
        </span>
        <span>~{busDuration} min</span>
        {timeSaved > 0 && (
          <span className="text-emerald-700 font-semibold">Save ~{timeSaved} min</span>
        )}
        <span>· S${leg.cost_sgd != null ? leg.cost_sgd.toFixed(2) : '1.90'}</span>
      </div>
      <button
        onClick={onSwitchToBus}
        className="w-full h-8 rounded-lg bg-rose-600 text-white text-[12.5px] font-semibold hover:bg-rose-700 transition inline-flex items-center justify-center gap-1.5"
      >
        <Bus size={12} /> Switch to Bus Route ▶
      </button>
    </div>
  )
}

/* ── Main export ──────────────────────────────────────────────────── */
export default function CitymapperTransitCard({
  leg,
  onEdit,
  isActive = false,
  transitAlert = null,
  transitVariant = 'mrt',
  onSwitchToBus,
  onDismissTransit,
}) {
  const [open, setOpen] = useState(isActive)

  const effectiveMode = isActive && transitVariant === 'bus' && transitAlert == null
    ? 'BUS'
    : (leg.transport_mode ?? 'BUS').toUpperCase()

  const config = MODE_CONFIG[effectiveMode] ?? MODE_CONFIG.BUS
  const { label, Icon, color, bg, border, accentText, crowding, crowdingColor, crowdingText, steps } = config
  const stepList = steps(leg)
  const cost = leg.cost_sgd != null ? `S$${leg.cost_sgd.toFixed(2)}` : null

  const alertMode = !!transitAlert && isActive
  const showAlternativeBus =
    alertMode && transitVariant === 'mrt' && (effectiveMode === 'MRT' || effectiveMode === 'LRT')

  return (
    <div className={cn(
      'rounded-2xl border bg-white shadow-card overflow-hidden',
      alertMode ? 'border-red-300' : border
    )}>
      {/* Collapsed header */}
      <button
        onClick={() => !isActive && setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 text-left',
          isActive && 'cursor-default'
        )}
      >
        <div
          className={cn(
            'grid h-9 w-9 shrink-0 place-items-center rounded-xl transition',
            alertMode && 'ring-2 ring-red-400 animate-pulse'
          )}
          style={{ background: bg }}
        >
          <Icon className="h-4 w-4" style={{ color: alertMode ? '#ef4444' : color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            {label}
            {alertMode && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 text-red-700 px-1.5 h-4 text-[10px] font-bold">
                DISRUPTED
              </span>
            )}
            {config.lineBadge && isActive && (
              <span
                className="inline-flex items-center px-1.5 h-4 rounded text-white text-[10px] font-bold"
                style={{ background: config.lineBadgeColor }}
              >
                {config.lineBadge}
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500">
            {leg.duration_minutes} min{cost ? ` · ${cost}` : ''}
            {leg.is_estimated && ' · ~Est.'}
          </p>
        </div>
        {crowding && !isActive && (
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-100 bg-slate-50 px-2 h-6 text-xs font-medium">
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full', crowdingColor)} />
            <span className={cn(crowdingText)}>{crowding}</span>
          </span>
        )}
        {onEdit && !isActive && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"
            aria-label="Edit transport mode"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
        {!isActive && (
          <ChevronDown
            className={cn('h-4 w-4 text-slate-400 transition-transform shrink-0', open && 'rotate-180')}
          />
        )}
      </button>

      {/* Expanded steps */}
      {(open || isActive) && (
        <div className="border-t border-slate-50 px-4 pb-3 pt-4 animate-fade-up">
          {stepList.map((step, i) => (
            <StepRow
              key={i}
              step={step}
              isLast={i === stepList.length - 1}
              accentColor={color}
              alertHighlight={alertMode && i === 1}
            />
          ))}
          {leg.is_estimated && (
            <p className="mt-1 text-xs text-amber-600">~ Times are estimated based on typical route durations</p>
          )}

          {/* Transit disruption alert strip */}
          {alertMode && (
            <TransitAlertStrip onDismiss={onDismissTransit} />
          )}

          {/* Alternative bus panel */}
          {showAlternativeBus && onSwitchToBus && (
            <AlternativeBusPanel leg={leg} onSwitchToBus={onSwitchToBus} />
          )}
        </div>
      )}
    </div>
  )
}
