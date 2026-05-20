import L from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet'

const MODE_STYLE = {
  MRT:   { color: '#ef4444', dashArray: null },
  BUS:   { color: '#22c55e', dashArray: null },
  WALK:  { color: '#f97316', dashArray: '5,5' },
  DRIVE: { color: '#3b82f6', dashArray: null },
  CYCLE: { color: '#3b82f6', dashArray: null },
}

function numberIcon(n) {
  return L.divIcon({
    html: `<div style="background:#2563eb;color:#fff;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    className: '',
  })
}

function legTooltip(leg) {
  const parts = [leg.transport_mode, `${leg.duration_minutes} phút`]
  if (leg.cost_sgd != null) parts.push(`SGD ${leg.cost_sgd.toFixed(2)}`)
  if (leg.is_estimated) parts.push('(ước tính)')
  return parts.join(' · ')
}

// Derive ordered place list from legs chain (from_place_id → to_place_id).
// Falls back to original places array when legs is empty.
function buildOrderedPlaces(places, legs) {
  if (!legs?.length) return places
  const byId = Object.fromEntries(places.map((p) => [p.id, p]))
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
    ordered.push(byId[last.to_place_id])
  }
  return ordered.length ? ordered : places
}

function FitBounds({ positions }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length >= 2) {
      map.fitBounds(positions, { padding: [40, 40] })
    } else if (positions.length === 1) {
      map.setView(positions[0], 15)
    }
  }, [map, positions])
  return null
}

export default function TripMap({ places, legs }) {
  if (!places?.length) return null

  const ordered = buildOrderedPlaces(places, legs ?? [])
  const byId = Object.fromEntries(places.map((p) => [p.id, p]))
  const center = [ordered[0].lat, ordered[0].lng]
  const allPositions = ordered.map((p) => [p.lat, p.lng])

  return (
    <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <FitBounds positions={allPositions} />

      {ordered.map((place, i) => (
        <Marker key={place.id} position={[place.lat, place.lng]} icon={numberIcon(i + 1)}>
          <Popup>
            <strong>{place.name}</strong><br />
            Dwell: {place.dwell_minutes} phút<br />
            Tốt nhất: {place.best_time_start}–{place.best_time_end}
          </Popup>
        </Marker>
      ))}

      {legs?.map((leg) => {
        const from = byId[leg.from_place_id]
        const to = byId[leg.to_place_id]
        if (!from || !to) return null
        const style = MODE_STYLE[leg.transport_mode] ?? MODE_STYLE.DRIVE
        return (
          <Polyline
            key={leg.id}
            positions={[[from.lat, from.lng], [to.lat, to.lng]]}
            color={style.color}
            dashArray={style.dashArray}
            weight={3}
          >
            <Tooltip sticky>{legTooltip(leg)}</Tooltip>
          </Polyline>
        )
      })}
    </MapContainer>
  )
}
