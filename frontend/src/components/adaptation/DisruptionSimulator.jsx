import { useState } from 'react'
import { Minus, Sparkles, RotateCcw } from 'lucide-react'
import { cn } from '../../lib/utils'

export default function DisruptionSimulator({
  onWeatherDisrupt,
  onTransitDisrupt,
  onResetTrip,
}) {
  if (!import.meta.env.DEV) return null

  const [collapsed, setCollapsed] = useState(false)

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-20 right-4 lg:bottom-6 z-50 h-10 w-10 rounded-full bg-slate-800 text-white shadow-pop grid place-items-center hover:bg-slate-700 transition"
        title="Open Disruption Simulator"
      >
        <Sparkles size={14} />
      </button>
    )
  }

  return (
    <div className="fixed bottom-20 right-4 lg:bottom-6 z-50 w-[min(260px,calc(100vw-32px))] rounded-2xl bg-slate-800 border border-slate-700 shadow-pop overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700">
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-blue-400" />
          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">
            Agent Simulator
          </span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-700"
        >
          <Minus size={11} />
        </button>
      </div>

      {/* Controls */}
      <div className="p-3 space-y-2">
        <SimButton
          emoji="☔"
          label="Trigger Weather Disruption"
          onClick={onWeatherDisrupt}
          color="sky"
        />
        <SimButton
          emoji="🚇"
          label="Trigger Transit Disruption"
          onClick={onTransitDisrupt}
          color="red"
        />
        <div className="border-t border-slate-700 pt-2">
          <button
            onClick={onResetTrip}
            className="w-full h-8 rounded-lg border border-slate-600 text-slate-400 text-[12px] font-medium hover:bg-slate-700 transition inline-flex items-center justify-center gap-1.5"
          >
            <RotateCcw size={11} /> Reset Trip
          </button>
        </div>
      </div>
    </div>
  )
}

function SimButton({ emoji, label, onClick, color }) {
  const colors = {
    sky: 'bg-sky-600 hover:bg-sky-500',
    red: 'bg-red-600 hover:bg-red-500',
  }
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full h-9 rounded-lg text-white text-[12px] font-semibold transition inline-flex items-center justify-center gap-1.5',
        colors[color] ?? 'bg-slate-600 hover:bg-slate-500'
      )}
    >
      <span>{emoji}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}
