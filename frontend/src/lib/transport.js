import { Bus, Bike, Car, Footprints, Route, Train } from 'lucide-react'

export const TRANSPORT_OPTIONS = [
  { mode: 'METRO', label: 'MRT',  Icon: Train },
  { mode: 'BUS',   label: 'Bus',  Icon: Bus },
  { mode: 'WALK',  label: 'Walk', Icon: Footprints },
  { mode: 'CYCLE', label: 'Cycle', Icon: Bike },
  { mode: 'GRAB',  label: 'Grab', Icon: Car },
]

// Single source of truth for transit-mode colour. `tone` = Tailwind classes for badges/chips,
// `color` = hex for Leaflet polylines / inline SVG. Both mirror the locked design-system mode
// tokens in index.css (--color-mode-*), so the Trip transit cards + TripMap stay in sync.
export const TRANSPORT_META = {
  METRO: { label: 'MRT',   Icon: Train,      tone: 'bg-mode-mrt-50 text-mode-mrt border-mode-mrt/20',     color: '#2563eb' },
  MRT:   { label: 'MRT',   Icon: Train,      tone: 'bg-mode-mrt-50 text-mode-mrt border-mode-mrt/20',     color: '#2563eb' },
  LRT:   { label: 'MRT',   Icon: Train,      tone: 'bg-mode-lrt-50 text-mode-lrt border-mode-lrt/20',     color: '#3b82f6' },
  BUS:   { label: 'Bus',   Icon: Bus,        tone: 'bg-mode-bus-50 text-mode-bus border-mode-bus/20',     color: '#06b6d4' },
  WALK:  { label: 'Walk',  Icon: Footprints, tone: 'bg-mode-walk-50 text-mode-walk border-mode-walk/25',  color: '#64748b' },
  CYCLE: { label: 'Cycle', Icon: Bike,       tone: 'bg-mode-cycle-50 text-mode-cycle border-mode-cycle/20', color: '#f97316' },
  GRAB:  { label: 'Grab',  Icon: Car,        tone: 'bg-mode-taxi-50 text-mode-taxi border-mode-taxi/20',  color: '#00b14f' },
}

export function normalizeTransportMode(mode) {
  const upper = String(mode ?? '').toUpperCase()
  if (upper === 'MRT' || upper === 'LRT') return 'METRO'
  if (upper === 'DRIVE') return 'METRO'
  if (upper === 'GRAB') return 'GRAB'
  return upper || 'METRO'
}

export function transportMeta(mode) {
  return TRANSPORT_META[normalizeTransportMode(mode)] ?? {
    label: mode || 'Route',
    Icon: Route,
    tone: 'bg-slate-50 text-slate-600 border-slate-100',
    color: '#64748b',
  }
}

export function availableModesForLeg(leg) {
  const keys = Object.keys(leg?.alternatives ?? {}).map(normalizeTransportMode)
  const unique = [...new Set(keys)]
  const modes = unique.length ? unique : TRANSPORT_OPTIONS.map((item) => item.mode)
  return TRANSPORT_OPTIONS.filter((item) => modes.includes(item.mode))
}

export function allModesWithAvailability(leg) {
  const hasAlts = leg?.alternatives && Object.keys(leg.alternatives).length > 0
  if (!hasAlts) return TRANSPORT_OPTIONS.map((o) => ({ ...o, available: true }))
  const avail = new Set(Object.keys(leg.alternatives).map(normalizeTransportMode))
  return TRANSPORT_OPTIONS.map((o) => ({ ...o, available: avail.has(o.mode) }))
}
