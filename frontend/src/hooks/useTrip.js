import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

export function useTrip(tripId) {
  const [trip, setTrip] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!tripId) return
    let ignore = false
    setTrip(null)
    setError(null)
    setLoading(true)
    api.getTrip(tripId)
      .then((data) => { if (!ignore) setTrip(data) })
      .catch((e) => { if (!ignore) setError(e) })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [tripId])

  const refresh = useCallback(() =>
    api.getTrip(tripId).then(setTrip).catch(setError),
    [tripId]
  )

  return { trip, loading, error, refresh }
}
