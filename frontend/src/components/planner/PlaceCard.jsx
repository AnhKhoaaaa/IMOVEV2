import { MapPin, ChevronDown, Clock, Sun } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Label } from '../ui/label'

const CATEGORY_COLORS = {
  food:          'bg-orange-50 text-orange-700 border-orange-200',
  dining:        'bg-orange-50 text-orange-700 border-orange-200',
  nature:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  park:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  culture:       'bg-violet-50 text-violet-700 border-violet-200',
  heritage:      'bg-violet-50 text-violet-700 border-violet-200',
  museum:        'bg-violet-50 text-violet-700 border-violet-200',
  shopping:      'bg-blue-50 text-blue-700 border-blue-200',
  landmark:      'bg-indigo-50 text-indigo-700 border-indigo-200',
  attraction:    'bg-indigo-50 text-indigo-700 border-indigo-200',
  entertainment: 'bg-rose-50 text-rose-700 border-rose-200',
  beach:         'bg-teal-50 text-teal-700 border-teal-200',
}

function formatOpenHours(openingHours) {
  if (!openingHours) return null
  if (openingHours === '24h') return 'Open 24h'
  return 'Open ' + openingHours.split(' ').map(s => s.replace('-', '–')).join(', ')
}

export default function PlaceCard({ place, index, expanded, onToggle, notes, onNotesChange }) {
  const openLabel = formatOpenHours(place.opening_hours)

  const bestTimeLabel = place.best_time_start
    ? `${place.best_time_start}–${place.best_time_end}`
    : null

  const suggestedLabel = place.dwell_minutes
    ? place.dwell_minutes >= 60
      ? `${Math.floor(place.dwell_minutes / 60)}h ${place.dwell_minutes % 60 > 0 ? `${place.dwell_minutes % 60}m` : ''}`.trim()
      : `${place.dwell_minutes} min`
    : null

  const categoryKey = place.category?.toLowerCase()
  const categoryLabel = place.category
    ? place.category.charAt(0).toUpperCase() + place.category.slice(1)
    : null
  const categoryColor = CATEGORY_COLORS[categoryKey] ?? 'bg-slate-50 text-slate-600 border-slate-200'

  return (
    <div className="relative pl-12">
      {/* Timeline connector */}
      <div className="absolute left-[19px] top-0 bottom-0 w-px border-l border-dashed border-slate-300" />
      <div className="absolute left-[10px] top-3.5 grid h-[22px] w-[22px] place-items-center rounded-full bg-white border-[3px] border-indigo-600 shadow-card">
        <MapPin size={10} className="text-indigo-600" strokeWidth={3} />
      </div>

      <div className={cn(
        'rounded-2xl border bg-white shadow-card overflow-hidden transition',
        expanded ? 'border-indigo-200 ring-2 ring-indigo-100/60' : 'border-slate-200 hover:border-slate-300'
      )}>
        {/* Horizontal card header */}
        <button onClick={onToggle} className="w-full text-left focus-ring">
          <div className="flex min-h-[88px]">
            {/* Photo */}
            <div className="relative w-[108px] shrink-0 bg-slate-100">
              {place.image_url ? (
                <img
                  src={place.image_url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-200 via-slate-100 to-slate-200">
                  <div className="absolute inset-0 opacity-40" style={{
                    backgroundImage: 'repeating-linear-gradient(45deg,rgba(15,23,42,0.07) 0 5px,transparent 5px 10px)',
                  }} />
                </div>
              )}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0 px-3.5 py-3 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display font-bold text-[15px] text-slate-900 leading-tight">
                    <span className="text-slate-400 mr-1 tabular-nums text-[13px]">{index}.</span>
                    {place.name}
                  </p>
                  <ChevronDown size={14} className={cn('text-slate-400 transition shrink-0 mt-0.5', expanded && 'rotate-180')} />
                </div>

                {/* Badges */}
                <div className="flex flex-wrap items-center gap-1 mt-1.5">
                  {categoryLabel && (
                    <span className={cn('inline-flex items-center rounded-full border px-2 h-5 text-[10.5px] font-semibold', categoryColor)}>
                      {categoryLabel}
                    </span>
                  )}
                  {place.is_outdoor && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 border border-emerald-200 px-2 h-5 text-[10.5px] font-semibold text-emerald-700">
                      <Sun size={9} className="text-emerald-500" /> Outdoor
                    </span>
                  )}
                </div>
              </div>

              {/* Time info */}
              <div className="mt-1.5 space-y-0.5">
                {suggestedLabel && (
                  <div className="flex items-center gap-1.5 text-[12px] text-slate-600">
                    <Clock size={11} className="text-slate-400 shrink-0" />
                    {suggestedLabel}
                  </div>
                )}
                {openLabel && (
                  <p className="text-[11.5px] text-slate-500 truncate">{openLabel}</p>
                )}
              </div>
            </div>
          </div>
        </button>

        {/* Expanded section */}
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
              {categoryLabel && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={11} className="text-slate-400" />
                  {categoryLabel}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-indigo-600 font-medium ml-auto">
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
