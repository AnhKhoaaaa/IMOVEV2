import { useEffect, useRef } from 'react'
import { api } from '../services/api'

// dev25 P5 — live GPS companion. While the chat is active and we have the user's REAL position,
// poll the companion endpoint; the backend returns a warm rain nudge only when it's raining near
// an upcoming outdoor stop (else null → we stay quiet). Each distinct nudge fires onNudge once;
// the backend already dedupes within the weather_live window, this guards client re-posts.
const POLL_MS = 4 * 60 * 1000  // 4 minutes

export function useLiveCompanion({ enabled, sessionId, tripId, gps, lang, onNudge }) {
  const seenRef = useRef(new Set())
  // Latest values via refs so GPS movement / lang change doesn't restart the poll interval.
  const onNudgeRef = useRef(onNudge)
  const gpsRef = useRef(gps)
  const langRef = useRef(lang)
  onNudgeRef.current = onNudge
  gpsRef.current = gps
  langRef.current = lang

  const hasGps = !!(gps && gps.lat != null && gps.lng != null)

  useEffect(() => {
    if (!enabled || !tripId || !sessionId || !hasGps) return
    let cancelled = false

    const check = async () => {
      const g = gpsRef.current
      if (!g || g.lat == null) return
      try {
        const res = await api.companionCheck({
          session_id: sessionId, trip_id: tripId, gps: g, lang: langRef.current,
        })
        const nudge = res && res.nudge
        if (cancelled || !nudge || !nudge.text) return
        const id = nudge.alert_id || nudge.text
        if (seenRef.current.has(id)) return
        seenRef.current.add(id)
        onNudgeRef.current && onNudgeRef.current(nudge.text, id)
      } catch { /* best-effort — companion never blocks the chat */ }
    }

    check()                                    // check once on (re)activation
    const timer = setInterval(check, POLL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [enabled, sessionId, tripId, hasGps])
}
