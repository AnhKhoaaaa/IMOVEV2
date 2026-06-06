// Derives ordered place list from the legs chain.
// Places not reachable via legs are appended at the end — never silently dropped.
// Returns { ordered, byId } so callers reuse the same map without rebuilding.
export function buildOrderedPlaces(places, legs) {
  const byId = Object.fromEntries(places.map((p) => [p.id, p]))
  if (!legs.length) return { ordered: places, byId }

  const ordered = []
  const seen = new Set()

  for (const leg of legs) {
    if (!seen.has(leg.from_place_id) && byId[leg.from_place_id]) {
      seen.add(leg.from_place_id)
      ordered.push(byId[leg.from_place_id])
    }
  }
  const last = legs[legs.length - 1]
  if (last && !seen.has(last.to_place_id) && byId[last.to_place_id]) {
    seen.add(last.to_place_id)
    ordered.push(byId[last.to_place_id])
  }
  for (const place of places) {
    if (!seen.has(place.id)) ordered.push(place)
  }

  return { ordered: ordered.length ? ordered : places, byId }
}

export function buildPlacesById(places) {
  return Object.fromEntries((places ?? []).map((p) => [p.id, p]))
}

export function computeTripStatus(startDate, numDays) {
  if (!startDate) return 'draft'
  const today = new Date().toISOString().slice(0, 10)
  const endMs = new Date(startDate).getTime() + ((numDays ?? 1) - 1) * 86400000
  const end = new Date(endMs).toISOString().slice(0, 10)
  if (startDate > today) return 'upcoming'
  if (end < today) return 'past'
  return 'today'
}

// Builds a flat timeline array from a day's legs and a placesById map.
// placeIds (optional) is used to render single-place days that have no legs.
// Returns [{type:'place', data:Place, index:N} | {type:'transit', data:leg, slot:string|null}]
export function buildTimeline(legs, placesById, placeIds = []) {
  const timeline = []
  const seen = new Set()
  let placeIndex = 0

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]

    if (!seen.has(leg.from_place_id) && placesById[leg.from_place_id]) {
      seen.add(leg.from_place_id)
      placeIndex++
      timeline.push({ type: 'place', data: placesById[leg.from_place_id], index: placeIndex })
    }

    timeline.push({ type: 'transit', data: leg, slot: leg.time_slot ?? null })

    if (i === legs.length - 1 && !seen.has(leg.to_place_id) && placesById[leg.to_place_id]) {
      seen.add(leg.to_place_id)
      placeIndex++
      timeline.push({ type: 'place', data: placesById[leg.to_place_id], index: placeIndex })
    }
  }

  // Single-place day: no legs, but placeIds lists the places — show them without transit rows
  if (timeline.length === 0 && placeIds.length > 0) {
    for (const pid of placeIds) {
      if (placesById[pid]) {
        placeIndex++
        timeline.push({ type: 'place', data: placesById[pid], index: placeIndex })
      }
    }
  }

  return timeline
}

export function computeTripMetrics(tripData) {
  if (!tripData?.days) return null
  const allLegs = tripData.days.flatMap((d) => d.legs ?? [])
  const totalMin = allLegs.reduce((s, l) => s + (l.duration_minutes ?? 0), 0)
  const totalCost = allLegs.reduce((s, l) => s + (l.cost_sgd ?? 0), 0)
  const walkLegs = allLegs.filter((l) => (l.transport_mode ?? '').toUpperCase() === 'WALK')
  const walkM = walkLegs.reduce((s, l) => s + (l.duration_minutes ?? 0) * 80, 0)
  const stopsCount = tripData.places?.length ?? 0
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return {
    activeTime: h > 0 ? `${h}h ${m}m` : `${m}m`,
    transitCost: `S$${totalCost.toFixed(2)}`,
    walkingDist: walkM >= 1000 ? `${(walkM / 1000).toFixed(1)} km` : `${walkM} m`,
    stopsCount,
  }
}

export function toHHMM(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function parseHHMM(str) {
  const [h, m] = (str ?? '09:00').split(':').map(Number)
  return h * 60 + (m ?? 0)
}

/** Returns { [placeId]: { arrive: 'HH:MM', depart: 'HH:MM' } } based on leg chain + dwell times */
export function computePlaceTimes(day, placesById, startTime = '09:00') {
  const legs = day?.legs ?? []
  if (!legs.length) return {}
  let cursor = parseHHMM(startTime)
  const times = {}
  for (const leg of legs) {
    if (!times[leg.from_place_id]) {
      const dwell = placesById[leg.from_place_id]?.dwell_minutes ?? 30
      times[leg.from_place_id] = { arrive: toHHMM(cursor), depart: toHHMM(cursor + dwell) }
      cursor += dwell
    } else {
      cursor = parseHHMM(times[leg.from_place_id].depart)
    }
    cursor += leg.duration_minutes ?? 0
    if (!times[leg.to_place_id]) {
      const dwell = placesById[leg.to_place_id]?.dwell_minutes ?? 30
      times[leg.to_place_id] = { arrive: toHHMM(cursor), depart: toHHMM(cursor + dwell) }
    }
  }
  return times
}

/**
 * Haversine distance between two {lat, lng} points, in metres.
 * Used for GPS arrival detection and tracking-path sampling.
 */
export function haversineMeters(a, b) {
  const R = 6_371_000
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

export function formatDateRange(startDate, numDays) {
  if (!startDate) return null
  const start = new Date(startDate)
  const end = new Date(start.getTime() + ((numDays ?? 1) - 1) * 86400000)
  const fmt = (d) => d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric', year: 'numeric' })
  if (numDays <= 1) return fmt(start)
  return `${fmt(start)} – ${fmt(end)}`
}
