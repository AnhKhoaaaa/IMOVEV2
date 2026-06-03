import { Bus, Bike, Footprints, Route, Train } from 'lucide-react'

export const TRANSPORT_OPTIONS = [
  { mode: 'METRO', label: 'MRT', Icon: Train },
  { mode: 'BUS', label: 'Bus', Icon: Bus },
  { mode: 'WALK', label: 'Walk', Icon: Footprints },
  { mode: 'CYCLE', label: 'Cycle', Icon: Bike },
]

export const TRANSPORT_META = {
  METRO: { label: 'MRT', Icon: Train, tone: 'bg-blue-50 text-blue-700 border-blue-100', color: '#2563eb' },
  MRT: { label: 'MRT', Icon: Train, tone: 'bg-blue-50 text-blue-700 border-blue-100', color: '#2563eb' },
  LRT: { label: 'MRT', Icon: Train, tone: 'bg-violet-50 text-violet-700 border-violet-100', color: '#7c3aed' },
  BUS: { label: 'Bus', Icon: Bus, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100', color: '#10b981' },
  WALK: { label: 'Walk', Icon: Footprints, tone: 'bg-orange-50 text-orange-700 border-orange-100', color: '#f97316' },
  CYCLE: { label: 'Cycle', Icon: Bike, tone: 'bg-teal-50 text-teal-700 border-teal-100', color: '#0d9488' },
}

export function normalizeTransportMode(mode) {
  const upper = String(mode ?? '').toUpperCase()
  if (upper === 'MRT' || upper === 'LRT') return 'METRO'
  if (upper === 'DRIVE') return 'METRO'
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
