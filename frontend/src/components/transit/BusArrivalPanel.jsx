import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { api } from '../../services/api'
import { cn } from '../../lib/utils'
import { useT } from '../../contexts/LanguageContext'

const LOAD_CONFIG = {
  SEA: { labelKey: 'busLoadLow',      dot: 'bg-emerald-500', text: 'text-emerald-700' },
  SDA: { labelKey: 'busLoadModerate', dot: 'bg-amber-500',   text: 'text-amber-700'   },
  LSD: { labelKey: 'busLoadHigh',     dot: 'bg-red-500',      text: 'text-red-700'    },
}

function ArrivalTime({ minutes }) {
  const { t } = useT()
  if (minutes < 0) return <span className="text-slate-400 text-xs">—</span>
  if (minutes === 0) return <span className="font-semibold text-emerald-700 text-xs">{t('busArr')}</span>
  return <span className="text-xs font-semibold text-slate-800">{t('busMin', minutes)}</span>
}

export default function BusArrivalPanel({ stopCode, serviceFilter }) {
  const { t } = useT()
  const [arrivals, setArrivals] = useState(null)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const fetch = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    try {
      const data = await api.getBusArrivals(stopCode)
      setArrivals(data)
      setUpdatedAt(new Date())
      setError(null)
    } catch (e) {
      setError(e.message ?? t('busFailed'))
    } finally {
      if (manual) setRefreshing(false)
    }
  }, [stopCode])

  useEffect(() => {
    fetch()
    const id = setInterval(fetch, 30_000)
    return () => clearInterval(id)
  }, [fetch])

  const displayed = arrivals
    ? (serviceFilter
        ? arrivals.filter((a) => a.service_no === serviceFilter)
        : arrivals)
    : null

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 mt-2 text-xs text-red-700">
        <AlertCircle size={12} className="shrink-0" />
        <span>{error}</span>
        <button onClick={() => fetch(true)} className="ml-auto underline hover:no-underline">{t('busRetry')}</button>
      </div>
    )
  }

  if (!displayed) {
    return (
      <div className="mt-2 space-y-1.5 animate-pulse">
        {[1, 2].map((i) => (
          <div key={i} className="h-5 rounded bg-slate-100 w-full" />
        ))}
      </div>
    )
  }

  if (displayed.length === 0) {
    return (
      <p className="mt-2 text-xs text-slate-400 italic">{t('busNoServices')}</p>
    )
  }

  const elapsed = updatedAt ? Math.round((Date.now() - updatedAt.getTime()) / 1000) : 0
  const freshLabel = elapsed < 5 ? t('busJustNow') : t('busAgo', elapsed)

  return (
    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="mb-1.5 grid grid-cols-[2.5rem_1fr_auto] gap-2 border-b border-slate-100 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        <span>{t('busRoute')}</span>
        <span>{t('busArrivals')}</span>
        <span>{t('busLoad')}</span>
      </div>
      <div className="space-y-1.5 mb-2">
        {displayed.map((svc) => {
          const load = LOAD_CONFIG[svc.load] ?? null
          return (
            <div key={svc.service_no} className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2">
              <span className="text-xs font-bold text-slate-800">{svc.service_no}</span>
              <div className="flex items-center gap-2">
                <ArrivalTime minutes={svc.next_arrival_minutes} />
                {svc.next_arrival_2_minutes >= 0 && (
                  <>
                    <span className="text-slate-300 text-xs">·</span>
                    <ArrivalTime minutes={svc.next_arrival_2_minutes} />
                  </>
                )}
              </div>
              {load ? (
                <span className={cn('flex items-center gap-1 text-[10px] font-medium', load.text)}>
                  <span className={cn('inline-block h-1.5 w-1.5 rounded-full', load.dot)} />
                  {t(load.labelKey)}
                </span>
              ) : <span />}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 border-t border-slate-100 pt-1.5">
        <span>{t('busUpdated', freshLabel)}</span>
        <button
          onClick={() => fetch(true)}
          className="ml-auto grid h-4 w-4 place-items-center rounded hover:text-slate-600"
          aria-label={t('busRefresh')}
        >
          <RefreshCw size={10} className={cn(refreshing && 'animate-spin')} />
        </button>
      </div>
    </div>
  )
}
