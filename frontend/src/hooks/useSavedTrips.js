import { useState, useCallback, useEffect } from 'react'
import { api } from '../services/api'
import { computeTripStatus } from '../lib/tripUtils'

function normalizeTripMeta(t) {
  const startDate = t.startDate ?? t.start_date ?? null
  const endDate = t.endDate ?? t.end_date ?? null
  const numDays = t.numDays ?? t.num_days ?? 1
  return {
    ...t,
    startDate,
    start_date: startDate,
    endDate,
    end_date: endDate,
    numDays,
  }
}

function enrich(raw) {
  return raw.map((t) => {
    const trip = normalizeTripMeta(t)
    return {
      ...trip,
      status: trip.confirmed === false ? 'draft' : computeTripStatus(trip.startDate, trip.numDays ?? 1),
    }
  })
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
