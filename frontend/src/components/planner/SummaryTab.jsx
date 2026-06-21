import { useMemo, useState } from 'react'
import { Clock, Wallet, Footprints, ArrowLeftRight, Share2, FileDown, Navigation2, Save, Trash2, PieChart, BarChart3, Layers, Timer, Calendar } from 'lucide-react'
import { useT } from '../../contexts/LanguageContext'
import { transportMeta, normalizeTransportMode } from '../../lib/transport'
import { categoryGroup } from '../../lib/categories'
import { Button } from '../ui/button'

// Mode-token donut (no chart lib): each segment is an arc of a stroked circle.
function Donut({ segments, total, centerLabel, centerSub }) {
  const r = 42
  const C = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="relative h-32 w-32 shrink-0">
      <svg viewBox="0 0 100 100" className="h-32 w-32 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#eef2f7" strokeWidth="13" />
        {total > 0 && segments.map((s, i) => {
          const dash = (s.value / total) * C
          const el = (
            <circle
              key={i} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="13"
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-offset}
            />
          )
          offset += dash
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-none">
          <div className="font-display text-[20px] font-extrabold text-slate-900">{centerLabel}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{centerSub}</div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, Icon }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
      <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold text-slate-500">
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-2 font-display font-extrabold text-[28px] text-slate-900 leading-none">{value}</div>
    </div>
  )
}

