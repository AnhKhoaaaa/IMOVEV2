import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Keep only the most recent alert per alert_type to prevent duplicates
// when checkAlerts is called multiple times.
function dedupe(list) {
  const byType = new Map()
  for (const a of list) {
    const cur = byType.get(a.alert_type)
    if (!cur || a.id > cur.id) byType.set(`${a.alert_type}:${a.affected_line ?? 'unknown'}`, a)
  }
  return [...byType.values()]
}

export function useAlerts(tripId) {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    if (!tripId) return
    let ignore = false

    supabase.from('lta_alerts').select('*').eq('trip_id', tripId).is('resolved_at', null)
      .then(({ data, error }) => {
        if (ignore) return
        if (error) { console.error('useAlerts: initial fetch failed', error); return }
        if (data) setAlerts(dedupe(data))
      })

    const channel = supabase
      .channel(`trip-alerts-${tripId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'lta_alerts',
        filter: `trip_id=eq.${tripId}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          if (!payload.new.resolved_at) setAlerts((prev) => dedupe([...prev, payload.new]))
        } else if (payload.eventType === 'UPDATE') {
          if (payload.new.resolved_at) {
            setAlerts((prev) => prev.filter((a) => a.id !== payload.new.id))
          }
        } else if (payload.eventType === 'DELETE') {
          setAlerts((prev) => prev.filter((a) => a.id !== payload.old.id))
        }
      })
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
