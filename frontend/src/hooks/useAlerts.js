import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAlerts(tripId) {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    if (!tripId || !supabase) return

    supabase.from('lta_alerts').select('*').eq('trip_id', tripId).is('resolved_at', null)
      .then(({ data, error }) => { if (!error && data) setAlerts(data) })
      .catch(() => {})

    const channel = supabase
      .channel(`trip-alerts-${tripId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'lta_alerts',
        filter: `trip_id=eq.${tripId}`,
      }, (payload) => setAlerts((prev) => [...prev, payload.new]))
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'lta_alerts',
        filter: `trip_id=eq.${tripId}`,
      }, (payload) => {
        setAlerts((prev) => (
          payload.new?.resolved_at
            ? prev.filter((a) => a.id !== payload.new.id)
            : prev.map((a) => (a.id === payload.new.id ? payload.new : a))
        ))
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [tripId])

  const dismiss = (alertId) => setAlerts((prev) => prev.filter((a) => a.id !== alertId))

  return { alerts, dismiss }
}
