import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../services/api'

export function useTrip(tripId) {
  const [trip, setTrip] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

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

  const refresh = useCallback(async () => {
    if (!tripId) return
    setLoading(true)
    try {
      const data = await api.getTrip(tripId)
      if (isMounted.current) setTrip(data)
    } catch (e) {
      if (isMounted.current) setError(e)
    } finally {
      if (isMounted.current) setLoading(false)
    }
  }, [tripId])

  return { trip, loading, error, refresh }
}
