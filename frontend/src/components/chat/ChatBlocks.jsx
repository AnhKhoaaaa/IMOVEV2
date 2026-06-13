import ReactMarkdown from 'react-markdown'
import { Clock } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useT } from '../../contexts/LanguageContext'

// dev25 P3 — render an assistant answer as MULTIPLE styled blocks (markdown text + place cards
// with real images + route-compare + bus-arrivals) instead of one plain bubble. Block data is
// built backend-side from the curated dataset / live tools, so images & ids are always real.
// Each block aligns itself to the start of the chat column (parent is a flex column).

// react-markdown v9 does NOT render raw HTML unless rehype-raw is added — we deliberately omit
// it, so model text can't inject markup. Links open safely in a new tab.
const MD_COMPONENTS = {
  a: ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" className="text-sky-600 underline" />
  ),
  ul: ({ node, ...props }) => <ul {...props} className="my-1 list-disc pl-4 space-y-0.5" />,
  ol: ({ node, ...props }) => <ol {...props} className="my-1 list-decimal pl-4 space-y-0.5" />,
  p: ({ node, ...props }) => <p {...props} className="whitespace-pre-wrap" />,
}

function TextBlock({ markdown }) {
  return (
    <div className="self-start max-w-[85%] rounded-2xl bg-slate-100 px-3 py-2 text-sm leading-relaxed text-slate-800">
      <ReactMarkdown components={MD_COMPONENTS} skipHtml>{markdown}</ReactMarkdown>
    </div>
  )
}

// Pexels originals are multi-MB — request a small, compressed rendition for the chat card.
function thumb(url) {
  if (!url || !url.includes('images.pexels.com')) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}auto=compress&cs=tinysrgb&w=600`
}

function PlaceCard({ name, category, image_url, suggested_duration_minutes }) {
  const { t } = useT()
  return (
    <div className="self-start w-full max-w-[88%] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {image_url && (
        // No loading="lazy": lazy images inserted into the auto-scrolling chat container often
        // never trigger their intersection check and stay blank. Eager-load + placeholder bg +
        // onError (matches the proven pattern in planner/Trip cards).
        <div className="h-28 w-full bg-slate-100">
          <img
            src={thumb(image_url)}
            alt={name}
            className="h-28 w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>
      )}
      <div className="p-2.5">
        <p className="text-sm font-semibold text-slate-800">{name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          {category && <span className="capitalize">{category.toLowerCase().replace(/_/g, ' ')}</span>}
          {suggested_duration_minutes != null && (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> {t('chatCardDuration', suggested_duration_minutes)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

const MODE_LABEL = { TRANSIT: 'Transit', WALK: 'Walk', CYCLE: 'Cycle', BUS: 'Bus', METRO: 'Metro', GRAB: 'Grab' }

function RouteCompareCard({ options = [] }) {
  const { t } = useT()
  return (
    <div className="self-start w-full max-w-[88%] rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('chatRouteCompare')}</p>
      <div className="flex flex-col gap-1">
        {options.map((o, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm">
            <span className="font-semibold text-slate-700">{MODE_LABEL[o.mode] ?? o.mode}</span>
            <span className="flex items-center gap-2 text-xs text-slate-500">
              {o.duration_minutes != null && <span>{t('chatMinShort', Math.round(o.duration_minutes))}</span>}
              {o.fare_sgd != null && (
                <span className="font-medium text-emerald-600">
                  {o.fare_sgd > 0 ? `S$${o.fare_sgd.toFixed(2)}` : t('chatRouteFree')}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BusArrivalsCard({ stop_code, services = [] }) {
  const { t } = useT()
  return (
    <div className="self-start w-full max-w-[88%] rounded-2xl border border-slate-200 bg-white p-2.5 shadow-sm">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('chatBusArrivals', stop_code)}</p>
      {services.length === 0 ? (
        <p className="text-xs text-slate-400">{t('chatBusNone')}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {services.map((s, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm">
              <span className="font-semibold text-slate-700">{s.service_no}</span>
              <span className={cn('text-xs font-medium', s.eta_min != null && s.eta_min <= 1 ? 'text-amber-600' : 'text-slate-500')}>
                {s.eta_min == null ? '—' : s.eta_min <= 1 ? t('chatBusNow') : t('chatBusEta', s.eta_min)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChatBlocks({ blocks }) {
  if (!blocks?.length) return null
  return blocks.map((b, i) => {
    switch (b.type) {
      case 'text':
        return <TextBlock key={i} markdown={b.markdown} />
      case 'place_card':
        return <PlaceCard key={i} {...b} />
      case 'route_compare':
        return <RouteCompareCard key={i} {...b} />
      case 'bus_arrivals':
        return <BusArrivalsCard key={i} {...b} />
      default:
        return null
    }
  })
}
