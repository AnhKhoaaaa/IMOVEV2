import { useState, useCallback } from 'react'

export function useGeolocation() {
  const [position, setPosition] = useState(null)  // { lat, lng }
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported')
      return
    }
    setLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLoading(false)
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
      { timeout: 8000, maximumAge: 60000 }
    )
  }, [])

  return { position, error, loading, request }
}
