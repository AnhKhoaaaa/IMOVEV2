import { useState, useEffect, useRef } from 'react'
import { X, Calendar, AlertTriangle, Check, AlarmClock, Building2, Loader2, Wallet } from 'lucide-react'
import { api } from '../../services/api'
import { useT } from '../../contexts/LanguageContext'
import DateRangePicker, { isoToDate, dateToIso } from '../ui/DateRangePicker'
import TimePicker from '../ui/TimePicker'

const STYLE_LABEL_KEY = {
  fastest: 'plnFastest',
  cheapest: 'plnCheapest',
  leisure: 'plnLeastWalking',
  direct: 'plnLeastTransfers',
  user: 'plnUseProfile',
}

const WEIGHT_LABEL_KEY = {
  duration_w: 'plnDimDuration',
  cost_w: 'plnDimCost',
  walking_w: 'plnDimWalking',
  transfers_w: 'plnDimTransfers',
}

function alignStartTimes(times, numDays, fallback = '09:00') {
  const count = Math.max(1, Number(numDays) || 1)
  const source = Array.isArray(times) ? times : []
  return Array.from({ length: count }, (_, index) => source[index] ?? fallback)
}

function normalizeMeta(savedMeta, tripHotel) {
  const startDate = savedMeta?.startDate ?? savedMeta?.start_date ?? ''
  const endDate = savedMeta?.endDate ?? savedMeta?.end_date ?? ''
  const numDays = savedMeta?.numDays ?? savedMeta?.num_days ?? 3
  const fallbackStartTime = savedMeta?.startTime ?? '09:00'
  return {
    name: savedMeta?.name ?? '',
    budget_sgd: savedMeta?.budget_sgd ?? 50,
    origin: savedMeta?.origin ?? '',
    destination: savedMeta?.destination ?? 'Singapore',
    dateMode: startDate ? 'specific' : 'flexible',
    startDate,
    endDate,
    numDays,
    dayStartTimes: alignStartTimes(savedMeta?.dayStartTimes ?? savedMeta?.day_start_times, numDays, fallbackStartTime),
    companion: savedMeta?.companion ?? 'solo',
    styles: savedMeta?.styles ?? [],
    pace: savedMeta?.pace ?? 'moderate',
    startTime: fallbackStartTime,
    travelStyle: savedMeta?.travelStyle ?? savedMeta?.travel_style ?? null,
    routeWeights: savedMeta?.routeWeights ?? savedMeta?.route_weights ?? {},
    hotelName: savedMeta?.hotelName ?? savedMeta?.hotel_name ?? tripHotel?.name ?? '',
    hotelLat: savedMeta?.hotelLat ?? savedMeta?.hotel_lat ?? tripHotel?.lat ?? null,
    hotelLng: savedMeta?.hotelLng ?? savedMeta?.hotel_lng ?? tripHotel?.lng ?? null,
  }
}

