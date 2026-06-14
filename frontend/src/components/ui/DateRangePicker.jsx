import { useMemo } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { CalendarDays } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useT } from '../../contexts/LanguageContext'

// dev28 — shared range date picker (react-day-picker v9). Replaces the native
// <input type="date"> pairs in TripSetupModal + Planner. Past days are disabled,
// today is marked, and a live "N days · 14–16 Jun" readout sits above the calendar.
// Colours use the neutral chrome tokens (palette undecided) — see `.imove-rdp` in index.css.

const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

// 'YYYY-MM-DD' <-> Date (local, no timezone drift)
export function isoToDate(iso) {
  if (!iso) return undefined
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

export function dateToIso(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function daysBetweenInclusive(from, to) {
  if (!from || !to) return 0
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1
}

export default function DateRangePicker({ from, to, onSelect, className, numberOfMonths = 1 }) {
  const { t, lang } = useT()
  const selected = useMemo(() => ({ from: from ?? undefined, to: to ?? undefined }), [from, to])

  const locale = lang === 'vi' ? 'vi-VN' : 'en-GB'
  const fmt = (d) => d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  const count = daysBetweenInclusive(from, to)

  let readout
  if (from && to) {
    readout = `${fmt(from)} – ${fmt(to)} ${to.getFullYear()}`
  } else if (from) {
    readout = `${fmt(from)} → ${t('drpPickEnd')}`
  } else {
    readout = t('drpNoDates')
  }

  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-2.5">
        <span className={cn('text-[13px] font-bold', from ? 'text-slate-900' : 'text-slate-400')}>
          {readout}
        </span>
        <span className="shrink-0 rounded-full bg-slate-900 px-2.5 py-1 text-[12px] font-bold tabular-nums text-white">
          {count ? t('drpDayCount', count) : '—'}
        </span>
      </div>
      <div className="imove-rdp px-2 py-2">
        <DayPicker
          mode="range"
          selected={selected}
          onSelect={(range) => onSelect?.(range ?? { from: undefined, to: undefined })}
          disabled={{ before: startOfToday() }}
          numberOfMonths={numberOfMonths}
          showOutsideDays
          weekStartsOn={1}
        />
      </div>
    </div>
  )
}
