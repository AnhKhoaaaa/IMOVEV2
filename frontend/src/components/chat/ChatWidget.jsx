import { useState, useRef, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  MessageCircle, X, Send, Loader2, Check, Lock, Bot, Sparkles,
  ShieldCheck, AlertTriangle,
} from 'lucide-react'
import { cn } from '../../lib/utils'
import { useT } from '../../contexts/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { useGeolocation } from '../../hooks/useGeolocation'
import { useAlerts } from '../../hooks/useAlerts'
import { useLiveCompanion } from '../../hooks/useLiveCompanion'
import AlertActionCard from '../adaptation/AlertActionCard'
import ChatBlocks from './ChatBlocks'
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

const CHAT_UI = {
  en: {
    quickTitle: 'Try asking',
    alertLabel: 'Trip alert',
    companionLabel: 'Live companion',
    confirmHint: 'IMOVE will not update the itinerary until you confirm.',
    tripPlaceholder: 'Ask or request a safe itinerary change...',
    quickActions: [
      'What should I do if it rains?',
      'Compare MRT and Grab for the next leg',
      'Find food near my current stop',
      'Optimize Day 2 without rushing',
    ],
  },
  vi: {
    quickTitle: 'Thử hỏi nhanh',
    alertLabel: 'Cảnh báo chuyến đi',
    companionLabel: 'Bạn đồng hành trực tiếp',
    confirmHint: 'IMOVE sẽ không cập nhật lịch trình cho đến khi bạn xác nhận.',
    tripPlaceholder: 'Hỏi hoặc yêu cầu đổi lịch trình an toàn...',
    quickActions: [
      'Nếu trời mưa thì đổi lịch thế nào?',
      'So sánh MRT và Grab cho chặng tiếp theo',
      'Tìm món ăn gần điểm hiện tại',
      'Tối ưu Ngày 2 nhưng đừng quá gấp',
    ],
  },
}

