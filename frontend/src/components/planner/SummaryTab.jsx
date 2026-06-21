import { useMemo, useState } from 'react'
import { Clock, Wallet, Footprints, ArrowLeftRight, Sparkles, Share2, FileDown, Zap, Navigation2, Save, Trash2, CloudRain, TrainFront, Repeat, PieChart } from 'lucide-react'
import { useT } from '../../contexts/LanguageContext'
import { transportMeta, normalizeTransportMode } from '../../lib/transport'
import { Button } from '../ui/button'

// Mode-token donut (no chart lib): each segment is an arc of a stroked circle.
function Donut({ segments, total }) {
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
          <div className="font-display text-[20px] font-extrabold text-slate-900">{segments.length}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">modes</div>
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

const LOG_TYPE_CONFIG = {
  weather_swap:    { Icon: CloudRain, color: 'border-info-500/25 bg-info-50 text-info-600' },
  transit_reroute: { Icon: TrainFront, color: 'border-danger-500/25 bg-danger-50 text-danger-600' },
  mode_change:     { Icon: Repeat, color: 'border-slate-200 bg-slate-50 text-slate-600' },
}

function LogBadge({ entry }) {
  const cfg = LOG_TYPE_CONFIG[entry.type] ?? LOG_TYPE_CONFIG.mode_change
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${cfg.color}`}>
      <cfg.Icon size={15} className="shrink-0" />
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold leading-snug">{entry.title}</p>
        {entry.detail && (
          <p className="text-[11.5px] opacity-75 leading-snug">{entry.detail}</p>
        )}
      </div>
      {entry.time && (
        <span className="ml-auto text-[10.5px] font-medium opacity-60 shrink-0 tabular-nums">
          {entry.time}
        </span>
      )}
    </div>
  )
}

export default function SummaryTab({ trip, optimizationLog = [], pendingSave = null, onSave, onDelete }) {
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
  const totalPlaces = trip?.places?.length ?? 0

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

      {/* Transport breakdown — donut by distance per mode */}
      {modeStats.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <PieChart size={13} className="text-blue-600" />
            <div className="font-display font-bold text-[14px] text-slate-900">{t('sumModeSplit')}</div>
          </div>
          <div className="flex items-center gap-5">
            <Donut segments={donutSegments} total={totalKm} />
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

      {/* By day — active-time bars */}
      {days.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
          <div className="font-display font-bold text-[14px] text-slate-900 mb-3">{t('sumByDay')}</div>
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

      {/* Pace check */}
      {totalPlaces > 0 && days.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={13} className="text-blue-600" />
            <div className="font-display font-bold text-[14px] text-slate-900">{t('sumPaceCheck')}</div>
          </div>
          <div className="text-[13px] text-slate-600 leading-relaxed">
            {t('sumPaceText', totalPlaces, days.length, (totalPlaces / days.length).toFixed(1))}
          </div>
        </div>
      )}

      {/* Agent activity log */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap size={13} className="text-blue-600" />
          <div className="font-display font-bold text-[14px] text-slate-900">{t('sumAgentActivity')}</div>
          {optimizationLog.length > 0 && (
            <span className="grid h-5 w-5 place-items-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold ml-auto">
              {optimizationLog.length}
            </span>
          )}
        </div>
        {optimizationLog.length === 0 ? (
          <p className="text-[12.5px] text-slate-400 italic">{t('sumNoAgent')}</p>
        ) : (
          <div className="space-y-2">
            {optimizationLog.map((entry, i) => (
              <LogBadge key={i} entry={entry} />
            ))}
          </div>
        )}
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