export default function TripSetupModal({ open, savedMeta, tripHotel, onClose, onSave }) {
  const { t } = useT()
  const [draft, setDraft] = useState({
    name: '',
    budget_sgd: 50,
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
    dayStartTimes: ['09:00', '09:00', '09:00'],
    travelStyle: null,
    routeWeights: {},
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
      setDraft(normalizeMeta(savedMeta, tripHotel))
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
  const setDayStartTime = (index, val) => {
    setDraft((d) => {
      const dayStartTimes = alignStartTimes(d.dayStartTimes, d.numDays, d.startTime)
      dayStartTimes[index] = val
      return { ...d, dayStartTimes, startTime: index === 0 ? val : d.startTime }
    })
  }

  const handleSave = () => {
    const dayStartTimes = alignStartTimes(draft.dayStartTimes, draft.numDays, draft.startTime)
    const computed = {
      ...draft,
      name: draft.name.trim() || t('tripDefaultName'),
      budget_sgd: Math.max(0, Number(draft.budget_sgd) || 0),
      dateMode: draft.startDate ? 'specific' : 'flexible',
      start_date: draft.startDate || null,
      end_date: draft.endDate || null,
      dayStartTimes,
      startTime: dayStartTimes[0] ?? '09:00',
      travel_style: draft.travelStyle,
      route_weights: draft.routeWeights,
    }
    if (computed.startDate && computed.endDate) {
      const ms = new Date(computed.endDate) - new Date(computed.startDate)
      computed.numDays = Math.max(1, Math.round(ms / 86400000) + 1)
      computed.dayStartTimes = alignStartTimes(dayStartTimes, computed.numDays, computed.startTime)
    }
    onSave(computed)
    onClose()
  }

  const normalizedMeta = normalizeMeta(savedMeta, tripHotel)
  const normalizedDraftTimes = alignStartTimes(draft.dayStartTimes, draft.numDays, draft.startTime)
  const routeSettingsChanged = draft.dateMode !== normalizedMeta.dateMode ||
    draft.startDate !== normalizedMeta.startDate ||
    draft.endDate !== normalizedMeta.endDate ||
    draft.numDays !== normalizedMeta.numDays ||
    normalizedDraftTimes.join('|') !== normalizedMeta.dayStartTimes.join('|') ||
    Number(draft.budget_sgd) !== Number(normalizedMeta.budget_sgd) ||
    draft.hotelName !== normalizedMeta.hotelName ||
    draft.hotelLat !== normalizedMeta.hotelLat ||
    draft.hotelLng !== normalizedMeta.hotelLng
  const routeWeightEntries = Object.entries(draft.routeWeights ?? {}).filter(([key]) => WEIGHT_LABEL_KEY[key])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(560px,calc(100vw-24px))] max-h-[calc(100dvh-40px)] overflow-y-auto rounded-2xl bg-white shadow-pop border border-slate-200 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-500 inline-flex items-center gap-1.5 mb-0.5">
              <span className="grid h-5 w-5 place-items-center rounded-md bg-slate-100">⚙</span>
              {t('tripEditSetup')}
            </div>
            <h2 className="font-display font-bold text-[17px] text-slate-900">{t('tsmTitle')}</h2>
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
            {t('tsmDesc')}
          </p>

          {/* Trip name / budget */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
                {t('plnTripName')}
              </label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder={t('tripDefaultName')}
                className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
                {t('plnBudget')}
              </label>
              <div className="relative">
                <Wallet size={13} className="absolute left-3 top-3 text-slate-400" />
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={draft.budget_sgd}
                  onChange={(e) => set('budget_sgd', e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
                />
              </div>
            </div>
          </div>

          {/* Dates */}
          <div>
            <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5">
              <Calendar size={13} className="text-slate-400" />
              <span>{t('tsmDates')}</span>
            </label>
            <DateRangePicker
              from={isoToDate(draft.startDate)}
              to={isoToDate(draft.endDate)}
              onSelect={(range) => {
                const nextStartDate = dateToIso(range.from)
                const nextEndDate = dateToIso(range.to)
                let nextNumDays = draft.numDays
                if (range.from && range.to) {
                  const ms = range.to - range.from
                  nextNumDays = Math.max(1, Math.round(ms / 86400000) + 1)
                }
                setDraft((d) => ({
                  ...d,
                  startDate: nextStartDate,
                  endDate: nextEndDate,
                  numDays: nextNumDays,
                  dayStartTimes: alignStartTimes(d.dayStartTimes, nextNumDays, d.startTime),
                  dateMode: range.from ? 'specific' : 'flexible',
                }))
              }}
            />
          </div>

          {/* Daily start time */}
          <div>
            <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
              {t('tsmDailyStart')}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {alignStartTimes(draft.dayStartTimes, draft.numDays, draft.startTime).map((time, index) => (
                <div key={index} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                  <AlarmClock size={14} className="shrink-0 text-slate-400" />
                  <span className="w-12 text-[12px] font-semibold text-slate-500">{t('tripDay', index + 1)}</span>
                  <TimePicker
                    value={time}
                    onChange={(val) => setDayStartTime(index, val)}
                    ariaLabel={`${t('tsmDailyStart')} ${t('tripDay', index + 1)}`}
                    className="w-28"
                  />
                </div>
              ))}
            </div>
          </div>

          {draft.travelStyle && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11.5px] font-semibold uppercase tracking-wide text-blue-500">
                  {t('plnTravelStyle')}
                </span>
                <span className="text-[13px] font-bold text-blue-800">
                  {t(STYLE_LABEL_KEY[draft.travelStyle] ?? 'plnFastest')}
                </span>
              </div>
              {routeWeightEntries.length > 0 && (
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {routeWeightEntries.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between rounded-lg bg-white/70 px-2 py-1.5">
                      <span className="text-[11.5px] font-medium text-slate-500">{t(WEIGHT_LABEL_KEY[key])}</span>
                      <span className="text-[12px] font-bold text-slate-800">{Math.round(Number(value) * 100)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Hotel / start location */}
          <div>
            <label className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 block mb-1.5">
              {t('tsmHotel')} <span className="text-slate-400 normal-case font-normal">{t('tsmHotelOptional')}</span>
            </label>
            {draft.hotelLat != null ? (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                <Building2 size={13} className="mt-0.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{draft.hotelName || t('tsmHotel')}</p>
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
                    placeholder={t('tsmHotelPlaceholder')}
                    className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 pr-8 text-[13px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-400"
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
                      className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white btn-lift shadow-sm hover:shadow-md hover:bg-blue-700"
                    >
                      <Check size={10} /> {t('plnUse')}
                    </button>
                  </div>
                )}
                {hotelNotFound && !hotelLoading && (
                  <p className="mt-1 text-[11.5px] text-red-500">{t('plnHotelNotFound')}</p>
                )}
              </>
            )}
          </div>

          {/* Date change warning */}
          {routeSettingsChanged && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[12px] text-amber-800">
                {t('tsmDateWarning')}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-slate-200 text-slate-700 text-[13px] font-semibold hover:bg-slate-50 transition"
          >
            {t('tripCancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="h-9 px-5 rounded-lg bg-blue-600 text-white text-[13px] font-semibold hover:bg-blue-700 btn-lift shadow-sm hover:shadow-md inline-flex items-center gap-1.5"
          >
            <Check size={13} /> {t('tsmSaveChanges')}
          </button>
        </div>
      </div>
    </div>
  )
}
