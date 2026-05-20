const BASE = import.meta.env.VITE_API_BASE_URL

function formatApiError(detail) {
  if (detail == null) return 'Request failed'
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg ?? d.message ?? JSON.stringify(d)).join('; ')
  }
  if (typeof detail === 'object' && detail.message) return String(detail.message)
  return JSON.stringify(detail)
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(formatApiError(err.detail) || 'Request failed')
  }
  return res.json()
}

export const api = {
  searchPlaces: (q) => request(`/places/search?q=${encodeURIComponent(q)}`),
  getCuratedPlaces: () => request('/places/curated'),
  suggestPlaces: (body) => request('/places/ai-suggest', { method: 'POST', body: JSON.stringify(body) }),
  createTrip: (body) => request('/trips', { method: 'POST', body: JSON.stringify(body) }),
  planTrip: (id, body) => request(`/trips/${id}/plan`, { method: 'POST', body: JSON.stringify(body) }),
  getTrip: (id) => request(`/trips/${id}`),
  updateLeg: (tripId, legId, body) => request(`/trips/${tripId}/legs/${legId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  adaptTrip: (id, body) => request(`/trips/${id}/adapt`, { method: 'POST', body: JSON.stringify(body) }),
}
