import { useState, useEffect } from 'react'
import { AlertTriangle, Info, CloudRain, X, ArrowRight, Loader2, Clock } from 'lucide-react'
import { api } from '../../services/api'
import { cn } from '../../lib/utils'
import { useT } from '../../contexts/LanguageContext'

const TYPE_CONFIG = {
  train_delay: {
    Icon: AlertTriangle,
    containerClass: 'bg-red-50 border-red-200',
    iconClass: 'text-red-500',
    badgeClass: 'bg-red-100 text-red-700',
    textClass: 'text-red-900',
    labelKey: 'alertTransit',
    btnClass: 'border-red-300 text-red-700 hover:bg-red-100',
    showAdapt: true,
  },
  bus_cancellation: {
    Icon: AlertTriangle,
    containerClass: 'bg-red-50 border-red-200',
    iconClass: 'text-red-500',
    badgeClass: 'bg-red-100 text-red-700',
    textClass: 'text-red-900',
    labelKey: 'alertTransit',
    btnClass: 'border-red-300 text-red-700 hover:bg-red-100',
    showAdapt: true,
  },
  transport_alert: {
    Icon: AlertTriangle,
    containerClass: 'bg-red-50 border-red-200',
    iconClass: 'text-red-500',
    badgeClass: 'bg-red-100 text-red-700',
    textClass: 'text-red-900',
    labelKey: 'alertTransit',
    btnClass: 'border-red-300 text-red-700 hover:bg-red-100',
    showAdapt: true,
  },
  weather_warning: {
    Icon: CloudRain,
    containerClass: 'bg-sky-50 border-sky-200',
    iconClass: 'text-sky-500',
    badgeClass: 'bg-sky-100 text-sky-700',
    textClass: 'text-sky-900',
    labelKey: 'alertWeather',
    btnClass: 'border-sky-300 text-sky-700 hover:bg-sky-100',
    showAdapt: true,
  },
  // dev19: rain happening right now (current weather), styled warmer than the forecast warning
  weather_live: {
    Icon: CloudRain,
    containerClass: 'bg-amber-50 border-amber-200',
    iconClass: 'text-amber-500',
    badgeClass: 'bg-amber-100 text-amber-700',
    textClass: 'text-amber-900',
    labelKey: 'alertWeather',
    btnClass: 'border-amber-300 text-amber-700 hover:bg-amber-100',
    showAdapt: true,
  },
  // dev20: closing-risk / running-late alert — amber, schedule-focused
  closing_risk: {
    Icon: Clock,
    containerClass: 'bg-amber-50 border-amber-200',
    iconClass: 'text-amber-500',
    badgeClass: 'bg-amber-100 text-amber-700',
    textClass: 'text-amber-900',
    labelKey: 'alertSchedule',
    btnClass: 'border-amber-300 text-amber-700 hover:bg-amber-100',
    showAdapt: true,
  },
  service_unavailable: {
    Icon: Info,
    containerClass: 'bg-slate-50 border-slate-200',
    iconClass: 'text-slate-400',
    badgeClass: 'bg-slate-100 text-slate-600',
    textClass: 'text-slate-700',
    labelKey: 'alertService',
    btnClass: 'border-slate-300 text-slate-600 hover:bg-slate-100',
    showAdapt: false,
  },
}

function getSessionId() {
  try { return localStorage.getItem('session_id') } catch { return null }
}

function DeltaPill({ value, unit, positiveIsBad = true }) {
  if (!value) return null
  const bad = positiveIsBad ? value > 0 : value < 0
  const sign = value > 0 ? '+' : ''
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
      bad ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
    )}>
      {sign}{value}{unit}
    </span>
  )
}

// Extract rain % from message text, e.g. "70% chance of rain"
function parseRainPct(message) {
  const m = message?.match(/(\d{1,3})\s*%/)
  return m ? Number(m[1]) : null
}

// Count outdoor place mentions from message
function parseOutdoorCount(message) {
  const m = message?.match(/(\d+)\s+outdoor/i)
  return m ? Number(m[1]) : null
}

