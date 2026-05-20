import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useAlerts(tripId) {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    if (!tripId) return
    let ignore = false

    supabase.from('lta_alerts').select('*').eq('trip_id', tripId)
      .then(({ data, error }) => {
        if (ignore) return
        if (error) { console.error('useAlerts: initial fetch failed', error); return }
        if (data) setAlerts(data)
      })

    const channel = supabase
      .channel(`trip-alerts-${tripId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'lta_alerts',
        filter: `trip_id=eq.${tripId}`,
      }, (payload) => setAlerts((prev) => [...prev, payload.new]))
      .subscribe()

    return () => {
      ignore = true
      supabase.removeChannel(channel)
    }
  }, [tripId])

  const dismiss = useCallback(
    (alertId) => setAlerts((prev) => prev.filter((a) => a.id !== alertId)),
    []
  )

  return { alerts, dismiss }
}
