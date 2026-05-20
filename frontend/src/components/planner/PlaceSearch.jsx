import { useState, useEffect } from 'react'
import { Search, Plus, MapPin } from 'lucide-react'
import { api } from '../../services/api'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Alert, AlertDescription } from '../ui/alert'

export default function PlaceSearch({ onAdd }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searchError, setSearchError] = useState(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const timer = setTimeout(async () => {
      try {
        setSearchError(null)
        setSearching(true)
        const data = await api.searchPlaces(query)
        setResults(data)
      } catch (e) {
        setSearchError(e.message)
      } finally {
        setSearching(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm địa điểm..."
          className="pl-9"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
          </div>
        )}
      </div>

      {searchError && (
        <Alert variant="destructive">
          <AlertDescription>{searchError}</AlertDescription>
        </Alert>
      )}

      {results.length > 0 && (
        <ul className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden divide-y divide-slate-100">
          {results.map((place) => (
            <li key={place.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                <span className="text-sm text-slate-700 truncate">{place.name}</span>
                {!place.in_curated_dataset && (
                  <Badge variant="warning" className="shrink-0">Thiếu dữ liệu</Badge>
                )}
              </div>
              <Button
                size="sm"
                variant={place.in_curated_dataset ? 'default' : 'secondary'}
                disabled={!place.in_curated_dataset}
                onClick={() => onAdd(place)}
                className="ml-2 shrink-0 h-7 px-2 gap-1"
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}

      {query.trim() && !searching && results.length === 0 && !searchError && (
        <p className="text-center text-sm text-slate-400 py-3">
          Không tìm thấy địa điểm nào cho &quot;{query}&quot;
        </p>
      )}
    </div>
  )
}
