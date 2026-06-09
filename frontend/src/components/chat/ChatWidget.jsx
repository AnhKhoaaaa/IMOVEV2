import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageCircle, X, Send, Loader2, Check, Lock } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useT } from '../../contexts/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { useGeolocation } from '../../hooks/useGeolocation'
import { api } from '../../services/api'

function getSessionId() {
  try {
    let sid = localStorage.getItem('session_id')
    if (!sid) {
      sid = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      localStorage.setItem('session_id', sid)
    }
    return sid
  } catch {
    return `sess-${Date.now()}`
  }
}

function tripIdFromPath(pathname) {
  const m = pathname.match(/\/trip\/([^/]+)/)
  return m ? m[1] : null
}

export default function ChatWidget() {
  const { t } = useT()
  const { user } = useAuth()
  const { position } = useGeolocation()
  const location = useLocation()
  const tripId = tripIdFromPath(location.pathname)

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])      // { role: 'user' | 'assistant', text }
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(null)       // { proposed_action, pending_action_id }
  const [applying, setApplying] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: 'assistant', text: t('chatGreeting') }])
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending, loading])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setPending(null)
    setMessages((m) => [...m, { role: 'user', text }])
    setLoading(true)
    try {
      const res = await api.sendChat({
        session_id: getSessionId(),
        message: text,
        trip_id: tripId,
        gps: position,
      })
      setMessages((m) => [...m, { role: 'assistant', text: res.reply }])
      if (res.proposed_action && res.pending_action_id) {
        setPending({ proposed_action: res.proposed_action, pending_action_id: res.pending_action_id })
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: e.message || t('chatError') }])
    } finally {
      setLoading(false)
    }
  }

  const confirm = async (accept) => {
    if (!pending || applying) return
    if (!accept) {
      // Discard server-side, then clear locally
      try {
        await api.confirmChatAction({
          session_id: getSessionId(),
          pending_action_id: pending.pending_action_id,
          confirm: false,
        })
      } catch { /* ignore */ }
      setPending(null)
      return
    }
    setApplying(true)
    try {
      const res = await api.confirmChatAction({
        session_id: getSessionId(),
        pending_action_id: pending.pending_action_id,
        confirm: true,
      })
      setMessages((m) => [...m, { role: 'assistant', text: res.reply }])
      if (res.executed && res.trip) {
        window.dispatchEvent(new CustomEvent('imove:trip-updated', { detail: res.trip }))
      }
      setPending(null)
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: e.message || t('chatError') }])
    } finally {
      setApplying(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // Guest users see a locked FAB — clicking shows a small login prompt panel
  if (!user) {
    return open ? (
      <div className="fixed bottom-5 right-5 z-50 flex w-[min(92vw,320px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <MessageCircle className="h-4 w-4" /> {t('chatTitle')}
          </span>
          <button onClick={() => setOpen(false)} aria-label={t('chatClose')} className="grid h-7 w-7 place-items-center rounded-md text-white/70 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <Lock className="h-8 w-8 text-slate-400" />
          <p className="text-sm font-medium text-slate-700">{t('chatLoginRequired')}</p>
          <p className="text-xs text-slate-500">{t('chatLoginHint')}</p>
        </div>
      </div>
    ) : (
      <button
        onClick={() => setOpen(true)}
        aria-label={t('chatOpen')}
        className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-slate-400 text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <Lock className="h-5 w-5" />
      </button>
    )
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={t('chatOpen')}
        className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-slate-900 text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <MessageCircle className="h-4 w-4" /> {t('chatTitle')}
        </span>
        <button
          onClick={() => setOpen(false)}
          aria-label={t('chatClose')}
          className="grid h-7 w-7 place-items-center rounded-md text-white/70 transition-colors hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex max-h-[52vh] min-h-[220px] flex-col gap-2 overflow-y-auto p-3 scroll-thin">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed',
              msg.role === 'user'
                ? 'self-end bg-slate-900 text-white'
                : 'self-start bg-slate-100 text-slate-800'
            )}
          >
            {msg.text}
          </div>
        ))}

        {loading && (
          <div className="self-start inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('chatThinking')}
          </div>
        )}

        {/* Proposed action card */}
        {pending && (
          <div className="self-start w-full rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">
              {t('chatProposalLabel')}
            </p>
            <p className="mt-1 text-sm text-amber-900">{pending.proposed_action.preview}</p>
            <div className="mt-2.5 flex gap-2">
              <button
                onClick={() => confirm(true)}
                disabled={applying}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
              >
                {applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {applying ? t('chatApplying') : t('chatConfirm')}
              </button>
              <button
                onClick={() => confirm(false)}
                disabled={applying}
                className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60"
              >
                {t('chatCancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-slate-200 p-2.5">
        <textarea
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chatPlaceholder')}
          className="max-h-28 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          aria-label={t('chatSend')}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-900 text-white transition-colors hover:bg-slate-700 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
