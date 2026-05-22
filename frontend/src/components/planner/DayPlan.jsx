import { useState, Fragment } from 'react'
import { MapPin, RotateCcw } from 'lucide-react'
import { buildTimeline } from '../../lib/tripUtils'
import PlaceCard from './PlaceCard'
import TransitSegment from './TransitSegment'

function formatDayLabel(legs) {
  const placeCount = legs.length > 0 ? legs.length + 1 : 0
  if (placeCount === 0) return 'No stops yet'
  const cost = legs.reduce((s, l) => s + (l.cost_sgd ?? 0), 0)
  return `${placeCount} stop${placeCount !== 1 ? 's' : ''}${cost > 0 ? ` · S$${cost.toFixed(2)}` : ''}`
}

export default function DayPlan({ day, legs, tripId, onLegUpdated, placesById = {} }) {
  const [expanded, setExpanded] = useState({ place: null })
  const [notes, setNotes] = useState({})
  const [dayNotes, setDayNotes] = useState('')

  const timeline = buildTimeline(legs ?? [], placesById)
  const dayLabel = formatDayLabel(legs ?? [])

  const togglePlace = (id) =>
    setExpanded((e) => ({ place: e.place === id ? null : id }))

  return (
    <div className="space-y-1 animate-fade-up">
      {/* Section header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-baseline gap-2">
          <h2 className="font-display font-extrabold text-[20px] text-slate-900">Day {day}</h2>
          <span className="text-slate-300">·</span>
          <span className="text-[14px] text-slate-600">{dayLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 h-8 text-[12.5px] font-medium text-slate-700 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50/40 transition shadow-card">
            <RotateCcw size={12} /> Optimize route
          </button>
        </div>
      </div>

      {/* Empty state */}
      {timeline.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/40 p-10 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400 mb-2">
            <MapPin size={20} />
          </div>
          <div className="font-display font-bold text-[15px] text-slate-700">No places yet</div>
          <div className="text-[12.5px] text-slate-500 mt-1">
            Go back and add places to your itinerary.
          </div>
        </div>
      )}

      {/* Timeline */}
      {timeline.map((item, i) => (
        <Fragment key={`${item.type}-${i}`}>
          {item.type === 'place' ? (
            <PlaceCard
              place={item.data}
              index={item.index}
              expanded={expanded.place === item.data.id}
              onToggle={() => togglePlace(item.data.id)}
              notes={notes[item.data.id]}
              onNotesChange={(v) => setNotes((n) => ({ ...n, [item.data.id]: v }))}
            />
          ) : (
            <TransitSegment
              leg={item.data}
              tripId={tripId}
              onUpdated={onLegUpdated}
            />
          )}
        </Fragment>
      ))}

      {/* Day notes (only if there are places) */}
      {timeline.length > 0 && (
        <div className="relative pl-12 mt-5">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-4">
            <label className="text-[12.5px] font-semibold text-slate-600 block mb-2">Day notes</label>
            <textarea
              rows={2}
              value={dayNotes}
              onChange={(e) => setDayNotes(e.target.value)}
              placeholder="Pack a light jacket, ATM stops, dinner reservation at 8pm…"
              className="w-full rounded-md border border-slate-200 bg-slate-50/30 px-3 py-2 text-[13px] placeholder:text-slate-400 focus-ring focus:border-indigo-400 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  )
}
