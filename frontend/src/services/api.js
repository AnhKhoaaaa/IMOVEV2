// Empty string → Vite dev proxy handles routing (no CORS issues)
// Set VITE_API_BASE_URL=https://your-backend.com for production
const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  return res.json()
}

const TRIPS_KEY = 'imove_trips'
const TRIP_DATA_KEY = 'imove_trip_data'

export const api = {
  searchPlaces: (q) => request(`/places/search?q=${encodeURIComponent(q)}`),
  getCuratedPlaces: () => request('/places/curated'),
  createTrip: (body) => request('/trips', { method: 'POST', body: JSON.stringify(body) }),
  planTrip: (id, body) => request(`/trips/${id}/plan`, { method: 'POST', body: JSON.stringify(body) }),
  getTrip: (id) => request(`/trips/${id}`),
  updateLeg: (tripId, legId, body) => request(`/trips/${tripId}/legs/${legId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  adaptTrip: (id, body) => request(`/trips/${id}/adapt`, { method: 'POST', body: JSON.stringify(body) }),
  acceptSwap: (id, body) => request(`/trips/${id}/accept-swap`, { method: 'POST', body: JSON.stringify(body) }),
  updateLocation: (id, body) => request(`/trips/${id}/location`, { method: 'POST', body: JSON.stringify(body) }),

  // localStorage trip metadata helpers (no backend calls)
  saveTrip(tripId, meta) {
    try {
      const raw = localStorage.getItem(TRIPS_KEY)
      const trips = raw ? JSON.parse(raw) : []
      const idx = trips.findIndex((t) => t.id === tripId)
      const entry = { id: tripId, ...meta, savedAt: new Date().toISOString() }
      if (idx >= 0) trips[idx] = entry
      else trips.unshift(entry)
      localStorage.setItem(TRIPS_KEY, JSON.stringify(trips))
    } catch { /* ignore storage errors */ }
  },

  getSavedTrips() {
    try {
      const raw = localStorage.getItem(TRIPS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  },

  deleteSavedTrip(tripId) {
    try {
      const raw = localStorage.getItem(TRIPS_KEY)
      const trips = raw ? JSON.parse(raw) : []
      localStorage.setItem(TRIPS_KEY, JSON.stringify(trips.filter((t) => t.id !== tripId)))
    } catch { /* ignore */ }
  },

  // Full trip data cache — written on every successful fetch, read as offline fallback (§5)
  cacheTripData(tripId, data) {
    try {
      const raw = localStorage.getItem(TRIP_DATA_KEY)
      const cache = raw ? JSON.parse(raw) : {}
      cache[tripId] = data
      localStorage.setItem(TRIP_DATA_KEY, JSON.stringify(cache))
    } catch { /* ignore storage errors */ }
  },

  getCachedTripData(tripId) {
    try {
      const raw = localStorage.getItem(TRIP_DATA_KEY)
      const cache = raw ? JSON.parse(raw) : {}
      return cache[tripId] ?? null
    } catch { return null }
  },
}
