import { useState } from 'react'
import { api } from '../../services/api'

export default function PlaceSearch({ onAdd }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])

  const search = async () => {
    const data = await api.searchPlaces(query)
    setResults(data)
  }

  return (
    <div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search places..." />
      <button onClick={search}>Search</button>
      <ul>
        {results.map((place) => (
          <li key={place.id}>
            {place.name}
            {!place.in_curated && <span> [Thiếu dữ liệu]</span>}
            <button onClick={() => onAdd(place)}>Add</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
