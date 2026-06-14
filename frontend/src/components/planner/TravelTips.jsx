import { Lightbulb, ChevronDown } from 'lucide-react'
import { useT } from '../../contexts/LanguageContext'

const ALWAYS_TIP_KEYS = ['ttAlways1', 'ttAlways2']

const CONDITIONAL_TIPS = [
  {
    key: 'outdoor',
    condition: (places) => places.some((p) => p.is_outdoor),
    tipKey: 'ttOutdoor',
  },
  {
    key: 'religious',
    condition: (places) =>
      places.some(
        (p) =>
          ['museum', 'heritage'].includes(p.category) ||
          /mosque|temple|church/i.test(p.name),
      ),
    tipKey: 'ttReligious',
  },
  {
    key: 'night',
    condition: (places) => places.some((p) => p.best_time_start >= '19:00'),
    tipKey: 'ttNight',
  },
  {
    key: 'nature',
    condition: (places) => places.some((p) => p.category === 'nature'),
    tipKey: 'ttNature',
  },
]

function computeTipKeys(places) {
  const conditional = CONDITIONAL_TIPS.filter(({ condition }) => condition(places)).map(
    ({ tipKey }) => tipKey,
  )
  return [...ALWAYS_TIP_KEYS, ...conditional]
}

export default function TravelTips({ places = [] }) {
  const { t } = useT()
  if (places.length === 0) return null

  const tipKeys = computeTipKeys(places)
  const tips = tipKeys.map((k) => t(k))

  return (
    <details className="group mt-3 rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 select-none">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-sm font-semibold text-amber-800">
            {t('ttHeader', tips.length)}
          </span>
        </div>
        <ChevronDown className="h-4 w-4 text-amber-500 transition-transform duration-200 group-open:rotate-180" />
      </summary>

      <ul className="divide-y divide-amber-100 border-t border-amber-200">
        {tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-2.5 px-4 py-2.5">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
            <p className="text-xs text-amber-900 leading-relaxed">{tip}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}
