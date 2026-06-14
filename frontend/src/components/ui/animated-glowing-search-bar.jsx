import { Search, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '../../lib/utils'

export function AnimatedGlowingSearchBar({ value, onChange, placeholder = 'Search...', className }) {
  return (
    <div className={cn('glowing-search group relative w-full', className)}>
      <div className="glowing-search__aura" aria-hidden="true" />
      <div className="glowing-search__border" aria-hidden="true" />
      <div className="relative z-10 flex h-12 items-center rounded-xl bg-white px-3 shadow-[0_4px_20px_rgba(0,0,0,0.05)]">
        <Search className="ml-1 h-4 w-4 shrink-0 text-blue-600 transition-transform duration-300 group-focus-within:scale-110" />
        <input
          type="search"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-[13px] font-medium text-slate-800 outline-none placeholder:text-slate-400"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange({ target: { value: '' } })}
            aria-label="Clear search"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-blue-50 hover:text-blue-600"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <div className="glowing-search__action grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
        )}
      </div>
    </div>
  )
}
