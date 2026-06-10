import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Keep only the most recent alert per (type, line, day) to prevent duplicates when
// checkAlerts runs repeatedly — day_number keeps per-day weather warnings distinct so
// Day 1 and Day 2 rain alerts don't overwrite each other.
function dedupe(list) {
  const byKey = new Map()
  for (const a of list) {
    const key = `${a.alert_type}:${a.affected_line ?? 'unknown'}:${a.day_number ?? 'all'}`
    const cur = byKey.get(key)
    if (!cur || a.id > cur.id) byKey.set(key, a)
  }
  return [...byKey.values()]
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
