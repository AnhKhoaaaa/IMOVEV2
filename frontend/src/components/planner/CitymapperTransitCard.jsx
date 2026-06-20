import { useState } from 'react'
import { Train, Bus, Footprints, Car, Bike, ChevronDown, AlertTriangle, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import BusArrivalPanel from '../transit/BusArrivalPanel'
import { useT } from '../../contexts/LanguageContext'

const SUB_LEG_ICONS = { MRT: Train, LRT: Train, BUS: Bus, WALK: Footprints }

function getLineBadge(leg) {
  const transit = (leg.sub_legs ?? []).find(s => s.mode !== 'WALK' && s.route)
  return transit?.route ?? null
}

// Colours mirror the locked design-system mode tokens (index.css --color-mode-*) so this card
// matches transport.js + TripMap. crowding stays on state semantics (success=low, warning=moderate).
const MODE_CONFIG = {
  MRT: {
    labelKey: 'transport_mrt',
    Icon: Train,
    color: '#2563eb',
    bg: '#eff6ff',
    border: 'border-mode-mrt/20',
    accentText: 'text-mode-mrt',
    crowdingKey: 'ctCrowdLow',
    crowdingColor: 'bg-success-500',
    crowdingText: 'text-success-600',
    badgeBg: '#2563eb',
  },
  LRT: {
    labelKey: 'ctLrt',
    Icon: Train,
    color: '#3b82f6',
    bg: '#eff6ff',
    border: 'border-mode-lrt/20',
    accentText: 'text-mode-lrt',
    crowdingKey: 'ctCrowdLow',
    crowdingColor: 'bg-success-500',
    crowdingText: 'text-success-600',
    badgeBg: '#3b82f6',
  },
  BUS: {
    labelKey: 'transport_bus',
    Icon: Bus,
    color: '#06b6d4',
    bg: '#ecfeff',
    border: 'border-mode-bus/20',
    accentText: 'text-mode-bus',
    crowdingKey: 'ctCrowdModerate',
    crowdingColor: 'bg-warning-500',
    crowdingText: 'text-warning-600',
    badgeBg: '#06b6d4',
  },
  WALK: {
    labelKey: 'transport_walk',
    Icon: Footprints,
    color: '#64748b',
    bg: '#f1f5f9',
    border: 'border-mode-walk/25',
    accentText: 'text-mode-walk',
    crowdingKey: null,
  },
  DRIVE: {
    labelKey: 'ctDriveTaxi',
    Icon: Car,
    color: '#00b14f',
    bg: '#ecfdf5',
    border: 'border-mode-taxi/20',
    accentText: 'text-mode-taxi',
    crowdingKey: null,
  },
  CYCLE: {
    labelKey: 'transport_cycle',
    Icon: Bike,
    color: '#f97316',
    bg: '#fff7ed',
    border: 'border-mode-cycle/20',
    accentText: 'text-mode-cycle',
    crowdingKey: null,
  },
}

/* ── Sub-leg row (structured board/alight data from backend) ───── */
function SubLegRow({ sub, isLast, accentColor }) {
  const { t } = useT()
  const Icon = SUB_LEG_ICONS[sub.mode] ?? Footprints
  const [showArrivals, setShowArrivals] = useState(false)
  const canShowArrivals = sub.mode === 'BUS' && !!sub.from_stop_code

  let text
  if (sub.mode === 'WALK') {
    text = sub.to_name
      ? t('ctWalkTo', sub.to_name, sub.duration_minutes)
      : t('ctWalk', sub.duration_minutes)
  } else {
    const dur = sub.duration_minutes ? t('ctDur', sub.duration_minutes, sub.num_stops) : ''
    const line = sub.route ? `[${sub.route}] ` : ''
    const board = sub.from_name ? t('ctBoardAt', sub.from_name) : t('ctBoard')
    const alight = sub.to_name ? t('ctAlightAt', sub.to_name) : ''
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
      <div className="pb-3 pt-0.5 min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight text-slate-900">{text}</p>
          {canShowArrivals && (
            <button
              onClick={() => setShowArrivals((v) => !v)}
              className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 h-5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100 transition"
            >
              {showArrivals ? t('ctHide') : t('ctLiveArrivals')}
            </button>
          )}
        </div>
        {showArrivals && (
          <BusArrivalPanel stopCode={sub.from_stop_code} serviceFilter={sub.route || undefined} />
        )}
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
  const { t } = useT()
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 mt-2 animate-fade-up">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <AlertTriangle size={13} className="text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-[12.5px] font-semibold text-red-900">{t('ctLiveAlert')}</p>
            <p className="text-[12px] text-red-700 mt-0.5">
              {t('ctDelayMsg')}
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
  const { t } = useT()
  const busDuration = Math.round((leg.duration_minutes ?? 14) * 0.9)
  const timeSaved = (leg.duration_minutes ?? 14) - busDuration
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 mt-2 animate-fade-up">
      <p className="text-[12px] font-semibold text-slate-700 mb-2">{t('ctAltRoute')}</p>
      <div className="flex items-center gap-3 text-[11.5px] text-slate-600 mb-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 h-5 text-rose-700 font-semibold">
          Bus 7
        </span>
        <span>{t('ctApproxMin', busDuration)}</span>
        {timeSaved > 0 && (
          <span className="text-emerald-700 font-semibold">{t('ctSaveMin', timeSaved)}</span>
        )}
        <span>· S${leg.cost_sgd != null ? leg.cost_sgd.toFixed(2) : '1.90'}</span>
      </div>
      <button
        onClick={onSwitchToBus}
        className="w-full h-8 rounded-lg bg-rose-600 text-white text-[12.5px] font-semibold hover:bg-rose-700 transition inline-flex items-center justify-center gap-1.5"
      >
        <Bus size={12} /> {t('ctSwitchBus')}
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
  const { t } = useT()
  const hasSubLegs = Array.isArray(leg.sub_legs) && leg.sub_legs.length > 0
  const hasInstructions = Array.isArray(leg.instructions) && leg.instructions.length > 0
  const [open, setOpen] = useState(isActive)

  const effectiveMode = isActive && transitVariant === 'bus' && transitAlert == null
    ? 'BUS'
    : (leg.transport_mode ?? 'BUS').toUpperCase()

  const config = MODE_CONFIG[effectiveMode] ?? MODE_CONFIG.BUS
  const { Icon, color, bg, border, crowdingColor, crowdingText } = config
  const label = t(config.labelKey)
  const crowding = config.crowdingKey ? t(config.crowdingKey) : null
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
                {t('ctDisrupted')}
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
            {t('tripMinShort', leg.duration_minutes)}{cost ? ` · ${cost}` : ''}
            {leg.is_estimated && ` · ${t('ctEst')}`}
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
            aria-label={t('ctEditMode')}
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
                  {t('ctEstimatedNote')}
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
                  {t('ctEstimatedNote')}
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