function fmtMin(m) {
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

// Category token colours — mirrors lib/categories.js
const CATEGORY_COLORS = {
  culture: { bg: '#f5f3ff', fill: '#7c3aed', text: 'text-[#7c3aed]' },
  landmark: { bg: '#eff6ff', fill: '#2563eb', text: 'text-[#2563eb]' },
  nature: { bg: '#ecfdf5', fill: '#059669', text: 'text-[#059669]' },
  food: { bg: '#fffbeb', fill: '#d97706', text: 'text-[#d97706]' },
  shopping: { bg: '#fdf2f8', fill: '#db2777', text: 'text-[#db2777]' },
  entertainment: { bg: '#fdf4ff', fill: '#c026d3', text: 'text-[#c026d3]' },
  default: { bg: '#f8fafc', fill: '#64748b', text: 'text-[#64748b]' },
}

export default function SummaryTab({ trip, pendingSave = null, onSave, onDelete }) {
  const { t } = useT()
  const [tripName, setTripName] = useState(pendingSave?.name ?? '')
  const days = trip?.days ?? []
  const allLegs = useMemo(() => days.flatMap((d) => d.legs ?? []), [days])

  const transitMin = allLegs.reduce((s, l) => s + (l.duration_minutes ?? 0), 0)
  const dwellMin = (trip?.places ?? []).reduce((s, p) => s + (p.dwell_minutes ?? 0), 0)
  const totalMin = transitMin + dwellMin
  const totalCost = allLegs
    .filter((l) => (l.transport_mode ?? '').toUpperCase() !== 'WALK')
    .reduce((s, l) => s + (l.cost_sgd ?? 0), 0)
  const walkLegs = allLegs.filter((l) => (l.transport_mode ?? '').toUpperCase() === 'WALK')
  const walkM = walkLegs.reduce((s, l) =>
    s + (l.distance_km != null ? Math.round(l.distance_km * 1000) : (l.duration_minutes ?? 0) * 80), 0)
  const transfers = allLegs.filter((l) => !['WALK'].includes((l.transport_mode ?? '').toUpperCase())).length

  // Transport-mode breakdown (km, count) for the donut — uses mode tokens for colour
  const modeStats = useMemo(() => {
    const acc = {}
    for (const l of allLegs) {
      const m = normalizeTransportMode(l.transport_mode)
      const km = l.distance_km != null
        ? l.distance_km
        : ((l.duration_minutes ?? 0) * (m === 'WALK' ? 0.08 : 0.5)) // rough fallback
      acc[m] = acc[m] ?? { mode: m, km: 0, count: 0 }
      acc[m].km += km
      acc[m].count += 1
    }
    return Object.values(acc)
      .map((s) => ({ ...s, color: transportMeta(s.mode).color, label: transportMeta(s.mode).label }))
      .sort((a, b) => b.km - a.km)
  }, [allLegs])
  const totalKm = modeStats.reduce((s, m) => s + m.km, 0)
  const donutSegments = modeStats.map((m) => ({ value: m.km, color: m.color }))

  // Per-day active minutes (transit + dwell), for the bar chart
  const dayMinutes = days.map((d) => {
    const tMin = (d.legs ?? []).reduce((s, l) => s + (l.duration_minutes ?? 0), 0)
    const ids = new Set((d.legs ?? []).flatMap((l) => [l.from_place_id, l.to_place_id]))
    const dMin = (trip?.places ?? []).filter((p) => ids.has(p.id)).reduce((s, p) => s + (p.dwell_minutes ?? 0), 0)
    return { day: d.day, min: tMin + dMin }
  })
  const maxDayMin = Math.max(...dayMinutes.map((d) => d.min), 1)

  // ── NEW CHART DATA ──

  // 1. Cost Breakdown per Day (stacked by transport mode)
  const dayCostBreakdown = useMemo(() => {
    return days.map((d) => {
      const byMode = {}
      for (const l of d.legs ?? []) {
        const m = normalizeTransportMode(l.transport_mode)
        if (m === 'WALK') continue // Walk is free
        byMode[m] = (byMode[m] ?? 0) + (l.cost_sgd ?? 0)
      }
      const total = Object.values(byMode).reduce((s, v) => s + v, 0)
      const segments = Object.entries(byMode).map(([mode, cost]) => ({
        mode, cost, color: transportMeta(mode).color, label: transportMeta(mode).label,
      }))
      return { day: d.day, total, segments }
    })
  }, [days])
  const maxDayCost = Math.max(...dayCostBreakdown.map((d) => d.total), 0.01)

  // 2. Time Distribution (dwell vs transit)
  const timeDonut = useMemo(() => {
    if (totalMin === 0) return []
    return [
      { value: dwellMin, color: '#059669', label: t('sumTimeSightseeing') },
      { value: transitMin, color: '#3b82f6', label: t('sumTimeTransit') },
    ]
  }, [dwellMin, transitMin, totalMin, t])

  // 3. Category Mix
  const categoryStats = useMemo(() => {
    const acc = {}
    for (const p of trip?.places ?? []) {
      if (p.id === 'hotel') continue
      const group = categoryGroup(p.category)
      acc[group] = (acc[group] ?? 0) + 1
    }
    return Object.entries(acc)
      .map(([cat, count]) => ({ cat, count, ...(CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.default) }))
      .sort((a, b) => b.count - a.count)
  }, [trip])
  const maxCatCount = Math.max(...categoryStats.map((c) => c.count), 1)

  const cards = [
    { label: t('sumActiveTime'),  value: fmtMin(totalMin),     Icon: Clock },
    { label: t('sumTransitCost'), value: `S$${totalCost.toFixed(2)}`, Icon: Wallet },
    { label: t('sumWalkDist'),    value: walkM >= 1000 ? `${(walkM/1000).toFixed(2)} km` : `${walkM} m`, Icon: Footprints },
    { label: t('sumTransfers'),   value: transfers,             Icon: ArrowLeftRight },
  ]

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href).catch(() => {})
  }

  const handlePrint = () => window.print()

  return (
    <div className="space-y-5 animate-fade-up">
      {pendingSave && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Navigation2 size={16} className="text-emerald-600 shrink-0" />
            <p className="font-display font-bold text-[15px] text-emerald-900">{t('sumSaveTitle')}</p>
          </div>
          <p className="text-[12.5px] text-emerald-700 leading-relaxed">
            {t('sumSaveDesc')}
          </p>
          <div className="space-y-2">
            <label className="text-[11.5px] font-semibold text-emerald-800 block">{t('sumTripName')}</label>
            <input
              type="text"
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              className="flex h-10 w-full rounded-xl border border-emerald-200 bg-white px-3 text-[13px] text-slate-900 focus:outline-none focus:border-emerald-400"
            />
          </div>
          <Button variant="success" onClick={() => onSave?.(tripName || pendingSave.name)} className="w-full">
            <Save size={15} /> {t('sumSaveBtn')}
          </Button>
        </div>
      )}
      <div>
        <h2 className="font-display font-extrabold text-[22px] text-slate-900">{t('sumTitle')}</h2>
        <p className="text-[13px] text-slate-500 mt-1">
          {t('sumDesc')}
        </p>
      </div>

      {/* 2×2 stat grid */}
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} Icon={c.Icon} />
        ))}
      </div>

      {/* Proportional & Categorical Charts Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
        {/* Column 1: Proportions & Splits (Left) */}
        <div className="space-y-4">
          {/* Transport breakdown — donut by distance per mode */}
          {modeStats.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
              <div className="flex items-center gap-2.5 mb-4 pb-2 border-b border-slate-100">
                <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600 shrink-0">
                  <PieChart size={15} />
                </span>
                <span className="font-display font-extrabold text-[15px] text-slate-900">{t('sumModeSplit')}</span>
              </div>
              <div className="flex items-center gap-5">
                <Donut segments={donutSegments} total={totalKm} centerLabel={modeStats.length} centerSub="modes" />
                <div className="min-w-0 flex-1 space-y-2">
                  {modeStats.map((m) => (
                    <div key={m.mode} className="flex items-center gap-2 text-[12.5px]">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.color }} />
                      <span className="font-semibold text-slate-700">{m.label}</span>
                      <span className="ml-auto tabular-nums text-slate-500">
                        {m.km >= 1 ? `${m.km.toFixed(1)} km` : `${Math.round(m.km * 1000)} m`}
                        <span className="text-slate-300"> · </span>
                        {totalKm > 0 ? Math.round((m.km / totalKm) * 100) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Time Distribution — dwell vs transit donut */}
          {totalMin > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
              <div className="flex items-center gap-2.5 mb-4 pb-2 border-b border-slate-100">
                <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
                  <Timer size={15} />
                </span>
                <span className="font-display font-extrabold text-[15px] text-slate-900">{t('sumTimeDistribution')}</span>
              </div>
              <div className="flex items-center gap-5">
                <Donut
                  segments={timeDonut.map((s) => ({ value: s.value, color: s.color }))}
                  total={totalMin}
                  centerLabel={totalMin > 0 ? `${Math.round((dwellMin / totalMin) * 100)}%` : '—'}
                  centerSub={t('sumTimeSightseeing')}
                />
                <div className="min-w-0 flex-1 space-y-3">
                  {timeDonut.map((s) => (
                    <div key={s.label}>
                      <div className="flex items-center justify-between text-[12.5px] mb-1">
                        <span className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                          <span className="font-semibold text-slate-700">{s.label}</span>
                        </span>
                        <span className="tabular-nums text-slate-500">
                          {fmtMin(s.value)} · {totalMin > 0 ? Math.round((s.value / totalMin) * 100) : 0}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${totalMin > 0 ? (s.value / totalMin) * 100 : 0}%`, background: s.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Column 2: Day-by-Day Timelines & Category Mix (Right) */}
        <div className="space-y-4">
          {/* Category Mix — horizontal bars */}
          {categoryStats.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
              <div className="flex items-center gap-2.5 mb-4 pb-2 border-b border-slate-100">
                <span className="p-1.5 rounded-lg bg-purple-50 text-purple-600 shrink-0">
                  <Layers size={15} />
                </span>
                <span className="font-display font-extrabold text-[15px] text-slate-900">{t('sumCategoryMix')}</span>
              </div>
              <div className="space-y-2.5">
                {categoryStats.map((c) => (
                  <div key={c.cat} className="flex items-center gap-3">
                    <span
                      className="w-20 shrink-0 rounded-md px-2 py-0.5 text-center text-[11px] font-bold capitalize"
                      style={{ background: c.bg, color: c.fill }}
                    >
                      {c.cat}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(8, (c.count / maxCatCount) * 100)}%`, background: c.fill }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[12px] tabular-nums font-bold text-slate-600">
                      {c.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost Breakdown per Day — stacked horizontal bars */}
          {dayCostBreakdown.some((d) => d.total > 0) && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
              <div className="flex items-center gap-2.5 mb-4 pb-2 border-b border-slate-100">
                <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600 shrink-0">
                  <BarChart3 size={15} />
                </span>
                <span className="font-display font-extrabold text-[15px] text-slate-900">{t('sumCostBreakdown')}</span>
              </div>
              <div className="space-y-3">
                {dayCostBreakdown.map((d) => (
                  <div key={d.day}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-700 font-display font-bold text-[11px]">
                        D{d.day}
                      </span>
                      <span className="text-[12px] font-bold tabular-nums text-slate-600">S${d.total.toFixed(2)}</span>
                    </div>
                    <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                      {d.segments.map((seg) => (
                        <div
                          key={seg.mode}
                          className="h-full transition-all"
                          style={{
                            width: `${maxDayCost > 0 ? (seg.cost / maxDayCost) * 100 : 0}%`,
                            background: seg.color,
                          }}
                          title={`${seg.label}: S$${seg.cost.toFixed(2)}`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Legend */}
              <div className="mt-3 flex flex-wrap gap-3">
                {[...new Set(dayCostBreakdown.flatMap((d) => d.segments.map((s) => s.mode)))].map((mode) => {
                  const meta = transportMeta(mode)
                  return (
                    <div key={mode} className="flex items-center gap-1.5 text-[11px]">
                      <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} />
                      <span className="font-semibold text-slate-500">{meta.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Time breakdown by day (Active-time bars) */}
          {days.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
              <div className="flex items-center gap-2.5 mb-4 pb-2 border-b border-slate-100">
                <span className="p-1.5 rounded-lg bg-sky-50 text-sky-600 shrink-0">
                  <Calendar size={15} />
                </span>
                <span className="font-display font-extrabold text-[15px] text-slate-900">{t('sumByDay')}</span>
              </div>
              <div className="space-y-2.5">
                {dayMinutes.map((d) => (
                  <div key={d.day} className="flex items-center gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-700 font-display font-bold text-[11px]">
                      D{d.day}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.max(4, (d.min / maxDayMin) * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-slate-600">{fmtMin(d.min)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Share / Export */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
        <div className="font-display font-bold text-[14px] text-slate-900 mb-3">{t('sumShareExport')}</div>
        <div className="flex gap-2">
          <button
            onClick={handleShare}
            className="flex-1 h-9 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition inline-flex items-center justify-center gap-1.5"
          >
            <Share2 size={13} /> {t('sumShareLink')}
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 h-9 rounded-lg border border-blue-200 bg-blue-50 text-[13px] font-semibold text-blue-700 hover:bg-blue-100 transition inline-flex items-center justify-center gap-1.5"
          >
            <FileDown size={13} /> {t('sumSavePdf')}
          </button>
        </div>
      </div>

      {/* Delete trip */}
      {onDelete && (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
          <div className="font-display font-bold text-[14px] text-red-900 mb-1">{t('sumDanger')}</div>
          <p className="text-[12px] text-red-700 mb-3">{t('sumDangerDesc')}</p>
          <button
            onClick={onDelete}
            className="h-9 px-4 rounded-lg border border-red-300 bg-white text-[13px] font-semibold text-red-600 hover:bg-red-100 transition inline-flex items-center gap-1.5"
          >
            <Trash2 size={13} /> {t('sumDeleteTrip')}
          </button>
        </div>
      )}
    </div>
  )
}
