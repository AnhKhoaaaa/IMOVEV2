import { useState, useEffect, useRef } from 'react'

export function useGeolocation() {
  const [position, setPosition] = useState(null)  // { lat, lng }
  const [error, setError] = useState(null)
  const watchRef = useRef(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported')
      return
    }
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setError(err.message),
      { timeout: 10000, maximumAge: 5000, enableHighAccuracy: true }
    )
    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    }
  }, [])

  return { position, error }
}
