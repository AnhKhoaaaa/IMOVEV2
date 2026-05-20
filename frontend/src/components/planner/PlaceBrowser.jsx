import { useState, useEffect } from 'react'
import {
  Search, Check, Leaf, Landmark, MapPin,
  Sparkles, Utensils, ShoppingBag, LayoutGrid,
} from 'lucide-react'
import { api } from '../../services/api'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'

const CATEGORY_GROUPS = [
  { id: 'all',           label: 'Tất cả',              icon: LayoutGrid, categories: null },
  { id: 'culture',       label: 'Văn hoá',              icon: Landmark,   categories: ['museum', 'heritage'] },
  { id: 'landmark',      label: 'Tham quan',            icon: MapPin,     categories: ['landmark', 'viewpoint', 'attraction'] },
  { id: 'nature',        label: 'Thiên nhiên',          icon: Leaf,       categories: ['nature'] },
  { id: 'entertainment', label: 'Giải trí',             icon: Sparkles,   categories: ['entertainment'] },
  { id: 'food',          label: 'Ẩm thực & Mua sắm',   icon: Utensils,   categories: ['food', 'shopping'] },
]

const ICON_BY_CATEGORY = {
  museum:        Landmark,
  heritage:      Landmark,
  landmark:      MapPin,
  viewpoint:     MapPin,
  attraction:    MapPin,
  nature:        Leaf,
  entertainment: Sparkles,
  food:          Utensils,
  shopping:      ShoppingBag,
}

export default function PlaceBrowser({ selectedIds = [], onToggle }) {
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeGroup, setActiveGroup] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    api.getCuratedPlaces()
      .then(setPlaces)
      .catch(() => setPlaces([]))
      .finally(() => setLoading(false))
  }, [])

  const filtered = places.filter((p) => {
    const group = CATEGORY_GROUPS.find((g) => g.id === activeGroup)
    const matchesGroup = !group?.categories || group.categories.includes(p.category)
    const matchesSearch =
      !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
    return matchesGroup && matchesSearch
  })

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm địa điểm..."
          className="pl-9"
          aria-label="Tìm địa điểm"
        />
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc theo loại">
        {CATEGORY_GROUPS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveGroup(id)}
            aria-pressed={activeGroup === id}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeGroup === id
                ? 'bg-sky-500 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2" aria-label="Đang tải địa điểm">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Không có địa điểm nào</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {filtered.map((place) => {
            const isSelected = selectedIds.includes(place.id)
            const Icon = ICON_BY_CATEGORY[place.category] ?? MapPin
            return (
              <button
                key={place.id}
                onClick={() => onToggle(place)}
                aria-pressed={isSelected}
                aria-label={place.name}
                className={`relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
                  isSelected
                    ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'
                    : 'border-slate-200 bg-white hover:border-sky-200 hover:bg-slate-50'
                }`}
              >
                {isSelected && (
                  <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500">
                    <Check className="h-2.5 w-2.5 text-white" />
                  </span>
                )}
                <Icon
                  className={`h-4 w-4 shrink-0 ${isSelected ? 'text-sky-500' : 'text-slate-400'}`}
                />
                <span
                  className={`text-xs font-medium leading-tight ${
                    isSelected ? 'text-sky-700' : 'text-slate-700'
                  }`}
                >
                  {place.name}
                </span>
                <span className="text-xs text-slate-400">~{place.dwell_minutes} phút</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
