import { useMemo } from 'react'
import { MapPin, ChevronRight, Clock, Wallet, Footprints, ArrowLeftRight } from 'lucide-react'
import { buildOrderedPlaces } from '../../lib/tripUtils'

const MODE_COLORS = {
  MRT: 'bg-indigo-500',
  LRT: 'bg-violet-500',
  BUS: 'bg-emerald-500',
  WALK: 'bg-orange-400',
  DRIVE: 'bg-purple-500',
  CYCLE: 'bg-teal-500',
}

function fmtMin(m) {
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/* ── Metrics strip ───────────────────────────────────────────────── */
function MetricChip({ icon, label, value }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl border border-slate-200 bg-white py-2.5 px-2">
      <span className="text-slate-400">{icon}</span>
      <span className="font-display font-extrabold text-[15px] text-slate-900 tabular-nums leading-none">{value}</span>
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
    </div>
  )
}

export default function OverviewTab({ trip, savedMeta, onJumpDay }) {
  const days = trip?.days ?? []
  const allPlaces = trip?.places ?? []
  const warnings = trip?.warnings ?? []

  const metrics = useMemo(() => {
    const allLegs = days.flatMap((d) => d.legs ?? [])
    const totalMin = allLegs.reduce((s, l) => s + (l.duration_minutes ?? 0), 0)
    const totalCost = allLegs.reduce((s, l) => s + (l.cost_sgd ?? 0), 0)
    const walkLegs = allLegs.filter((l) => (l.transport_mode ?? '').toUpperCase() === 'WALK')
    const walkM = walkLegs.reduce((s, l) => s + (l.duration_minutes ?? 0) * 80, 0)
    return {
      time: fmtMin(totalMin),
      cost: `S$${totalCost.toFixed(2)}`,
      walk: walkM >= 1000 ? `${(walkM / 1000).toFixed(1)}km` : `${walkM}m`,
      stops: allPlaces.length,
    }
  }, [days, allPlaces])

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Metrics strip */}
      {allPlaces.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          <MetricChip icon={<Clock size={13} />} label="Active" value={metrics.time} />
          <MetricChip icon={<Wallet size={13} />} label="Transit" value={metrics.cost} />
          <MetricChip icon={<Footprints size={13} />} label="Walk" value={metrics.walk} />
          <MetricChip icon={<ArrowLeftRight size={13} />} label="Stops" value={metrics.stops} />
        </div>
      )}

      {/* Mini-map preview */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-card overflow-hidden">
        <div className="relative h-44 map-grid">
          <MiniMapSvg days={days} allPlaces={allPlaces} />
          <div className="absolute bottom-3 right-3">
            <button className="inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 px-3 h-8 text-[12.5px] font-semibold text-slate-700 shadow-card hover:bg-slate-50">
              <MapPin size={12} className="text-indigo-600" /> View on map
            </button>
          </div>
        </div>
      </div>

      {/* Notices (from trip.warnings) */}
      {warnings.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-card">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="inline-flex items-center gap-2">
              <div className="font-display font-bold text-[15px] text-slate-900">Notices</div>
              <span className="grid h-5 w-5 place-items-center rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold">
                {warnings.length}
              </span>
            </div>
          </div>
          <div className="border-t border-slate-100 px-4 py-3 space-y-2">
            {warnings.map((w, i) => (
              <p key={i} className="text-[13px] text-amber-800">{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* Day summary cards */}
      <div className="space-y-3">
        {days.map((d) => {
          const { ordered } = buildOrderedPlaces(allPlaces, d.legs ?? [])
          const dayMin = (d.legs ?? []).reduce((s, l) => s + (l.duration_minutes ?? 0), 0)
          // Collect unique transport modes for this day
          const modes = [...new Set(
            (d.legs ?? [])
              .map((l) => (l.transport_mode ?? '').toUpperCase())
              .filter(Boolean)
          )]
          return (
            <button
              key={d.day}
              onClick={() => onJumpDay && onJumpDay(d.day)}
              className="w-full text-left rounded-2xl border border-slate-200 bg-white shadow-card hover:border-indigo-300 hover:shadow-pop transition p-4 group"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-indigo-100 to-fuchsia-100 text-indigo-700 font-display font-bold text-[12px]">
                    D{d.day}
                  </span>
                  <span className="font-display font-bold text-[15px] text-slate-900">
                    Day {d.day}
                    {ordered.length > 0 && (
                      <span className="text-slate-400 font-normal ml-1.5">
                        · {ordered.length} stop{ordered.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Mode-mix dots */}
                  {modes.length > 0 && (
                    <div className="flex items-center gap-1">
                      {modes.map((m) => (
                        <span
                          key={m}
                          title={m}
                          className={`inline-block h-2 w-2 rounded-full ${MODE_COLORS[m] ?? 'bg-slate-400'}`}
                        />
                      ))}
                    </div>
                  )}
                  {dayMin > 0 && (
                    <span className="text-[11.5px] text-slate-500 tabular-nums">
                      {fmtMin(dayMin)}
                    </span>
                  )}
                  <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-600 transition" />
                </div>
              </div>

              {ordered.length === 0 ? (
                <div className="text-[12.5px] text-slate-400 italic">Empty — tap to plan</div>
              ) : (
                <div className="text-[13px] text-slate-600 leading-relaxed">
                  {ordered.map((p, i) => (
                    <span key={p.id}>
                      <span className="text-slate-900 font-medium">{p.name}</span>
                      {i < ordered.length - 1 && (
                        <span className="text-slate-400 mx-1.5">→</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MiniMapSvg({ days, allPlaces }) {
  const allLegs = days.flatMap((d) => d.legs ?? [])
  const { ordered } = buildOrderedPlaces(allPlaces, allLegs)

  if (ordered.length === 0) return null

  const lats = ordered.map((p) => p.lat)
  const lngs = ordered.map((p) => p.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const rangeX = maxLng - minLng || 0.01
  const rangeY = maxLat - minLat || 0.01
  const pad = 60

  const toX = (lng) => pad + ((lng - minLng) / rangeX) * (800 - pad * 2)
  const toY = (lat) => 400 - pad - ((lat - minLat) / rangeY) * (400 - pad * 2)

  const pts = ordered.map((p) => ({ x: toX(p.lng), y: toY(p.lat), name: p.name }))

  return (
    <svg viewBox="0 0 800 400" className="absolute inset-0 w-full h-full" aria-hidden="true">
      {pts.length > 1 && (
        <path
          d={pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
          stroke="hsl(243 75% 59% / .35)"
          strokeWidth="3"
          strokeDasharray="6 6"
          fill="none"
        />
      )}
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="9" fill="white" stroke="hsl(243 75% 59%)" strokeWidth="3" />
          <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="hsl(243 75% 39%)">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  )
}
