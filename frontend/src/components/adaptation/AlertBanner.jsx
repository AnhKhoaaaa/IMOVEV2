import { useState, useEffect } from 'react'
import { AlertTriangle, Info, CloudRain, X } from 'lucide-react'
import { api } from '../../services/api'
import { cn } from '../../lib/utils'

const TYPE_CONFIG = {
  transport_alert: {
    Icon: AlertTriangle,
    containerClass: 'bg-red-50 border-red-200',
    iconClass: 'text-red-500',
    badgeClass: 'bg-red-100 text-red-700',
    textClass: 'text-red-900',
    label: 'Transit Alert',
    btnClass: 'border-red-300 text-red-700 hover:bg-red-100',
    showAdapt: true,
  },
  weather_warning: {
    Icon: CloudRain,
    containerClass: 'bg-sky-50 border-sky-200',
    iconClass: 'text-sky-500',
    badgeClass: 'bg-sky-100 text-sky-700',
    textClass: 'text-sky-900',
    label: 'Weather Alert',
    btnClass: 'border-sky-300 text-sky-700 hover:bg-sky-100',
    showAdapt: true,
  },
  service_unavailable: {
    Icon: Info,
    containerClass: 'bg-slate-50 border-slate-200',
    iconClass: 'text-slate-400',
    badgeClass: 'bg-slate-100 text-slate-600',
    textClass: 'text-slate-700',
    label: 'Service Notice',
    btnClass: 'border-slate-300 text-slate-600 hover:bg-slate-100',
    showAdapt: false,
  },
}

function getSessionId() {
  try { return localStorage.getItem('session_id') } catch { return null }
}

function DeltaPill({ value, unit, positiveIsBad = true }) {
  if (value === 0) return null
  const bad = positiveIsBad ? value > 0 : value < 0
  const sign = value > 0 ? '+' : ''
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${bad ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
      {sign}{value}{unit}
    </span>
  )
}

export default function AlertBanner({ alert, tripId, onDismiss, onAdapted }) {
  const config = TYPE_CONFIG[alert.alert_type] ?? TYPE_CONFIG.service_unavailable
  const { Icon, containerClass, iconClass, badgeClass, textClass, label, btnClass, showAdapt } = config

  // Phase 1: fetch tentative proposal
  const [adapting, setAdapting] = useState(false)
  const [adaptError, setAdaptError] = useState(null)
  // Phase 2: user accepts or discards the proposal
  const [proposal, setProposal] = useState(null)   // AdaptResponse from /adapt
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState(null)

  useEffect(() => {
    setAdaptError(null)
    setProposal(null)
    setAcceptError(null)
  }, [alert.id])

  const handleAdapt = async () => {
    setAdapting(true)
    setAdaptError(null)
    try {
      const sessionId = getSessionId()
      const result = await api.adaptTrip(tripId, { alert_id: alert.id, session_id: sessionId })
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
      const sessionId = getSessionId()
      await api.acceptSwap(tripId, { alert_id: alert.id, session_id: sessionId })
      if (onAdapted) await onAdapted()
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

  return (
    <div role="alert" className={cn('rounded-2xl border p-4 flex gap-3 animate-slide-up', containerClass)}>
      <Icon className={cn('h-5 w-5 shrink-0 mt-0.5', iconClass)} aria-hidden="true" />

      <div className="flex-1 min-w-0">
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide', badgeClass)}>
          {label}
        </span>
        <p className={cn('text-sm mt-1.5 leading-relaxed', textClass)}>{alert.message}</p>

        {delta && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <DeltaPill value={delta.cost} unit=" SGD" positiveIsBad={true} />
            <DeltaPill value={delta.time} unit=" min" positiveIsBad={true} />
            <DeltaPill value={Math.round(delta.walk)} unit=" m walk" positiveIsBad={true} />
          </div>
        )}

        <div className="flex gap-2 mt-3 flex-wrap">
          {showAdapt && !proposal && (
            <button
              onClick={handleAdapt}
              disabled={adapting}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
                btnClass
              )}
            >
              {adapting ? 'Fetching...' : 'Update Plan'}
            </button>
          )}
          {showAdapt && proposal && (
            <button
              onClick={handleAccept}
              disabled={accepting}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
                btnClass
              )}
            >
              {accepting ? 'Applying...' : 'Accept Changes'}
            </button>
          )}
          <button
            onClick={() => onDismiss(alert.id)}
            disabled={adapting || accepting}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60',
              btnClass
            )}
          >
            {proposal ? 'Discard' : showAdapt ? 'Dismiss' : 'Got it'}
          </button>
        </div>

        {adaptError && (
          <p className="mt-2 text-xs text-red-600">{adaptError}</p>
        )}
        {acceptError && (
          <p className="mt-2 text-xs text-red-600">{acceptError}</p>
        )}
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
