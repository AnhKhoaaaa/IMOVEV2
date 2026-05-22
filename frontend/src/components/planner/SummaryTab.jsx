import { useMemo } from 'react'
import { Clock, Wallet, Footprints, ArrowLeftRight, Sparkles } from 'lucide-react'

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

export default function SummaryTab({ trip }) {
  const days = trip?.days ?? []
  const allLegs = useMemo(() => days.flatMap((d) => d.legs ?? []), [days])

  const totalMin = allLegs.reduce((s, l) => s + (l.duration_minutes ?? 0), 0)
  const totalCost = allLegs.reduce((s, l) => s + (l.cost_sgd ?? 0), 0)
  const walkLegs = allLegs.filter((l) => (l.transport_mode ?? '').toUpperCase() === 'WALK')
  const walkM = walkLegs.reduce((s, l) => s + (l.duration_minutes ?? 0) * 80, 0)
  const transfers = allLegs.filter((l) => !['WALK'].includes((l.transport_mode ?? '').toUpperCase())).length
  const totalPlaces = trip?.places?.length ?? 0

  const cards = [
    { label: 'Active time',       value: fmtMin(totalMin),                   Icon: Clock },
    { label: 'Transit cost',      value: `S$${totalCost.toFixed(2)}`,         Icon: Wallet },
    { label: 'Walking distance',  value: walkM >= 1000 ? `${(walkM/1000).toFixed(2)} km` : `${walkM} m`, Icon: Footprints },
    { label: 'Transfers',         value: transfers,                            Icon: ArrowLeftRight },
  ]

  return (
    <div className="space-y-5 animate-fade-up">
      <div>
        <h2 className="font-display font-extrabold text-[22px] text-slate-900">Trip summary</h2>
        <p className="text-[13px] text-slate-500 mt-1">
          Estimates derived from your current itinerary. Will recalculate when you change transit modes.
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
          <div className="font-display font-bold text-[14px] text-slate-900 mb-3">By day</div>
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
                    <span className="font-medium text-slate-900">Day {d.day}</span>
                    <span className="text-slate-400">· {stops} stop{stops !== 1 ? 's' : ''}</span>
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
            <div className="font-display font-bold text-[14px] text-slate-900">Pace check</div>
          </div>
          <div className="text-[13px] text-slate-600 leading-relaxed">
            Your trip has{' '}
            <span className="font-semibold text-slate-900">{totalPlaces} stops</span>{' '}
            across{' '}
            <span className="font-semibold text-slate-900">{days.length} days</span>{' '}
            — averaging{' '}
            <span className="font-semibold text-slate-900">
              {(totalPlaces / days.length).toFixed(1)} stops/day
            </span>. Looks comfortable.
          </div>
        </div>
      )}
    </div>
  )
}
