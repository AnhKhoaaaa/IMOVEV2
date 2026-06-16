import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'

function isAuthError(error) {
  return error?.status === 401 || error?.status === 403
}

export function useTrip(tripId, userId = null) {
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
          api.cacheTripData(tripId, data, userId)
        }
      })
      .catch((err) => {
        if (ignore) return
        if (isAuthError(err)) {
          setTrip(null)
          setError(err)
          setIsOffline(false)
          return
        }

        const cached = api.getCachedTripData(tripId, userId)
        if (cached) {
          setTrip(cached)
          setIsOffline(true)
        } else {
          setError(new Error('Network error - no cached data available'))
        }
      })
      .finally(() => { if (!ignore) setLoading(false) })

    return () => { ignore = true }
  }, [tripId, userId])

  const refresh = useCallback((preloaded) => {
    if (preloaded && Array.isArray(preloaded.days)) {
      setTrip(preloaded)
      setError(null)
      setIsOffline(false)
      api.cacheTripData(tripId, preloaded, userId)
      return Promise.resolve(preloaded)
    }

    return api.getTrip(tripId)
      .then((data) => {
        setTrip(data)
        setError(null)
        setIsOffline(false)
        api.cacheTripData(tripId, data, userId)
        return data
      })
      .catch((err) => {
        if (isAuthError(err)) {
          setTrip(null)
          setError(err)
          setIsOffline(false)
          return null
        }

        const cached = api.getCachedTripData(tripId, userId)
        if (cached) {
          setTrip(cached)
          setIsOffline(true)
          return cached
        }
        return null
      })
  }, [tripId, userId])

  return { trip, loading, error, refresh, isOffline }
}
