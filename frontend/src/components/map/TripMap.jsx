import L from 'leaflet'
import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet'
import { buildOrderedPlaces } from '../../lib/tripUtils'

const MODE_STYLE = {
  MRT:   { color: '#6366f1', dashArray: null },
  LRT:   { color: '#7c3aed', dashArray: null },
  BUS:   { color: '#10b981', dashArray: null },
  WALK:  { color: '#f97316', dashArray: '5,5' },
  DRIVE: { color: '#8b5cf6', dashArray: null },
  CYCLE: { color: '#0d9488', dashArray: '8,4' },
}

// Coerce to safe integer to prevent HTML injection via L.divIcon template string.
function numberIcon(n) {
  const safe = String(Math.trunc(Number(n)))
  return L.divIcon({
    html: `<div style="background:#6366f1;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 2px 6px rgba(99,102,241,0.4)">${safe}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    className: '',
  })
}

function userIcon() {
  return L.divIcon({
    html: `<div style="width:18px;height:18px;border-radius:50%;background:#10b981;border:3px solid #fff;box-shadow:0 0 0 4px rgba(16,185,129,0.2)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    className: '',
  })
}

function legTooltip(leg) {
  const parts = [leg.transport_mode, `${leg.duration_minutes} min`]
  if (leg.cost_sgd != null) parts.push(`S$${leg.cost_sgd.toFixed(2)}`)
  if (leg.is_estimated) parts.push('(estimated)')
  return parts.join(' · ')
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

export default function TripMap({ places, legs, userPosition }) {
  const { ordered, byId } = useMemo(
    () => places?.length ? buildOrderedPlaces(places, legs ?? []) : { ordered: [], byId: {} },
    [places, legs]
  )
  const allPositions = useMemo(
    () => ordered.map((p) => [p.lat, p.lng]),
    [ordered]
  )

  if (!places?.length) return (
    <div className="h-full w-full rounded-2xl bg-slate-100 animate-pulse" aria-hidden="true" />
  )

  const center = [ordered[0].lat, ordered[0].lng]

  return (
    <div className="h-full w-full rounded-2xl overflow-hidden border border-slate-200 shadow-card relative">
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
              Dwell: {place.dwell_minutes} min<br />
              {place.best_time_start && `Best: ${place.best_time_start}–${place.best_time_end}`}
            </Popup>
          </Marker>
        ))}

        {(legs ?? []).map((leg) => {
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

        {userPosition && (
          <Marker
            position={[userPosition.lat, userPosition.lng]}
            icon={userIcon()}
          >
            <Popup>Your current location</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}
