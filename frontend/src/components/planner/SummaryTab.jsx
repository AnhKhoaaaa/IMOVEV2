import { useMemo, useState } from 'react'
import { Clock, Wallet, Footprints, ArrowLeftRight, Sparkles, Share2, FileDown, Zap, Navigation2, Save, Trash2 } from 'lucide-react'
import { useT } from '../../contexts/LanguageContext'

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
  weather_swap: { emoji: '☔', color: 'bg-sky-50 border-sky-200 text-sky-700' },
  transit_reroute: { emoji: '🚇', color: 'bg-red-50 border-red-200 text-red-700' },
  mode_change: { emoji: '🔄', color: 'bg-slate-50 border-slate-200 text-slate-600' },
}

function LogBadge({ entry }) {
  const cfg = LOG_TYPE_CONFIG[entry.type] ?? LOG_TYPE_CONFIG.mode_change
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${cfg.color}`}>
      <span className="text-[14px] shrink-0">{cfg.emoji}</span>
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
          <button
            onClick={() => onSave?.(tripName || pendingSave.name)}
            className="w-full h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-display font-bold text-[14px] shadow-card inline-flex items-center justify-center gap-2 hover:opacity-90 transition"
          >
            <Save size={15} /> {t('sumSaveBtn')}
          </button>
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

      {/* By day */}
      {days.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
          <div className="font-display font-bold text-[14px] text-slate-900 mb-3">{t('sumByDay')}</div>
          <div className="space-y-3">
            {days.map((d) => {
              const m = (d.legs ?? []).reduce((s, l) => s + (l.duration_minutes ?? 0), 0)
              const stops = (d.legs ?? []).length + (d.legs?.length > 0 ? 1 : 0)
              return (
                <div key={d.day} className="flex items-center justify-between text-[13px]">
                  <span className="inline-flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-md bg-indigo-50 text-indigo-700 font-display font-bold text-[11px]">
                      D{d.day}
                    </span>
                    <span className="font-medium text-slate-900">{t('tripDay', d.day)}</span>
                    <span className="text-slate-400">· {t('tripStopsCount', stops)}</span>
                  </span>
                  <span className="tabular-nums text-slate-600">{fmtMin(m)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Pace check */}
      {totalPlaces > 0 && days.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={13} className="text-fuchsia-600" />
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
          <Zap size={13} className="text-indigo-600" />
          <div className="font-display font-bold text-[14px] text-slate-900">{t('sumAgentActivity')}</div>
          {optimizationLog.length > 0 && (
            <span className="grid h-5 w-5 place-items-center rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold ml-auto">
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
            className="flex-1 h-9 rounded-lg border border-indigo-200 bg-indigo-50 text-[13px] font-semibold text-indigo-700 hover:bg-indigo-100 transition inline-flex items-center justify-center gap-1.5"
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
