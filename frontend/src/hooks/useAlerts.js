import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAlerts(tripId) {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    if (!tripId) return
    const channel = supabase
      .channel('trip-alerts')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'lta_alerts',
        filter: `trip_id=eq.${tripId}`,
      }, (payload) => setAlerts((prev) => [...prev, payload.new]))
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [tripId])

  const dismiss = (alertId) => setAlerts((prev) => prev.filter((a) => a.id !== alertId))

  return { alerts, dismiss }
}
