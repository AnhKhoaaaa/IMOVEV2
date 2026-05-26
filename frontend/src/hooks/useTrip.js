import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

export function useTrip(tripId) {
  const [trip, setTrip] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [isOffline, setIsOffline] = useState(false)

  useEffect(() => {
    if (!tripId) return
    let ignore = false
    setTrip(null)
    setError(null)
    setIsOffline(false)
    setLoading(true)
    api.getTrip(tripId)
      .then((data) => {
        if (!ignore) {
          setTrip(data)
          setIsOffline(false)
          api.cacheTripData(tripId, data)
        }
      })
      .catch(() => {
        if (!ignore) {
          const cached = api.getCachedTripData(tripId)
          if (cached) {
            setTrip(cached)
            setIsOffline(true)
          } else {
            setError(new Error('Network error — no cached data available'))
          }
        }
      })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [tripId])

  const refresh = useCallback(() =>
    api.getTrip(tripId)
      .then((data) => {
        setTrip(data)
        setIsOffline(false)
        api.cacheTripData(tripId, data)
      })
      .catch(() => {
        const cached = api.getCachedTripData(tripId)
        if (cached) { setTrip(cached); setIsOffline(true) }
      }),
    [tripId]
  )

  return { trip, loading, error, refresh, isOffline }
}
