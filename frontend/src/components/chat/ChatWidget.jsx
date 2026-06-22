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
import merlionMascot from './merlion-mascot.gif'
import merlionAvatar from './merlion-avatar.png'

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
    speechBubbleText: "Hi there! I'm IMOVE's AI assistant. Give me a shout if you need any help! ✨",
    loadingMessages: [
      "Hang on a sec, I'm flipping through the map to find cool spots for you... 🗺️",
      "I'm racking my brain right now, just give me a few seconds... 🤔",
      "Crafting the perfect itinerary for you! 🎒"
    ]
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
    speechBubbleText: "Chào bạn! Mình là trợ lý AI của IMOVE . Nếu có cấn gì thì cứ 'ới' mình một tiếng nhá! ✨",
    loadingMessages: [
      'Đợi mình một xíu xiu, mình đang lật bản đồ tìm chỗ hay cho bạn nha... 🗺️',
      'Mình đang vắt óc suy nghĩ đây, chờ mình vài giây nhé... 🤔',
      'Đang lên lịch trình chuẩn gu cho bạn đây! 🎒'
    ]
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
  const [showBubble, setShowBubble] = useState(true)
  const [messages, setMessages] = useState([])      // { role: 'user' | 'assistant', text }
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
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

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`
    }
  }, [input])

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

    const msgs = ui.loadingMessages
    setLoadingMessage(msgs[Math.floor(Math.random() * msgs.length)])

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
      <div className="fixed bottom-3 right-3 z-[100] flex flex-col items-center sm:bottom-5 sm:right-5">
        {showBubble && (
          <div className="relative mb-4 hidden w-52 origin-bottom scale-80 rounded-2xl border border-slate-100 bg-white p-3 text-xs text-slate-800 shadow-xl sm:block">
            <button onClick={(e) => { e.stopPropagation(); setShowBubble(false); }} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="h-3 w-3" />
            </button>
            <p className="pr-4 font-sans leading-relaxed">{ui.speechBubbleText}</p>
            <div className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 bg-white border-b border-r border-slate-100"></div>
          </div>
        )}
        <button
          onClick={() => { setOpen(true); }}
          aria-label={t('chatOpen')}
          className="relative grid h-14 w-14 place-items-center rounded-full transition-transform hover:scale-105 active:scale-95 before:pointer-events-none before:absolute before:-inset-2 before:z-0 before:animate-[pulse_3s_ease-in-out_infinite] before:rounded-full before:bg-[radial-gradient(circle,rgba(37,99,235,0.35)_0%,rgba(37,99,235,0)_70%)] sm:h-auto sm:w-auto sm:before:-inset-8 sm:before:bg-[radial-gradient(circle,rgba(37,99,235,0.4)_0%,rgba(37,99,235,0)_70%)]"
        >
          <img src={merlionAvatar} alt="Mascot" className="relative z-10 h-14 w-14 rounded-full object-cover object-top drop-shadow-xl sm:hidden" />
          <img src={merlionMascot} alt="Mascot" className="relative z-10 hidden h-auto w-[225px] drop-shadow-xl sm:block" />
          <div className="absolute right-0 top-0 z-20 grid h-6 w-6 place-items-center rounded-full bg-slate-400 text-white shadow-md">
            <Lock className="h-3 w-3" />
          </div>
        </button>
      </div>
    )
  }

  if (!open) {
    return (
      <div className="fixed bottom-3 right-3 z-[100] flex flex-col items-center sm:bottom-5 sm:right-5">
        {showBubble && (
          <div className="relative mb-4 hidden w-52 origin-bottom scale-80 rounded-2xl border border-slate-100 bg-white p-3 text-xs text-slate-800 shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-500 sm:block">
            <button onClick={(e) => { e.stopPropagation(); setShowBubble(false); }} className="absolute right-2 top-2 text-slate-400 hover:text-slate-600 transition-colors">
              <X className="h-3 w-3" />
            </button>
            <p className="pr-4 font-sans leading-relaxed">{ui.speechBubbleText}</p>
            <div className="absolute -bottom-2 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 bg-white border-b border-r border-slate-100"></div>
          </div>
        )}
        <button
          onClick={() => { setOpen(true); }}
          aria-label={t('chatOpen')}
          className="relative grid h-14 w-14 place-items-center rounded-full transition-transform hover:scale-105 active:scale-95 before:pointer-events-none before:absolute before:-inset-2 before:z-0 before:animate-[pulse_3s_ease-in-out_infinite] before:rounded-full before:bg-[radial-gradient(circle,rgba(37,99,235,0.35)_0%,rgba(37,99,235,0)_70%)] sm:h-auto sm:w-auto sm:before:-inset-8 sm:before:bg-[radial-gradient(circle,rgba(37,99,235,0.4)_0%,rgba(37,99,235,0)_70%)]"
        >
          <img src={merlionAvatar} alt="Mascot" className="relative z-10 h-14 w-14 rounded-full object-cover object-top drop-shadow-xl sm:hidden" />
          <img src={merlionMascot} alt="Mascot" className="relative z-10 hidden h-auto w-[225px] drop-shadow-xl sm:block" />
          {unread > 0 && (
            <span
              aria-label={t('chatUnread', unread)}
              className="absolute right-0 top-0 z-20 grid h-6 min-w-[1.5rem] place-items-center rounded-full bg-red-500 px-1.5 text-[12px] font-bold text-white shadow-md"
            >
              {unread}
            </span>
          )}
        </button>
      </div>
    )
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex max-h-[80vh] w-[min(94vw,400px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop animate-slide-up">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900">
        <div className="flex min-w-0 items-center gap-3">
          <img src={merlionMascot} alt="Merlion Mascot" className="h-10 w-auto object-contain drop-shadow-sm" />
          <div className="min-w-0">
            <p className="truncate font-display text-base font-semibold text-slate-900">{t('chatTitle')}</p>
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label={t('chatClose')}
          className="grid h-7 w-7 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex flex-1 min-h-[300px] flex-col gap-2.5 overflow-y-auto bg-white p-3.5 scroll-thin">
        {messages.map((msg, i) => {
          const showCard = msg.alert && tripId && !resolvedAlerts.has(msg.alertId)
          const isUser = msg.role === 'user'
          const isLiveAssistant = !!(msg.alert || msg.alertId || msg.companionId)
          return (
            <div key={i} className="flex flex-col gap-2 w-full">
              <div className={cn("flex w-full gap-2", isUser ? "justify-end" : "justify-start")}>
                {!isUser && (
                  <img src={merlionAvatar} alt="Bot" className="h-8 w-8 rounded-full shrink-0 shadow-sm mt-1 object-cover" />
                )}
                {/* dev25 P3 — rich multi-block assistant answer (text + place/route/bus cards) */}
                {msg.blocks?.length ? (
                  <div className="max-w-[86%] min-w-0">
                    <ChatBlocks blocks={msg.blocks} />
                  </div>
                ) : (
                  <div
                    className={cn(
                      'max-w-[86%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm font-sans',
                      isUser
                        ? 'bg-blue-600 text-white'
                        : isLiveAssistant
                          ? 'border border-amber-200 bg-amber-50 text-amber-950'
                          : 'bg-slate-100 text-slate-900'
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
              </div>
              {/* dev25 P2 — interactive resolver under a proactive alert bubble */}
              {showCard && (
                <div className="flex w-full gap-2 justify-start">
                  <div className="h-8 w-8 shrink-0"></div>
                  <div className="flex-1 min-w-0">
                    <AlertActionCard
                      alert={msg.alert}
                      tripId={tripId}
                      onAdapted={handleAlertAdapted}
                      onDismiss={handleAlertDismiss}
                    />
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {messages.length <= 1 && !loading && (
          <div className="mt-1 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ml-10">
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
          <div className="flex w-full gap-2 justify-start">
            <img src={merlionAvatar} alt="Bot" className="h-8 w-8 rounded-full shrink-0 shadow-sm mt-1 object-cover" />
            <div className="inline-flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-100 px-3.5 py-2 text-sm text-slate-700 shadow-sm animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
              <span className="font-sans leading-relaxed">{loadingMessage}</span>
            </div>
          </div>
        )}

        {/* Proposed action card */}
        {pending && (
          <div className="flex w-full gap-2 justify-start">
            <div className="h-8 w-8 shrink-0"></div>
            <div className="w-full rounded-2xl border border-teal-200 bg-white p-3 shadow-sm">
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
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex shrink-0 items-end gap-2 border-t border-slate-200 bg-white p-2.5">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={tripId ? ui.tripPlaceholder : t('chatPlaceholder')}
          className="min-h-10 flex-1 resize-none overflow-hidden rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-sans outline-none transition-colors focus:border-blue-500 focus:bg-white"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          aria-label={t('chatSend')}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
