import { useState, useCallback, useEffect } from 'react'
import { api } from '../services/api'
import { computeTripStatus } from '../lib/tripUtils'

export function useSavedTrips(userId = null) {
  const [trips, setTrips] = useState([])

  const reload = useCallback(() => {
    const raw = api.getSavedTrips(userId)
    const enriched = raw.map((t) => ({
      ...t,
      status: computeTripStatus(t.startDate, t.numDays ?? 1),
    }))
    setTrips(enriched)
  }, [userId])

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
