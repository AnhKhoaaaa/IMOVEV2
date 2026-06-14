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

export default function TimePicker({ value = '09:00', onChange, className, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const listRef = useRef(null)

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
          open ? 'border-slate-400' : 'border-slate-200 hover:border-slate-300'
        )}
      >
        <Clock size={14} className="shrink-0 text-slate-400" />
        {value}
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1.5 max-h-56 w-full min-w-[120px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-pop animate-slide-up"
        >
          {SLOTS.map((slot) => {
            const isSel = slot === value
            return (
              <li key={slot} role="option" aria-selected={isSel} data-selected={isSel}>
                <button
                  type="button"
                  onClick={() => { onChange?.(slot); setOpen(false) }}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] tabular-nums transition',
                    isSel ? 'font-bold text-slate-900' : 'font-medium text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {slot}
                  {isSel && <Check size={13} className="text-slate-900" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
