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

export function computeTripStatus(startDate, numDays, isDraft = false) {
  if (isDraft) return 'draft'
  if (!startDate) return 'draft'
  const today = new Date().toISOString().slice(0, 10)
  const endMs = new Date(startDate).getTime() + ((numDays ?? 1) - 1) * 86400000
  const end = new Date(endMs).toISOString().slice(0, 10)
  if (startDate > today) return 'upcoming'
  if (end < today) return 'past'
  return 'today'
}

// Builds a flat timeline array from a day's legs and a placesById map.
// Returns [{type:'place', data:Place, index:N} | {type:'transit', data:leg, slot:string|null}]
export function buildTimeline(legs, placesById) {
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

export function formatDateRange(startDate, numDays) {
  if (!startDate) return null
  const start = new Date(startDate)
  const end = new Date(start.getTime() + ((numDays ?? 1) - 1) * 86400000)
  const fmt = (d) => d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric', year: 'numeric' })
  if (numDays <= 1) return fmt(start)
  return `${fmt(start)} – ${fmt(end)}`
}
