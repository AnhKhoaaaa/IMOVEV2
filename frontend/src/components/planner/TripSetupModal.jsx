import { useState, useEffect, useRef } from 'react'
import { X, Calendar, Clock, AlertTriangle, Check, AlarmClock, Building2, Loader2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { api } from '../../services/api'

const COMPANIONS = [
  { id: 'solo',     emoji: '🚶',    label: 'Solo' },
  { id: 'couple',   emoji: '💑',    label: 'Couple' },
  { id: 'family',   emoji: '👨‍👩‍👧‍👦', label: 'Family' },
  { id: 'friends',  emoji: '👬',    label: 'Friends' },
  { id: 'elderly',  emoji: '👵',    label: 'Elderly' },
]

const STYLES = [
  { id: 'nature',    emoji: '🌿', label: 'Nature' },
  { id: 'food',      emoji: '🍜', label: 'Food' },
  { id: 'heritage',  emoji: '🏛️', label: 'Heritage' },
  { id: 'shopping',  emoji: '🛍️', label: 'Shopping' },
  { id: 'nightlife', emoji: '🌃', label: 'Nightlife' },
]

const PACES = [
  { id: 'ambitious', emoji: '📅', label: 'Ambitious' },
  { id: 'moderate',  emoji: '⚖️', label: 'Moderate' },
  { id: 'relaxed',   emoji: '🌴', label: 'Relaxed' },
]

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-[12.5px] font-medium transition whitespace-nowrap',
        active
          ? 'border-indigo-300 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      )}
    >
      {children}
    </button>
  )
}

