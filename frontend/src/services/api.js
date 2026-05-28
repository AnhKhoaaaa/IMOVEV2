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
  if (res.status === 204) return null
  return res.json()
}

const tripsKey = (userId) => userId ? `imove_trips_${userId}` : 'imove_trips_guest'
const tripDataKey = (userId) => userId ? `imove_trip_data_${userId}` : 'imove_trip_data_guest'

export const api = {
  searchPlaces: (q) => request(`/places/search?q=${encodeURIComponent(q)}`),
  getCuratedPlaces: () => request('/places/curated'),
  createTrip: (body) => request('/trips', { method: 'POST', body: JSON.stringify(body) }),
  planTrip: (id, body) => request(`/trips/${id}/plan`, { method: 'POST', body: JSON.stringify(body) }),
  getTrip: (id) => request(`/trips/${id}`),
  deleteTrip: (id) => request(`/trips/${id}`, { method: 'DELETE' }),
  updateLeg: (tripId, legId, body) => request(`/trips/${tripId}/legs/${legId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  adaptTrip: (id, body) => request(`/trips/${id}/adapt`, { method: 'POST', body: JSON.stringify(body) }),
  acceptSwap: (id, body) => request(`/trips/${id}/accept-swap`, { method: 'POST', body: JSON.stringify(body) }),
  updateLocation: (id, body) => request(`/trips/${id}/location`, { method: 'POST', body: JSON.stringify(body) }),
  optimizeRoute: (id) => request(`/trips/${id}/optimize`, { method: 'POST' }),
  addPlaceToDay: (id, body) => request(`/trips/${id}/places`, { method: 'POST', body: JSON.stringify(body) }),
  removePlaceFromDay: (id, placeId) => request(`/trips/${id}/places/${placeId}`, { method: 'DELETE' }),
  reorderPlaces: (id, day, placeIds) => request(`/trips/${id}/reorder`, { method: 'PATCH', body: JSON.stringify({ day, place_ids: placeIds }) }),
  getBusArrivals: (stopCode) => request(`/transit/bus-arrivals/${encodeURIComponent(stopCode)}`),
  compareRoutes: (fromLat, fromLng, toLat, toLng) =>
    request(`/transit/compare?from_lat=${fromLat}&from_lng=${fromLng}&to_lat=${toLat}&to_lng=${toLng}`),

  // localStorage trip metadata helpers — per-user isolated via userId key suffix
  saveTrip(tripId, meta, userId) {
    try {
      const key = tripsKey(userId)
      const raw = localStorage.getItem(key)
      const trips = raw ? JSON.parse(raw) : []
      const idx = trips.findIndex((t) => t.id === tripId)
      const entry = { id: tripId, ...meta, savedAt: new Date().toISOString() }
      if (idx >= 0) trips[idx] = entry
      else trips.unshift(entry)
      localStorage.setItem(key, JSON.stringify(trips))
    } catch { /* ignore storage errors */ }
  },

  getSavedTrips(userId) {
    try {
      const raw = localStorage.getItem(tripsKey(userId))
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  },

  deleteSavedTrip(tripId, userId) {
    try {
      const key = tripsKey(userId)
      const raw = localStorage.getItem(key)
      const trips = raw ? JSON.parse(raw) : []
      localStorage.setItem(key, JSON.stringify(trips.filter((t) => t.id !== tripId)))
    } catch { /* ignore */ }
  },

  // Full trip data cache — written on every successful fetch, read as offline fallback
  cacheTripData(tripId, data, userId) {
    try {
      const key = tripDataKey(userId)
      const raw = localStorage.getItem(key)
      const cache = raw ? JSON.parse(raw) : {}
      cache[tripId] = data
      localStorage.setItem(key, JSON.stringify(cache))
    } catch { /* ignore storage errors */ }
  },

  getCachedTripData(tripId, userId) {
    try {
      const raw = localStorage.getItem(tripDataKey(userId))
      const cache = raw ? JSON.parse(raw) : {}
      return cache[tripId] ?? null
    } catch { return null }
  },
}
