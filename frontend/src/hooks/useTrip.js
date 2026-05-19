import { useState, useEffect } from 'react'
import { api } from '../services/api'

export function useTrip(tripId) {
  const [trip, setTrip] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!tripId) return
    setLoading(true)
    api.getTrip(tripId)
      .then(setTrip)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [tripId])

  const refresh = () => api.getTrip(tripId).then(setTrip).catch(setError)

  return { trip, loading, error, refresh }
}
