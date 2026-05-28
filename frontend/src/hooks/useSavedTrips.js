import { useState, useCallback, useEffect } from 'react'
import { api } from '../services/api'
import { computeTripStatus } from '../lib/tripUtils'

function enrich(raw) {
  return raw.map((t) => ({
    ...t,
    status: computeTripStatus(t.startDate, t.numDays ?? 1),
  }))
}

export function useSavedTrips(userId = null) {
  // Initialize synchronously from localStorage to avoid a flash of empty state.
  const [trips, setTrips] = useState(() => enrich(api.getSavedTrips(userId)))

  const reload = useCallback(() => {
    setTrips(enrich(api.getSavedTrips(userId)))
  }, [userId])

  // Re-load whenever userId changes (e.g. auth state resolves after mount).
  useEffect(() => { reload() }, [reload])

  const save = useCallback((tripId, meta) => {
    api.saveTrip(tripId, meta, userId)
    reload()
  }, [reload, userId])

  const remove = useCallback((tripId) => {
    api.deleteSavedTrip(tripId, userId)
    reload()
  }, [reload, userId])

  return { trips, save, remove, reload }
}
