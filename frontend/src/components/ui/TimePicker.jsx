import { useEffect, useRef, useState } from 'react'
import { Clock, Check } from 'lucide-react'
import { cn } from '../../lib/utils'

// dev28 — styled time picker replacing native <input type="time">. A button shows the
// current time; clicking opens a scrollable listbox of 30-min slots (05:00–23:30).
// Keyboard: Esc closes, the selected slot is scrolled into view on open. Falls back to
// emitting plain 'HH:MM' strings so call sites stay unchanged.

const STEP_MIN = 30
const START_MIN = 5 * 60   // 05:00
const END_MIN = 23 * 60 + 30 // 23:30

const SLOTS = (() => {
  const out = []
  for (let m = START_MIN; m <= END_MIN; m += STEP_MIN) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return out
})()

export default function TimePicker({ value = '09:00', onChange, className, ariaLabel, appearance = 'default' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const isScheduler = appearance === 'scheduler'

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    // scroll the selected slot into view
    const sel = listRef.current?.querySelector('[data-selected="true"]')
    sel?.scrollIntoView({ block: 'center' })
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-lg border bg-white px-3 text-[13px] font-semibold tabular-nums text-slate-900 transition',
          isScheduler
            ? open
              ? 'border-slate-500 bg-slate-50 text-slate-950 shadow-[0_0_0_3px_rgba(15,23,42,0.08)]'
              : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50'
            : open ? 'border-slate-400' : 'border-slate-200 hover:border-slate-300'
        )}
      >
        <Clock size={14} className={cn('shrink-0', isScheduler ? 'text-slate-700' : 'text-slate-400')} />
        {value}
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className={cn(
            'absolute z-50 mt-1.5 max-h-56 w-full min-w-[120px] overflow-y-auto border bg-white py-1 animate-slide-up',
            isScheduler
              ? 'rounded-2xl border-slate-200 p-1.5 shadow-[0_20px_45px_-24px_rgba(15,23,42,0.4)]'
              : 'rounded-lg border-slate-200 shadow-pop',
          )}
        >
          {SLOTS.map((slot) => {
            const isSel = slot === value
            return (
              <li key={slot} role="option" aria-selected={isSel} data-selected={isSel}>
                <button
                  type="button"
                  onClick={() => { onChange?.(slot); setOpen(false) }}
                  className={cn(
                    'relative flex w-full items-center justify-between overflow-hidden px-3 py-1.5 text-left text-[13px] tabular-nums transition',
                    isScheduler && 'rounded-lg',
                    isScheduler
                      ? isSel ? 'font-bold text-white' : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                      : isSel ? 'font-bold text-slate-900' : 'font-medium text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {isScheduler && isSel && <span className="planner-time-selector absolute inset-0 bg-slate-950" />}
                  <span className="relative z-10">{slot}</span>
                  {isSel && <Check size={13} className={cn('relative z-10', isScheduler ? 'text-white' : 'text-slate-900')} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {isScheduler && (
        <style>{`
          @keyframes planner-time-select {
            0% { opacity: 0; transform: scale(0.55); }
            72% { opacity: 1; transform: scale(1.04); }
            100% { opacity: 1; transform: scale(1); }
          }

          .planner-time-selector {
            animation: planner-time-select 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
            box-shadow: 0 8px 18px -10px rgba(15, 23, 42, 0.85);
          }
        `}</style>
      )}
    </div>
  )
}