export default function ChatWidget() {
  const { t, lang } = useT()
  const { user } = useAuth()
  const { position } = useGeolocation()
  const location = useLocation()
  const tripId = tripIdFromPath(location.pathname)
  const ui = CHAT_UI[lang] ?? CHAT_UI.en

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])      // { role: 'user' | 'assistant', text }
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(null)       // { proposed_action, pending_action_id }
  const [applying, setApplying] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // dev25 P1 — proactive companion: surface live trip alerts as friendly chat messages.
  // Guests pass null (no subscription); 'chat' suffix keeps a topic distinct from the Trip page.
  const { alerts } = useAlerts(user ? tripId : null, 'chat')
  const surfacedRef = useRef(new Set())              // alert ids already posted
  const [unread, setUnread] = useState(0)
  const [resolvedAlerts, setResolvedAlerts] = useState(new Set())  // alert ids dismissed/applied in chat

  useEffect(() => {
    surfacedRef.current.clear()
    setMessages(open && user ? [{ role: 'assistant', text: t('chatGreeting') }] : [])
    setPending(null)
    setInput('')
    setUnread(0)
    setResolvedAlerts(new Set())
  }, [user?.id, tripId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      setUnread(0)
      if (messages.length === 0) setMessages([{ role: 'assistant', text: t('chatGreeting') }])
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, pending, loading])

  // Phrase each NEW alert via the backend and post it as an assistant bubble.
  useEffect(() => {
    if (!user || !tripId || alerts.length === 0) return
    const fresh = alerts.filter((a) => !surfacedRef.current.has(a.id))
    if (fresh.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const a of fresh) {
        surfacedRef.current.add(a.id)   // mark before await so re-renders don't double-post
        try {
          const pm = await api.phraseAlert({
            alert: { id: a.id, alert_type: a.alert_type, message: a.message, day_number: a.day_number },
            lang,
          })
          if (cancelled) return
          // Keep the full alert so the interactive resolver card can render under the bubble.
          setMessages((m) => [...m, { role: 'assistant', text: pm.text, alertId: a.id, alert: a }])
          setUnread((u) => u + 1)
        } catch { /* ignore — non-fatal; alert simply isn't surfaced in chat */ }
      }
    })()
    return () => { cancelled = true }
  }, [alerts, user, tripId, lang])

  // dev25 P5 — live GPS companion: while logged in on a trip with real GPS, surface a rain nudge
  // anchored to where the user actually is (vs the scheduler's centroid alert). Posts a bubble +
  // unread badge, reusing the proactive path; the user acts by replying in chat.
  useLiveCompanion({
    enabled: !!user,
    sessionId: getSessionId(),
    tripId,
    gps: position,
    lang,
    onNudge: (text, id) => {
      setMessages((m) => [...m, { role: 'assistant', text, companionId: id }])
      if (!open) setUnread((u) => u + 1)
    },
  })

  // dev25 P2 — resolve an alert from inside the chat. Accepting an adaptation reuses the same
  // backend (api.adaptTrip/acceptSwap, inside AlertActionCard); on success we broadcast the
  // existing trip-updated event so the Trip page refreshes, exactly as the banner did.
  const handleAlertAdapted = (updatedTrip) => {
    if (updatedTrip) {
      window.dispatchEvent(new CustomEvent('imove:trip-updated', { detail: updatedTrip }))
    }
  }
  const handleAlertDismiss = (alertId) => {
    setResolvedAlerts((prev) => {
      const next = new Set(prev)
      next.add(alertId)
      return next
    })
  }

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
      // dev25 P3 — prefer rich blocks; fall back to a plain text bubble for back-compat.
      setMessages((m) => [...m, res.blocks?.length
        ? { role: 'assistant', blocks: res.blocks }
        : { role: 'assistant', text: res.reply }])
      if (res.proposed_action && res.pending_action_id) {
        setPending({ proposed_action: res.proposed_action, pending_action_id: res.pending_action_id })
      }
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: e.message || t('chatError') }])
    } finally {
      setLoading(false)
    }
  }

  const useQuickAction = (text) => {
    setInput(text)
    requestAnimationFrame(() => inputRef.current?.focus())
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
      <div className="fixed bottom-5 right-5 z-50 flex w-[min(92vw,330px)] flex-col overflow-hidden rounded-[1.25rem] border border-slate-200 bg-white shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between border-b border-white/10 bg-slate-950 px-4 py-3 text-white">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-teal-400/15 text-teal-200">
              <Bot className="h-4 w-4" />
            </span>
            {t('chatTitle')}
          </span>
          <button onClick={() => setOpen(false)} aria-label={t('chatClose')} className="grid h-7 w-7 place-items-center rounded-md text-white/70 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col items-center gap-3 bg-slate-50 p-6 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-500 shadow-sm">
            <Lock className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium text-slate-700">{t('chatLoginRequired')}</p>
          <p className="text-xs text-slate-500">{t('chatLoginHint')}</p>
        </div>
      </div>
    ) : (
      <button
        onClick={() => setOpen(true)}
        aria-label={t('chatOpen')}
        className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-2xl bg-slate-400 text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
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
        className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-2xl bg-slate-950 text-white shadow-xl shadow-slate-900/20 ring-1 ring-white/40 transition-transform hover:scale-105 active:scale-95"
      >
        <MessageCircle className="h-6 w-6" />
        {unread > 0 && (
          <span
            aria-label={t('chatUnread', unread)}
            className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white"
          >
            {unread}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-[min(94vw,400px)] flex-col overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 animate-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 bg-slate-950 px-4 py-3.5 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-teal-400/15 text-teal-200 ring-1 ring-teal-200/15">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{t('chatTitle')}</p>
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label={t('chatClose')}
          className="grid h-7 w-7 place-items-center rounded-md text-white/70 transition-colors hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex max-h-[56vh] min-h-[280px] flex-col gap-2.5 overflow-y-auto bg-gradient-to-b from-slate-50/60 to-white p-3.5 scroll-thin">
        {messages.map((msg, i) => {
          const showCard = msg.alert && tripId && !resolvedAlerts.has(msg.alertId)
          const isUser = msg.role === 'user'
          const isLiveAssistant = !!(msg.alert || msg.alertId || msg.companionId)
          return (
            <div key={i} className="contents">
              {/* dev25 P3 — rich multi-block assistant answer (text + place/route/bus cards) */}
              {msg.blocks?.length ? (
                <ChatBlocks blocks={msg.blocks} />
              ) : (
                <div
                  className={cn(
                    'max-w-[86%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm',
                    isUser
                      ? 'self-end bg-slate-950 text-white shadow-slate-900/10'
                      : isLiveAssistant
                        ? 'self-start border border-amber-200 bg-amber-50 text-amber-950'
                        : 'self-start border border-slate-200 bg-white text-slate-800'
                  )}
                >
                  {!isUser && isLiveAssistant && (
                    <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
                      <AlertTriangle className="h-3 w-3" />
                      {msg.alert ? ui.alertLabel : ui.companionLabel}
                    </span>
                  )}
                  {msg.text}
                </div>
              )}
              {/* dev25 P2 — interactive resolver under a proactive alert bubble */}
              {showCard && (
                <div className="self-start w-full">
                  <AlertActionCard
                    alert={msg.alert}
                    tripId={tripId}
                    onAdapted={handleAlertAdapted}
                    onDismiss={handleAlertDismiss}
                  />
                </div>
              )}
            </div>
          )
        })}

        {messages.length <= 1 && !loading && (
          <div className="mt-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-teal-600" />
              {ui.quickTitle}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ui.quickActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => useQuickAction(action)}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs font-medium text-slate-700 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="self-start inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('chatThinking')}
          </div>
        )}

        {/* Proposed action card */}
        {pending && (
          <div className="self-start w-full rounded-2xl border border-teal-200 bg-white p-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide text-teal-700">
                  {t('chatProposalLabel')}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-800">{pending.proposed_action.preview}</p>
                <p className="mt-1.5 text-xs text-slate-500">{ui.confirmHint}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => confirm(true)}
                disabled={applying}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
              >
                {applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                {applying ? t('chatApplying') : t('chatConfirm')}
              </button>
              <button
                onClick={() => confirm(false)}
                disabled={applying}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
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
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={tripId ? ui.tripPlaceholder : t('chatPlaceholder')}
          className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition-colors focus:border-teal-400 focus:bg-white"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          aria-label={t('chatSend')}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-950 text-white transition-colors hover:bg-teal-800 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
