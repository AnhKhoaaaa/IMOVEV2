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

export default function DateRangePicker({ from, to, onSelect, className, numberOfMonths = 1, appearance = 'default' }) {
  const { t, lang } = useT()
  const selected = useMemo(() => ({ from: from ?? undefined, to: to ?? undefined }), [from, to])
  const isScheduler = appearance === 'scheduler'

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
    <div className={cn(
      'bg-white',
      isScheduler
        ? 'rounded-2xl border border-slate-200 shadow-[0_18px_42px_-30px_rgba(15,23,42,0.38)]'
        : 'rounded-xl border border-slate-200',
      className,
    )}>
      <div className={cn(
        'flex items-center justify-between gap-3 px-3.5 py-2.5',
        isScheduler ? 'border-b border-slate-100 bg-slate-50/70' : 'border-b border-slate-100',
      )}>
        <span className={cn('text-[13px] font-bold', from ? 'text-slate-900' : 'text-slate-400')}>
          {readout}
        </span>
        <span className={cn(
          'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold tabular-nums text-white',
          isScheduler ? 'bg-slate-950 shadow-[0_6px_14px_-8px_rgba(15,23,42,0.85)]' : 'bg-slate-900',
        )}>
          {count ? t('drpDayCount', count) : '—'}
        </span>
      </div>
      <div className={cn('imove-rdp px-2 py-2', isScheduler && 'planner-scheduler-rdp')}>
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
      {isScheduler && (
        <style>{`
          @keyframes planner-scheduler-select {
            0% { opacity: 0.35; transform: scale(0.55); }
            72% { opacity: 1; transform: scale(1.08); }
            100% { opacity: 1; transform: scale(1); }
          }

          .planner-scheduler-rdp {
            --rdp-accent-color: #0f172a;
            --rdp-accent-background-color: transparent;
            --rdp-range_start-background: transparent;
            --rdp-range_end-background: transparent;
            --rdp-range_middle-background-color: transparent;
            --rdp-range_middle-color: #0f172a;
          }

          .planner-scheduler-rdp .rdp-day_button {
            transition: color 180ms ease, background-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
          }

          .planner-scheduler-rdp .rdp-day_button:hover {
            background: #f1f5f9;
            color: #0f172a;
            transform: translateY(-1px);
          }

          .planner-scheduler-rdp .rdp-selected .rdp-day_button {
            animation: planner-scheduler-select 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
            background: #ffffff;
            color: #0f172a;
            border: 1.5px solid #0f172a;
            box-shadow: 0 8px 18px -12px rgba(15, 23, 42, 0.45);
          }

          .planner-scheduler-rdp .rdp-range_start .rdp-day_button,
          .planner-scheduler-rdp .rdp-range_end .rdp-day_button {
            background: #ffffff;
            color: #0f172a;
            border: 1.5px solid #0f172a;
            border-radius: 999px;
          }

          .planner-scheduler-rdp .rdp-range_middle .rdp-day_button {
            background: #ffffff;
            color: #0f172a;
            border: 1.5px solid #0f172a;
            border-radius: 7px;
          }

          .planner-scheduler-rdp .rdp-selected .rdp-day_button:hover,
          .planner-scheduler-rdp .rdp-range_start .rdp-day_button:hover,
          .planner-scheduler-rdp .rdp-range_end .rdp-day_button:hover,
          .planner-scheduler-rdp .rdp-range_middle .rdp-day_button:hover {
            background: #f8fafc;
            color: #0f172a;
          }

          .planner-scheduler-rdp .rdp-today:not(.rdp-selected) .rdp-day_button {
            box-shadow: inset 0 0 0 1.5px #94a3b8;
            color: #0f172a;
          }

          .planner-scheduler-rdp .rdp-chevron {
            fill: #0f172a;
          }

          .planner-scheduler-rdp .rdp-button_previous,
          .planner-scheduler-rdp .rdp-button_next {
            transition: background-color 180ms ease, transform 180ms ease;
          }

          .planner-scheduler-rdp .rdp-button_previous:hover,
          .planner-scheduler-rdp .rdp-button_next:hover {
            background: #f1f5f9;
            transform: scale(1.08);
          }
        `}</style>
      )}
    </div>
  )
}
