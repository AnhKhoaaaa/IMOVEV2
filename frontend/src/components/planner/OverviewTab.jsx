import { useMemo } from 'react'
import { MapPin, Plus, X, ChevronRight } from 'lucide-react'
import { buildOrderedPlaces } from '../../lib/tripUtils'

export default function OverviewTab({ trip, savedMeta, onJumpDay }) {
  const days = trip?.days ?? []
  const allPlaces = trip?.places ?? []
  const warnings = trip?.warnings ?? []

  return (
    <div className="space-y-5 animate-fade-up">
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
                      <span className="text-slate-400 font-normal ml-1.5">· {ordered.length} stop{ordered.length !== 1 ? 's' : ''}</span>
                    )}
                  </span>
                </div>
                <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-600 transition" />
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

  // Map real coords to SVG space (800×400 viewBox)
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
