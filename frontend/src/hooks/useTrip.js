import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../services/api'

export function useTrip(tripId, userId = null) {
  const [trip, setTrip] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [isOffline, setIsOffline] = useState(false)

  // Track latest userId without triggering a re-fetch when it changes.
  // Cache writes/reads always use the most up-to-date value.
  const userIdRef = useRef(userId)
  userIdRef.current = userId

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
          api.cacheTripData(tripId, data, userIdRef.current)
        }
      })
      .catch(() => {
        if (!ignore) {
          const cached = api.getCachedTripData(tripId, userIdRef.current)
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
        api.cacheTripData(tripId, data, userIdRef.current)
      })
      .catch(() => {
        const cached = api.getCachedTripData(tripId, userIdRef.current)
        if (cached) { setTrip(cached); setIsOffline(true) }
      }),
    [tripId]
  )

  return { trip, loading, error, refresh, isOffline }
}
