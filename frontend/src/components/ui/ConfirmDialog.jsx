import { useEffect, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useT } from '../../contexts/LanguageContext'

// dev28 — styled confirmation modal replacing window.confirm() for destructive actions
// (trip deletion in Home + Trip). Backdrop click / Esc / Cancel all dismiss; the Cancel
// button takes initial focus so Enter never fires the destructive action by accident.
// `tone="danger"` (default) renders the confirm button red.

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  onConfirm,
  onCancel,
}) {
  const { t } = useT()
  const cancelRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.() }
    document.addEventListener('keydown', onKey)
    cancelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.() }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-[min(420px,calc(100vw-32px))] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop animate-slide-up"
      >
        <div className="flex items-start gap-3">
          <div className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-full',
            tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'
          )}>
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="font-display text-[17px] font-extrabold text-slate-950">
              {title ?? t('confirmDeleteTitle')}
            </h2>
            {message && <p className="mt-1.5 text-[13.5px] leading-6 text-slate-500">{message}</p>}
          </div>
          <button
            onClick={onCancel}
            aria-label={cancelLabel ?? t('cancelBtn')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 flex justify-end gap-2.5">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="h-10 rounded-lg border border-slate-200 px-4 text-[13px] font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
          >
            {cancelLabel ?? t('cancelBtn')}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'h-10 rounded-lg px-4 text-[13px] font-bold text-white transition active:scale-[0.98]',
              tone === 'danger' ? 'bg-red-600 hover:bg-red-500' : 'bg-slate-900 hover:bg-slate-700'
            )}
          >
            {confirmLabel ?? t('confirmDeleteBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
