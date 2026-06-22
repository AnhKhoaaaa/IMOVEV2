import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Train } from 'lucide-react'
import { api } from '../../services/api'
import { cn } from '../../lib/utils'
import { useT } from '../../contexts/LanguageContext'

const CROWD_CONFIG = {
  l: { labelKey: 'mrtCrowdLow',      dot: 'bg-emerald-500', text: 'text-emerald-700' },
  m: { labelKey: 'mrtCrowdModerate', dot: 'bg-amber-500',   text: 'text-amber-700'   },
  h: { labelKey: 'mrtCrowdHigh',     dot: 'bg-red-500',     text: 'text-red-700'     },
}

const LINE_NAMES = {
  NS: 'North South Line', EW: 'East West Line', CC: 'Circle Line',
  NE: 'North East Line',  DT: 'Downtown Line',  TE: 'Thomson-East Coast Line',
}

function getMrtFrequency() {
  const parts = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 9)
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  const tod = h * 60 + m
  if (tod < 360 || tod > 1410) return null  // before 6:00 or after 23:30
  const isPeak = (tod >= 390 && tod <= 540) || (tod >= 1020 && tod <= 1200)
  return isPeak ? 'mrtFreqPeak' : 'mrtFreqOffPeak'
}

function deriveLineName(route) {
  if (!route) return null
  const upper = route.toUpperCase()
  for (const [prefix, name] of Object.entries(LINE_NAMES)) {
    if (upper.startsWith(prefix) || upper.includes(prefix)) return name
  }
  return route
}

export default function MrtInfoPanel({ stationCode, subLegs }) {
  const { t } = useT()
  const [crowd, setCrowd] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const metroSub = subLegs?.find((s) => s.mode === 'METRO')
  const lineName = deriveLineName(metroSub?.route)
  const direction = metroSub?.from_name && metroSub?.to_name
    ? `${metroSub.from_name} → ${metroSub.to_name}`
    : null
  const freqKey = getMrtFrequency()

  const fetchCrowd = useCallback(async (manual = false) => {
    if (!stationCode) return
    if (manual) setRefreshing(true)
    try {
      const data = await api.getMrtCrowd(stationCode)
      if (data?.crowd_level) setCrowd(data)
    } catch {
      // crowd info is optional — fail silently
    } finally {
      if (manual) setRefreshing(false)
    }
  }, [stationCode])

  useEffect(() => {
    fetchCrowd()
    const id = setInterval(fetchCrowd, 60_000)
    return () => clearInterval(id)
  }, [fetchCrowd])

  if (!freqKey && !lineName) return null

  const crowdInfo = crowd?.crowd_level ? CROWD_CONFIG[crowd.crowd_level] : null

  return (
    <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between border-b border-slate-100 pb-1">
        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          <Train size={10} /> {t('mrtInfoTitle')}
        </span>
        {stationCode && (
          <button
            onClick={() => fetchCrowd(true)}
            className="grid h-4 w-4 place-items-center rounded text-slate-400 hover:text-slate-600"
            aria-label={t('busRefresh')}
          >
            <RefreshCw size={10} className={cn(refreshing && 'animate-spin')} />
          </button>
        )}
      </div>

      <div className="space-y-1">
        {lineName && (
          <p className="text-[12px] font-semibold text-slate-700">{lineName}</p>
        )}
        {direction && (
          <p className="truncate text-[11px] text-slate-400">{direction}</p>
        )}
        <div className="flex items-center gap-3 pt-0.5">
          {freqKey && (
            <span className="text-[11px] font-semibold text-slate-600">{t(freqKey)}</span>
          )}
          {crowdInfo && (
            <span className={cn('flex items-center gap-1 text-[10px] font-medium', crowdInfo.text)}>
              <span className={cn('inline-block h-1.5 w-1.5 rounded-full', crowdInfo.dot)} />
              {t(crowdInfo.labelKey)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