function WeatherAlertBanner({ alert, tripId, onDismiss, onAdapted }) {
  const { containerClass, iconClass, badgeClass, textClass, btnClass } =
    TYPE_CONFIG[alert.alert_type] ?? TYPE_CONFIG.weather_warning
  const { t } = useT()
  const isLive = alert.alert_type === 'weather_live'
  const severity = alert.severity ?? null

  const [previewing, setPreviewing] = useState(false)
  const [proposal, setProposal] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    setProposal(null)
    setPreviewing(false)
    setError(null)
  }, [alert.id])

  const rainPct = alert.metadata?.rain_probability ?? parseRainPct(alert.message)
  const outdoorCount = alert.metadata?.outdoor_count ?? parseOutdoorCount(alert.message)
  const dayNum = alert.day_number ?? null

  const handlePreview = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.adaptTrip(tripId, { alert_id: alert.id, session_id: getSessionId() })
      setProposal(result)
      setPreviewing(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAccept = async () => {
    setAccepting(true)
    try {
      const updatedTrip = await api.acceptSwap(tripId, { alert_id: alert.id, session_id: getSessionId() })
      if (onAdapted) await onAdapted(updatedTrip)
      onDismiss(alert.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setAccepting(false)
    }
  }

  return (
    <div role="alert" className={cn('rounded-2xl border p-3.5 animate-slide-up', containerClass)}>
      {/* Compact header row */}
      <div className="flex items-center gap-2.5">
        <CloudRain className={cn('h-4 w-4 shrink-0', iconClass)} aria-hidden="true" />

        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn('text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full', badgeClass)}>
            {isLive ? 'Raining now' : t('alertRain')}
          </span>
          {dayNum != null && (
            <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-sky-600 text-white">
              Day {dayNum}
            </span>
          )}
          {severity && (
            <span className={cn(
              'text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full text-white',
              severity === 'heavy' ? 'bg-red-600' : 'bg-amber-500'
            )}>
              {severity}
            </span>
          )}
          {rainPct != null && (
            <span className={cn('text-sm font-semibold', textClass)}>{t('alertChance', rainPct)}</span>
          )}
          {outdoorCount != null && (
            <span className="text-sm text-sky-700/70">{t('alertOutdoorAffected', outdoorCount)}</span>
          )}
          {rainPct == null && outdoorCount == null && (
            <span className={cn('text-sm', textClass)}>{t('alertOutdoorFallback')}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!previewing && (
            <button
              onClick={handlePreview}
              disabled={loading}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-60',
                btnClass
              )}
            >
              {loading ? <Loader2 size={11} className="animate-spin" /> : null}
              {loading ? t('alertUpdating') : t('alertPreview')}
            </button>
          )}
          <button
            onClick={() => onDismiss(alert.id)}
            className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-black/5 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Full reason: which day, the date, rain odds, and why this appeared */}
      {alert.message && (
        <p className={cn('mt-2 text-[12.5px] leading-relaxed', textClass)}>{alert.message}</p>
      )}

      {/* Expanded: swap details */}
      {previewing && proposal && (
        <div className="mt-3 pt-3 border-t border-sky-200">
          {proposal.changes?.length > 0 ? (
            <ul className="space-y-1 mb-3">
              {proposal.changes.map((change, i) => (
                <li key={i} className={cn('flex items-start gap-1.5 text-xs', textClass)}>
                  <ArrowRight size={11} className="mt-0.5 shrink-0 text-sky-400" />
                  {change}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-sky-700/70 mb-3">{t('alertNoSwapsNeeded')}</p>
          )}

          {(proposal.delta_transit_cost || proposal.delta_active_time || proposal.delta_walking_distance) && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <DeltaPill value={proposal.delta_transit_cost} unit=" SGD" positiveIsBad />
              <DeltaPill value={proposal.delta_active_time} unit=" min" positiveIsBad />
              <DeltaPill value={Math.round(proposal.delta_walking_distance ?? 0)} unit=" m walk" positiveIsBad />
            </div>
          )}

          <div className="flex gap-2">
            {proposal.changes?.length > 0 && (
              <button
                onClick={handleAccept}
                disabled={accepting}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
                  btnClass
                )}
              >
                {accepting ? t('alertApplying') : t('alertAcceptSwap')}
              </button>
            )}
            <button
              onClick={() => { setPreviewing(false); setProposal(null) }}
              className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', btnClass)}
            >
              {t('alertDiscard')}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// dev20: running-late / closing-time banner. Shows only the feasible resolutions and states
// the reason for any it can't offer — never a silent hide.
function ClosingRiskBanner({ alert, tripId, onDismiss, onAdapted }) {
  const { t } = useT()
  const { containerClass, iconClass, badgeClass, textClass, btnClass } = TYPE_CONFIG.closing_risk
  const md = alert.metadata ?? {}
  const res = md.resolutions ?? {}
  const leaveEarlier = res.leave_earlier ?? { feasible: false }
  const push = res.push ?? { feasible: false }
  const dayCapacity = push.day_capacity ?? []

  const [proposal, setProposal] = useState(null)
  const [resolution, setResolution] = useState(null)
  const [showDays, setShowDays] = useState(false)
  const [loading, setLoading] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setProposal(null); setResolution(null); setShowDays(false); setError(null)
  }, [alert.id])

  const preview = async (chosen, targetDay = null) => {
    setLoading(true); setError(null); setResolution(chosen)
    try {
      const result = await api.adaptTrip(tripId, {
        alert_id: alert.id, session_id: getSessionId(),
        resolution: chosen, target_day: targetDay,
      })
      if (!result.adapted) {
        setError(result.changes?.[0] ?? 'Cannot apply this option')
        setResolution(null)
        return
      }
      setProposal(result)
    } catch (e) {
      setError(e.message); setResolution(null)
    } finally {
      setLoading(false)
    }
  }

  const confirm = async () => {
    setAccepting(true)
    try {
      const updated = await api.acceptSwap(tripId, { alert_id: alert.id, session_id: getSessionId() })
      if (onAdapted) await onAdapted(updated)
      onDismiss(alert.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setAccepting(false)
    }
  }

  const actionBtn = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60'
  const busy = loading || accepting

  return (
    <div role="alert" className={cn('rounded-2xl border p-3.5 animate-slide-up', containerClass)}>
      <div className="flex items-start gap-2.5">
        <Clock className={cn('h-4 w-4 shrink-0 mt-0.5', iconClass)} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cn('text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full', badgeClass)}>
              {t('alertSchedule')}
            </span>
            {alert.day_number != null && (
              <span className="text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-600 text-white">
                {t('crDayLabel', alert.day_number)}
              </span>
            )}
          </div>
          <p className={cn('mt-1.5 text-[12.5px] leading-relaxed', textClass)}>
            {md.place_name
              ? t('crHeader', md.place_name, md.close_time, md.projected_arrival, md.deficit_min)
              : alert.message}
          </p>
        </div>
        <button
          onClick={() => onDismiss(alert.id)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-black/5 transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Resolution preview (changes + deltas + confirm) */}
      {proposal ? (
        <div className="mt-3 pt-3 border-t border-amber-200">
          {proposal.changes?.length > 0 && (
            <ul className="space-y-1 mb-3">
              {proposal.changes.map((change, i) => (
                <li key={i} className={cn('flex items-start gap-1.5 text-xs', textClass)}>
                  <ArrowRight size={11} className="mt-0.5 shrink-0 text-amber-400" />
                  {change}
                </li>
              ))}
            </ul>
          )}
          {(proposal.delta_transit_cost || proposal.delta_active_time || proposal.delta_walking_distance) ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              <DeltaPill value={proposal.delta_transit_cost} unit=" SGD" positiveIsBad />
              <DeltaPill value={proposal.delta_active_time} unit=" min" positiveIsBad />
              <DeltaPill value={Math.round(proposal.delta_walking_distance ?? 0)} unit=" m walk" positiveIsBad />
            </div>
          ) : null}
          <div className="flex gap-2">
            <button onClick={confirm} disabled={busy} className={cn(actionBtn, btnClass)}>
              {accepting ? <Loader2 size={11} className="animate-spin" /> : null}
              {accepting ? t('alertApplying') : t('crConfirm')}
            </button>
            <button
              onClick={() => { setProposal(null); setResolution(null) }}
              disabled={busy}
              className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', btnClass)}
            >
              {t('alertDiscard')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {/* Leave earlier — recommended when feasible */}
          {leaveEarlier.feasible && (
            <div className="rounded-lg bg-amber-100/60 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className={cn('text-xs font-semibold', textClass)}>
                  {t('crLeaveEarlier')}
                  <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                    {t('crRecommended')}
                  </span>
                </span>
                <button onClick={() => preview('leave_earlier')} disabled={busy} className={cn(actionBtn, btnClass)}>
                  {loading && resolution === 'leave_earlier' ? <Loader2 size={11} className="animate-spin" /> : null}
                  {t('crLeaveEarlier')}
                </button>
              </div>
              <p className={cn('mt-1 text-[11.5px] leading-relaxed', textClass)}>
                {t('crLeaveEarlierAdvice', leaveEarlier.current_place_name, leaveEarlier.target_leave_time, leaveEarlier.save_minutes)}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => preview('skip')} disabled={busy} className={cn(actionBtn, btnClass)}>
              {loading && resolution === 'skip' ? <Loader2 size={11} className="animate-spin" /> : null}
              {t('crSkip')}
            </button>
            {push.feasible && (
              <button onClick={() => setShowDays((v) => !v)} disabled={busy} className={cn(actionBtn, btnClass)}>
                {t('crPush')}
              </button>
            )}
          </div>

          {/* Push infeasible → state the reason, never hide blankly */}
          {!push.feasible && (
            <p className="text-[11.5px] leading-relaxed text-amber-700/80">
              {push.reason === 'closed_all'
                ? t('crPushClosedAll', md.place_name)
                : t('crPushNoOtherDay')}
            </p>
          )}

          {/* Push day picker */}
          {push.feasible && showDays && (
            <div className="rounded-lg border border-amber-200 bg-white/50 p-2">
              <p className={cn('mb-1.5 text-[11px] font-semibold uppercase tracking-wide', textClass)}>{t('crChooseDay')}</p>
              <div className="flex flex-col gap-1.5">
                {dayCapacity.map((d) => {
                  const closed = d.status === 'closed'
                  return (
                    <button
                      key={d.day}
                      onClick={() => !closed && preview('push', d.day)}
                      disabled={busy || closed}
                      className={cn(
                        'flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
                        closed
                          ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                          : cn('font-semibold', btnClass)
                      )}
                    >
                      <span>{t('crDayLabel', d.day)}</span>
                      <span className={cn(
                        'rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase',
                        d.status === 'room' ? 'bg-emerald-100 text-emerald-700'
                          : d.status === 'full' ? 'bg-amber-200 text-amber-800'
                          : 'bg-slate-200 text-slate-500'
                      )}>
                        {d.status === 'room' ? t('crBadgeRoom', d.remaining_minutes)
                          : d.status === 'full' ? t('crBadgeFull')
                          : t('crBadgeClosed', d.weekday)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}

export default function AlertBanner({ alert, tripId, onDismiss, onAdapted }) {
  const { t } = useT()

  if (alert.alert_type === 'weather_warning' || alert.alert_type === 'weather_live') {
    return <WeatherAlertBanner alert={alert} tripId={tripId} onDismiss={onDismiss} onAdapted={onAdapted} />
  }

  if (alert.alert_type === 'closing_risk') {
    return <ClosingRiskBanner alert={alert} tripId={tripId} onDismiss={onDismiss} onAdapted={onAdapted} />
  }

  const config = TYPE_CONFIG[alert.alert_type] ?? TYPE_CONFIG.service_unavailable
  const { Icon, containerClass, iconClass, badgeClass, textClass, labelKey, btnClass, showAdapt } = config

  const [adapting, setAdapting] = useState(false)
  const [adaptError, setAdaptError] = useState(null)
  const [proposal, setProposal] = useState(null)
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState(null)
  const [feedbackSent, setFeedbackSent] = useState(false)

  useEffect(() => {
    setAdaptError(null)
    setProposal(null)
    setAcceptError(null)
    setFeedbackSent(false)
  }, [alert.id])

  const handleAdapt = async () => {
    setAdapting(true)
    setAdaptError(null)
    try {
      const result = await api.adaptTrip(tripId, { alert_id: alert.id, session_id: getSessionId() })
      setProposal(result)
    } catch (e) {
      setAdaptError(e.message)
    } finally {
      setAdapting(false)
    }
  }

  const handleAccept = async () => {
    setAccepting(true)
    setAcceptError(null)
    try {
      const updatedTrip = await api.acceptSwap(tripId, { alert_id: alert.id, session_id: getSessionId() })
      if (onAdapted) await onAdapted(updatedTrip)
      onDismiss(alert.id)
    } catch (e) {
      setAcceptError(e.message)
    } finally {
      setAccepting(false)
    }
  }

  const delta = proposal
    ? { cost: proposal.delta_transit_cost, time: proposal.delta_active_time, walk: proposal.delta_walking_distance }
    : null

  const sendFeedback = async (rating) => {
    setFeedbackSent(true)
    try {
      await api.submitFeedback({
        trip_id: tripId,
        rating,
        comment: rating >= 4 ? 'Helpful alert' : 'Not helpful alert',
      })
    } catch {
      setFeedbackSent(false)
    }
  }

  return (
    <div role="alert" className={cn('rounded-2xl border p-4 flex gap-3 animate-slide-up', containerClass)}>
      <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', iconClass)} aria-hidden="true" />

      <div className="flex-1 min-w-0">
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide', badgeClass)}>
          {t(labelKey)}
        </span>
        <p className={cn('text-sm mt-1.5 leading-relaxed', textClass)}>{alert.message}</p>

        {proposal?.changes?.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {proposal.changes.map((change, i) => (
              <li key={i} className={cn('text-xs leading-relaxed', textClass)}>• {change}</li>
            ))}
          </ul>
        )}
        {delta && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <DeltaPill value={delta.cost} unit=" SGD" positiveIsBad />
            <DeltaPill value={delta.time} unit=" min" positiveIsBad />
            <DeltaPill value={Math.round(delta.walk ?? 0)} unit=" m walk" positiveIsBad />
          </div>
        )}

        <div className="flex gap-2 mt-3 flex-wrap">
          {showAdapt && !proposal && (
            <button
              onClick={handleAdapt}
              disabled={adapting}
              className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60', btnClass)}
            >
              {adapting ? t('alertUpdating') : t('alertPreview')}
            </button>
          )}
          {showAdapt && proposal && (
            <button
              onClick={handleAccept}
              disabled={accepting}
              className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60', btnClass)}
            >
              {accepting ? t('alertApplying') : t('alertAccept')}
            </button>
          )}
          <button
            onClick={() => onDismiss(alert.id)}
            disabled={adapting || accepting}
            className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60', btnClass)}
          >
            {proposal ? t('alertDiscard') : showAdapt ? t('alertDismiss') : t('alertGotIt')}
          </button>
          {!feedbackSent ? (
            <>
              <button onClick={() => sendFeedback(5)} className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', btnClass)}>
                {t('alertHelpful')}
              </button>
              <button onClick={() => sendFeedback(1)} className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors', btnClass)}>
                {t('alertNotHelpful')}
              </button>
            </>
          ) : (
            <span className="inline-flex items-center rounded-lg bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-500">
              {t('alertFeedbackSent')}
            </span>
          )}
        </div>

        {adaptError && <p className="mt-2 text-xs text-red-600">{adaptError}</p>}
        {acceptError && <p className="mt-2 text-xs text-red-600">{acceptError}</p>}
      </div>

      <button
        onClick={() => onDismiss(alert.id)}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-black/5 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
