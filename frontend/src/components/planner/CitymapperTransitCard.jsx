import { useState } from 'react'
import { Train, Bus, Footprints, Car, Bike, ChevronDown, AlertTriangle, X } from 'lucide-react'
import { cn } from '../../lib/utils'

const SUB_LEG_ICONS = { MRT: Train, LRT: Train, BUS: Bus, WALK: Footprints }

function getLineBadge(leg) {
  const transit = (leg.sub_legs ?? []).find(s => s.mode !== 'WALK' && s.route)
  return transit?.route ?? null
}

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
    badgeBg: '#4f46e5',
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
    badgeBg: '#7c3aed',
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
    badgeBg: '#e11d48',
  },
  WALK: {
    label: 'Walk',
    Icon: Footprints,
    color: '#ea580c',
    bg: '#fff7ed',
    border: 'border-orange-200',
    accentText: 'text-orange-700',
    crowding: null,
  },
  DRIVE: {
    label: 'Drive / Taxi',
    Icon: Car,
    color: '#7c3aed',
    bg: '#f5f3ff',
    border: 'border-violet-200',
    accentText: 'text-violet-700',
    crowding: null,
  },
  CYCLE: {
    label: 'Cycle',
    Icon: Bike,
    color: '#0d9488',
    bg: '#f0fdfa',
    border: 'border-teal-200',
    accentText: 'text-teal-700',
    crowding: null,
  },
}

/* ── Sub-leg row (structured board/alight data from backend) ───── */
function SubLegRow({ sub, isLast, accentColor }) {
  const Icon = SUB_LEG_ICONS[sub.mode] ?? Footprints
  let text
  if (sub.mode === 'WALK') {
    text = sub.to_name
      ? `Walk to ${sub.to_name}${sub.duration_minutes ? ` (${sub.duration_minutes} min)` : ''}`
      : `Walk${sub.duration_minutes ? ` (${sub.duration_minutes} min)` : ''}`
  } else {
    const stopInfo = sub.num_stops ? `, ${sub.num_stops} stops` : ''
    const dur = sub.duration_minutes ? ` (${sub.duration_minutes} min${stopInfo})` : ''
    const line = sub.route ? `[${sub.route}] ` : ''
    const board = sub.from_name ? `Board at ${sub.from_name}` : 'Board'
    const alight = sub.to_name ? ` → Alight at ${sub.to_name}` : ''
    text = `${line}${board}${alight}${dur}`
  }
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 bg-white"
          style={{ borderColor: accentColor }}
        >
          <Icon size={10} style={{ color: accentColor }} />
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-slate-100" style={{ minHeight: 16 }} />}
      </div>
      <div className="pb-3 pt-0.5 min-w-0">
        <p className="text-sm font-medium leading-tight text-slate-900">{text}</p>
      </div>
    </div>
  )
}

/* ── Instruction row (Phase 2: real step-by-step from backend) ──── */
function InstructionRow({ text, isLast, accentColor }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 bg-white"
          style={{ borderColor: accentColor }}
        >
          <div className="h-1.5 w-1.5 rounded-full" style={{ background: accentColor }} />
        </div>
        {!isLast && <div className="mt-1 w-px flex-1 bg-slate-100" style={{ minHeight: 16 }} />}
      </div>
      <div className="pb-3 pt-0.5 min-w-0">
        <p className="text-sm font-medium leading-tight text-slate-900">{text}</p>
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
  const hasSubLegs = Array.isArray(leg.sub_legs) && leg.sub_legs.length > 0
  const hasInstructions = Array.isArray(leg.instructions) && leg.instructions.length > 0
  const [open, setOpen] = useState(isActive)

  const effectiveMode = isActive && transitVariant === 'bus' && transitAlert == null
    ? 'BUS'
    : (leg.transport_mode ?? 'BUS').toUpperCase()

  const config = MODE_CONFIG[effectiveMode] ?? MODE_CONFIG.BUS
  const { label, Icon, color, bg, border, crowding, crowdingColor, crowdingText } = config
  const cost = leg.cost_sgd != null ? `S$${leg.cost_sgd.toFixed(2)}` : null

  const lineBadge = getLineBadge(leg)
  const badgeBg = config.badgeBg ?? color

  const alertMode = !!transitAlert && isActive
  const showAlternativeBus =
    alertMode && transitVariant === 'mrt' && (effectiveMode === 'MRT' || effectiveMode === 'LRT')

  const canExpand = hasSubLegs || hasInstructions || alertMode || showAlternativeBus

  const toggleOpen = () => {
    if (!isActive && hasInstructions) setOpen((o) => !o)
  }

  return (
    <div className={cn(
      'rounded-2xl border bg-white shadow-card overflow-hidden',
      alertMode ? 'border-red-300' : border
    )}>
      {/* Collapsed header */}
      <button
        onClick={toggleOpen}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 text-left',
          (isActive || !hasInstructions) && 'cursor-default'
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
            {lineBadge && (
              <span
                className="inline-flex items-center px-1.5 h-4 rounded text-white text-[10px] font-bold"
                style={{ background: badgeBg }}
              >
                {lineBadge}
              </span>
            )}
          </p>
          <p className="text-xs text-slate-500">
            {leg.duration_minutes} min{cost ? ` · ${cost}` : ''}
            {leg.is_estimated && ' · ~Est.'}
          </p>
        </div>
        {crowding && !isActive && hasInstructions && (
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
        {!isActive && hasInstructions && (
          <ChevronDown
            className={cn('h-4 w-4 text-slate-400 transition-transform shrink-0', open && 'rotate-180')}
          />
        )}
      </button>

      {/* Expanded content */}
      {(open || isActive) && canExpand && (
        <div className="border-t border-slate-50 px-4 pb-3 pt-4 animate-fade-up">
          {hasSubLegs ? (
            <>
              {leg.sub_legs.map((sub, i) => (
                <SubLegRow
                  key={i}
                  sub={sub}
                  isLast={i === leg.sub_legs.length - 1}
                  accentColor={alertMode ? '#ef4444' : color}
                />
              ))}
              {leg.is_estimated && (
                <p className="mt-1 text-xs text-amber-600">
                  ~ Times are estimated based on typical route durations
                </p>
              )}
            </>
          ) : hasInstructions ? (
            <>
              {leg.instructions.map((instruction, i) => (
                <InstructionRow
                  key={i}
                  text={instruction}
                  isLast={i === leg.instructions.length - 1}
                  accentColor={alertMode ? '#ef4444' : color}
                />
              ))}
              {leg.is_estimated && (
                <p className="mt-1 text-xs text-amber-600">
                  ~ Times are estimated based on typical route durations
                </p>
              )}
            </>
          ) : null}

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
