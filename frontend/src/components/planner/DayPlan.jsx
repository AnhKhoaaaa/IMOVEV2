import { useState } from 'react'
import { ChevronDown, ChevronRight, CalendarDays } from 'lucide-react'
import RouteCard from './RouteCard'

const SLOT_ORDER = ['morning', 'afternoon', 'evening']
const SLOT_LABELS = {
  morning: '🌅 Buổi sáng',
  afternoon: '☀️ Buổi chiều',
  evening: '🌙 Buổi tối',
}

function groupBySlot(legs) {
  return legs.reduce((acc, leg) => {
    const slot = leg.time_slot ?? 'ungrouped'
    if (!acc[slot]) acc[slot] = []
    acc[slot].push(leg)
    return acc
  }, {})
}

export default function DayPlan({ day, legs, tripId, onLegUpdated }) {
  const [open, setOpen] = useState(true)
  const placeCount = legs.length === 0 ? 0 : legs.length + 1

  const hasSlots = legs.some((leg) => leg.time_slot != null)
  const grouped = hasSlots ? groupBySlot(legs) : null

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100">
            <CalendarDays className="h-4 w-4 text-sky-600" />
          </div>
          <p className="font-semibold text-slate-900 text-sm">
            Ngày {day} — {placeCount} địa điểm
          </p>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100">
          {legs.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Chưa có chặng nào</p>
          ) : hasSlots ? (
            <>
              {SLOT_ORDER.filter((slot) => grouped[slot]?.length > 0).map((slot) => (
                <div key={slot} className="mb-3 last:mb-0">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-3 first:mt-1">
                    {SLOT_LABELS[slot]}
                  </p>
                  {grouped[slot].map((leg) => (
                    <RouteCard
                      key={leg.id ?? `${leg.from_place_id}-${leg.to_place_id}`}
                      leg={leg}
                      tripId={tripId}
                      onUpdated={onLegUpdated}
                    />
                  ))}
                </div>
              ))}
              {grouped['ungrouped']?.length > 0 &&
                grouped['ungrouped'].map((leg) => (
                  <RouteCard
                    key={leg.id ?? `${leg.from_place_id}-${leg.to_place_id}`}
                    leg={leg}
                    tripId={tripId}
                    onUpdated={onLegUpdated}
                  />
                ))}
            </>
          ) : (
            legs.map((leg) => (
              <RouteCard
                key={leg.id ?? `${leg.from_place_id}-${leg.to_place_id}`}
                leg={leg}
                tripId={tripId}
                onUpdated={onLegUpdated}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