export default function TripSetupModal({ open, savedMeta, tripHotel, onClose, onSave }) {
  const [draft, setDraft] = useState({
    origin: '',
    destination: 'Singapore',
    dateMode: 'flexible',
    startDate: '',
    endDate: '',
    numDays: 3,
    companion: 'solo',
    styles: [],
    pace: 'moderate',
    startTime: '09:00',
    hotelName: '',
    hotelLat: null,
    hotelLng: null,
  })
  const [hotelQuery, setHotelQuery] = useState('')
  const [hotelResult, setHotelResult] = useState(null)
  const [hotelLoading, setHotelLoading] = useState(false)
  const [hotelNotFound, setHotelNotFound] = useState(false)
  const hotelTimerRef = useRef(null)

  useEffect(() => {
    if (open) {
      const hotelName = savedMeta?.hotelName ?? tripHotel?.name ?? ''
      const hotelLat = savedMeta?.hotelLat ?? tripHotel?.lat ?? null
      const hotelLng = savedMeta?.hotelLng ?? tripHotel?.lng ?? null
      setDraft({
        origin: savedMeta?.origin ?? '',
        destination: savedMeta?.destination ?? 'Singapore',
        dateMode: savedMeta?.startDate ? 'specific' : 'flexible',
        startDate: savedMeta?.startDate ?? '',
        endDate: savedMeta?.endDate ?? '',
        numDays: savedMeta?.numDays ?? 3,
        companion: savedMeta?.companion ?? 'solo',
        styles: savedMeta?.styles ?? [],
        pace: savedMeta?.pace ?? 'moderate',
        startTime: savedMeta?.startTime ?? '09:00',
        hotelName,
        hotelLat,
        hotelLng,
      })
      setHotelQuery('')
      setHotelResult(null)
      setHotelNotFound(false)
    }
  }, [open, savedMeta, tripHotel])

  useEffect(() => {
    if (hotelTimerRef.current) clearTimeout(hotelTimerRef.current)
    if (!hotelQuery.trim() || draft.hotelLat != null) {
      setHotelResult(null)
      setHotelNotFound(false)
      setHotelLoading(false)
      return
    }
    setHotelLoading(true)
    setHotelResult(null)
    setHotelNotFound(false)
    hotelTimerRef.current = setTimeout(async () => {
      try {
        const result = await api.geocodeHotel(hotelQuery.trim())
        setHotelResult(result)
      } catch {
        setHotelNotFound(true)
      } finally {
        setHotelLoading(false)
      }
    }, 400)
    return () => clearTimeout(hotelTimerRef.current)
  }, [hotelQuery, draft.hotelLat])

  if (!open) return null

  const set = (key, val) => setDraft((d) => ({ ...d, [key]: val }))

  const toggleStyle = (id) =>
    set('styles', draft.styles.includes(id)
      ? draft.styles.filter((s) => s !== id)
      : [...draft.styles, id])

  const handleSave = () => {
    const computed = { ...draft }
    if (computed.dateMode === 'specific' && computed.startDate && computed.endDate) {
      const ms = new Date(computed.endDate) - new Date(computed.startDate)
      computed.numDays = Math.max(1, Math.round(ms / 86400000) + 1)
    }
    onSave(computed)
    onClose()
  }

  const datesChanged = draft.dateMode !== (savedMeta?.startDate ? 'specific' : 'flexible') ||
    draft.startDate !== (savedMeta?.startDate ?? '') ||
    draft.numDays !== (savedMeta?.numDays ?? 3)

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(560px,calc(100vw-24px))] max-h-[calc(100vh-40px)] overflow-y-auto rounded-2xl bg-white shadow-pop border border-slate-200 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 inline-flex items-center gap-1.5 mb-0.5">
              <span className="grid h-5 w-5 place-items-center rounded-md bg-slate-100">⚙</span>
              Edit setup
            </div>
            <h2 className="font-display font-bold text-[17px] text-slate-900">Trip preferences</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          <p className="text-[12.5px] text-slate-500">
            Adjust dates and travel preferences. Existing days stay in place.
          </p>

          {/* Origin / Destination */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
                Origin
              </label>
              <input
                type="text"
                value={draft.origin}
                onChange={(e) => set('origin', e.target.value)}
                placeholder="Ho Chi Minh City"
                className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
              />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
                Destination
              </label>
              <input
                type="text"
                value={draft.destination}
                onChange={(e) => set('destination', e.target.value)}
                placeholder="Singapore"
                className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          {/* Dates */}
          <div>
            <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-2">
              Dates
            </label>
            <div className="flex rounded-xl border border-slate-200 p-1 bg-slate-50 gap-1 mb-3">
              {[
                { id: 'specific', label: 'Specific dates',    icon: <Calendar size={12} /> },
                { id: 'flexible', label: 'Flexible duration', icon: <Clock size={12} /> },
              ].map(({ id, label, icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => set('dateMode', id)}
                  className={cn(
                    'flex-1 h-8 rounded-lg text-[12.5px] font-medium transition inline-flex items-center justify-center gap-1.5',
                    draft.dateMode === id
                      ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {draft.dateMode === 'specific' ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11.5px] text-slate-500 block mb-1">Start</label>
                  <input
                    type="date"
                    value={draft.startDate}
                    onChange={(e) => set('startDate', e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div>
                  <label className="text-[11.5px] text-slate-500 block mb-1">End</label>
                  <input
                    type="date"
                    value={draft.endDate}
                    onChange={(e) => set('endDate', e.target.value)}
                    className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] focus:outline-none focus:border-indigo-400"
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-slate-700">Duration</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => set('numDays', Math.max(1, draft.numDays - 1))}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition font-bold"
                  >−</button>
                  <div className="h-9 w-16 rounded-lg border border-slate-200 bg-slate-50/40 grid place-items-center">
                    <span className="font-display font-bold text-[18px] text-slate-900 tabular-nums">{draft.numDays}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => set('numDays', Math.min(30, draft.numDays + 1))}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition font-bold"
                  >+</button>
                  <span className="text-[12px] text-slate-500">days</span>
                </div>
              </div>
            )}
          </div>

          {/* Daily start time */}
          <div>
            <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
              Daily start time
            </label>
            <div className="flex items-center gap-2">
              <AlarmClock size={14} className="text-slate-400" />
              <input
                type="time"
                value={draft.startTime}
                onChange={(e) => set('startTime', e.target.value)}
                className="flex h-9 w-36 rounded-lg border border-slate-200 bg-white px-3 text-[13px] focus:outline-none focus:border-indigo-400"
              />
              <span className="text-[12px] text-slate-400">each day</span>
            </div>
          </div>

          {/* Hotel / start location */}
          <div>
            <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
              Hotel <span className="text-slate-400 normal-case font-normal">(optional — daily start origin)</span>
            </label>
            {draft.hotelLat != null ? (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <Building2 size={13} className="mt-0.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{draft.hotelName || 'Hotel'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { set('hotelName', ''); set('hotelLat', null); set('hotelLng', null); setHotelQuery('') }}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-slate-400 hover:text-red-500"
                >
                  <X size={11} />
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <input
                    value={hotelQuery}
                    onChange={(e) => setHotelQuery(e.target.value)}
                    placeholder="e.g. Marina Bay Sands"
                    className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 pr-8 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400"
                  />
                  {hotelLoading && (
                    <Loader2 size={13} className="absolute right-2.5 top-3 animate-spin text-slate-400" />
                  )}
                </div>
                {hotelResult && !hotelLoading && (
                  <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="min-w-0 truncate text-[12px] text-slate-600">{hotelResult.address}</p>
                    <button
                      type="button"
                      onClick={() => {
                        set('hotelName', hotelQuery.trim())
                        set('hotelLat', hotelResult.lat)
                        set('hotelLng', hotelResult.lng)
                        setHotelResult(null)
                        setHotelQuery('')
                      }}
                      className="flex shrink-0 items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500"
                    >
                      <Check size={10} /> Use
                    </button>
                  </div>
                )}
                {hotelNotFound && !hotelLoading && (
                  <p className="mt-1 text-[11.5px] text-red-500">No location found. Try a more specific name.</p>
                )}
              </>
            )}
          </div>

          {/* Date change warning */}
          {datesChanged && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[12px] text-amber-800">
                Changing dates or styles will re-run route planning. Existing places are kept; legs will be recalculated.
              </p>
            </div>
          )}

          {/* Companions */}
          <div>
            <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-2">
              Travel companions
            </label>
            <div className="flex flex-wrap gap-2">
              {COMPANIONS.map(({ id, emoji, label }) => (
                <Chip key={id} active={draft.companion === id} onClick={() => set('companion', id)}>
                  <span className="text-[14px] leading-none">{emoji}</span>
                  <span>{label}</span>
                </Chip>
              ))}
            </div>
          </div>

          {/* Travel style */}
          <div>
            <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-2">
              Travel style
            </label>
            <div className="flex flex-wrap gap-2">
              {STYLES.map(({ id, emoji, label }) => (
                <Chip key={id} active={draft.styles.includes(id)} onClick={() => toggleStyle(id)}>
                  <span className="text-[14px] leading-none">{emoji}</span>
                  <span>{label}</span>
                </Chip>
              ))}
            </div>
          </div>

          {/* Pace */}
          <div>
            <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-2">
              Travel pace
            </label>
            <div className="flex gap-2">
              {PACES.map(({ id, emoji, label }) => (
                <Chip key={id} active={draft.pace === id} onClick={() => set('pace', id)}>
                  <span className="text-[14px] leading-none">{emoji}</span>
                  <span>{label}</span>
                </Chip>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-slate-200 text-slate-700 text-[13px] font-semibold hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="h-9 px-5 rounded-lg bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 transition inline-flex items-center gap-1.5"
          >
            <Check size={13} /> Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
