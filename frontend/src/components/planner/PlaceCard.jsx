import { useState } from 'react'
import { MapPin, ChevronDown, RotateCcw, X, Clock, Sun } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Label } from '../ui/label'

function formatOpenHours(openingHours) {
  if (!openingHours) return null
  if (openingHours === '24h') return 'Open 24h'
  // "09:00-12:00 14:00-16:00" → "Open 09:00–12:00, 14:00–16:00"
  return 'Open ' + openingHours.split(' ').map(s => s.replace('-', '–')).join(', ')
}

function ImageStrip({ imageUrl }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 mt-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="relative h-20 rounded-lg overflow-hidden bg-slate-100 border border-slate-200/70">
          {imageUrl && i === 0 ? (
            <img
              src={imageUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200" style={{ zIndex: imageUrl && i === 0 ? -1 : 0 }} />
          <div className="absolute inset-0 opacity-50" style={{
            backgroundImage: 'repeating-linear-gradient(45deg,rgba(15,23,42,0.06) 0 6px,transparent 6px 12px)',
            zIndex: imageUrl && i === 0 ? -1 : 0,
          }} />
          {(!imageUrl || i !== 0) && (
            <div className="absolute bottom-1 left-1.5 text-[9px] font-mono text-slate-500 uppercase tracking-wide">
              photo {i + 1}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default function PlaceCard({ place, index, expanded, onToggle, onDelete, notes, onNotesChange }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const openLabel = formatOpenHours(place.opening_hours)

  const bestTimeLabel = place.best_time_start
    ? `${place.best_time_start}–${place.best_time_end}`
    : null

  // Format suggested visit duration
  const suggestedLabel = place.dwell_minutes
    ? place.dwell_minutes >= 60
      ? `${Math.floor(place.dwell_minutes / 60)}–${Math.ceil(place.dwell_minutes / 60) + 1} hr`
      : `${place.dwell_minutes} min`
    : null

  // Category as "area" label
  const areaLabel = place.category
    ? place.category.charAt(0).toUpperCase() + place.category.slice(1)
    : null

  return (
    <div className="relative pl-12">
      {/* Dashed vertical line */}
      <div className="absolute left-[19px] top-0 bottom-0 w-px border-l border-dashed border-slate-300" />
      {/* Indigo dot with MapPin */}
      <div className="absolute left-[10px] top-3 grid h-[22px] w-[22px] place-items-center rounded-full bg-white border-[3px] border-indigo-600 shadow-card">
        <MapPin size={10} className="text-indigo-600" strokeWidth={3} />
      </div>

      <div className={cn(
        'rounded-2xl border bg-white shadow-card transition',
        expanded ? 'border-indigo-200 ring-2 ring-indigo-100/60' : 'border-slate-200 hover:border-slate-300'
      )}>
        <button onClick={onToggle} className="w-full px-4 pt-4 pb-3 text-left focus-ring rounded-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-bold text-[16px] text-slate-900">
                  <span className="text-slate-400 mr-1.5 tabular-nums">{index}.</span>
                  {place.name}
                </span>
                {place.is_outdoor && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 h-5 text-[11px] font-semibold text-emerald-700">
                    Outdoor
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-[12.5px] text-slate-600 leading-snug">
                {openLabel && <>{openLabel}</>}
                {openLabel && suggestedLabel && <span className="text-slate-300 mx-1">|</span>}
                {suggestedLabel && <>Suggested: {suggestedLabel}</>}
              </div>
            </div>

            <div className="relative shrink-0 flex items-center gap-1">
              {onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o) }}
                  className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100"
                >
                  <span className="font-bold tracking-widest text-[14px] leading-none">···</span>
                </button>
              )}
              {menuOpen && onDelete && (
                <div
                  className="absolute right-0 top-8 z-10 w-44 rounded-lg border border-slate-200 bg-white shadow-pop overflow-hidden animate-slide-up"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => { setMenuOpen(false); onDelete() }}
                    className="w-full text-left px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 inline-flex items-center gap-2"
                  >
                    <X size={12} /> Remove from day
                  </button>
                </div>
              )}
              <ChevronDown size={14} className={cn('text-slate-400 transition', expanded && 'rotate-180')} />
            </div>
          </div>

          <ImageStrip imageUrl={place.image_url} />
        </button>

        {expanded && (
          <div className="border-t border-slate-100 px-4 py-3 bg-slate-50/40 space-y-2 animate-fade-up">
            {bestTimeLabel && (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[11.5px] font-medium text-amber-700">
                <Sun size={11} className="text-amber-500" />
                Best time to visit: {bestTimeLabel}
              </div>
            )}
            <Label className="flex items-center gap-1.5 text-slate-600">Notes</Label>
            <textarea
              value={notes || ''}
              onChange={(e) => onNotesChange && onNotesChange(e.target.value)}
              placeholder="Add notes — book tickets in advance, bring jacket, etc."
              rows={2}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] placeholder:text-slate-400 focus-ring focus:border-indigo-400 resize-none"
            />
            <div className="flex items-center justify-between text-[11.5px] text-slate-500 pt-1">
              {areaLabel && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={11} className="text-slate-400" />
                  {areaLabel}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-indigo-600 font-medium">
                <MapPin size={11} />
                {place.lat?.toFixed(4)}°, {place.lng?.toFixed(4)}°
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
