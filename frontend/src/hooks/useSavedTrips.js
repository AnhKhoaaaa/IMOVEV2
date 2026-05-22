import { useState, useCallback, useEffect } from 'react'
import { api } from '../services/api'
import { computeTripStatus } from '../lib/tripUtils'

export function useSavedTrips() {
  const [trips, setTrips] = useState([])

  const reload = useCallback(() => {
    const raw = api.getSavedTrips()
    const enriched = raw.map((t) => ({
      ...t,
      status: computeTripStatus(t.startDate, t.numDays ?? 1),
    }))
    setTrips(enriched)
  }, [])

  useEffect(() => { reload() }, [reload])

  const save = useCallback((tripId, meta) => {
    api.saveTrip(tripId, meta)
    reload()
  }, [reload])

  const remove = useCallback((tripId) => {
    api.deleteSavedTrip(tripId)
    reload()
  }, [reload])

  return { trips, save, remove, reload }
}
