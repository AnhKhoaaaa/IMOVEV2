import L from 'leaflet'
import polylineCodec from '@mapbox/polyline'
import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet'
import { buildOrderedPlaces } from '../../lib/tripUtils'
import { normalizeTransportMode, transportMeta } from '../../lib/transport'

const MODE_STYLE = {
  METRO: { color: '#2563eb', dashArray: null },
  MRT:   { color: '#6366f1', dashArray: null },
  LRT:   { color: '#7c3aed', dashArray: null },
  BUS:   { color: '#10b981', dashArray: null },
  WALK:  { color: '#f97316', dashArray: '5,5' },
  CYCLE: { color: '#0d9488', dashArray: '8,4' },
}

const CATEGORY_DOT_COLORS = {
  food:          '#f97316',
  dining:        '#f97316',
  nature:        '#10b981',
  park:          '#10b981',
  culture:       '#7c3aed',
  heritage:      '#7c3aed',
  museum:        '#7c3aed',
  shopping:      '#3b82f6',
  landmark:      '#6366f1',
  attraction:    '#6366f1',
  entertainment: '#f43f5e',
  beach:         '#0d9488',
}

function categoryIcon(category) {
  const color = CATEGORY_DOT_COLORS[category?.toLowerCase()] ?? '#64748b'
  return L.divIcon({
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
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
  const presentModes = useMemo(
    () => [...new Set((legs ?? []).map((l) => normalizeTransportMode(l.transport_mode)).filter((m) => m && MODE_STYLE[m]))],
    [legs]
  )

  if (!places?.length) return (
    <div className="h-full w-full rounded-2xl bg-slate-100 animate-pulse" aria-hidden="true" />
  )

  const center = [ordered[0].lat, ordered[0].lng]

  return (
    <div className="h-full w-full rounded-2xl overflow-hidden border border-slate-200 shadow-card relative">
      {presentModes.length > 0 && (
        <div className="absolute bottom-6 left-2 z-[400] bg-white/90 rounded-lg shadow-sm text-xs p-2 space-y-1 pointer-events-none">
          {presentModes.map((mode) => {
            const style = MODE_STYLE[mode]
            return (
              <div key={mode} className="flex items-center gap-1.5">
                {style.dashArray ? (
                  <span className="inline-block w-5 h-0 border-t-2 border-dashed" style={{ borderColor: style.color }} />
                ) : (
                  <span className="inline-block w-5 h-1.5 rounded-full" style={{ background: style.color }} />
                )}
                <span className="text-slate-700">{transportMeta(mode).label}</span>
              </div>
            )
          })}
        </div>
      )}
      <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <FitBounds positions={allPositions} />

        {ordered.map((place) => (
          <Marker key={place.id} position={[place.lat, place.lng]} icon={categoryIcon(place.category)}>
            <Popup minWidth={200} maxWidth={240}>
              {place.image_url && (
                <img
                  src={place.image_url}
                  alt=""
                  style={{ height: 110, objectFit: 'cover', display: 'block', margin: '-13px -20px 10px', width: 'calc(100% + 40px)' }}
                  onError={(e) => { e.currentTarget.style.display = 'none' }}
                />
              )}
              <div style={{ padding: '0 2px 2px' }}>
                <p style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', margin: '0 0 3px' }}>{place.name}</p>
                {place.category && (
                  <p style={{ fontSize: 11, color: '#6366f1', fontWeight: 600, margin: '0 0 4px', textTransform: 'capitalize' }}>
                    {place.category}
                  </p>
                )}
                {place.dwell_minutes > 0 && (
                  <p style={{ fontSize: 12, color: '#475569', margin: '0 0 2px' }}>⏱ {place.dwell_minutes} min visit</p>
                )}
                {place.best_time_start && (
                  <p style={{ fontSize: 12, color: '#92400e', margin: 0 }}>☀ Best: {place.best_time_start}–{place.best_time_end}</p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

        {(legs ?? []).map((leg) => {
          const from = byId[leg.from_place_id]
          const to = byId[leg.to_place_id]
          if (!from || !to) return null
          const style = MODE_STYLE[normalizeTransportMode(leg.transport_mode)] ?? MODE_STYLE.METRO
          // Decode real polyline when available; fall back to straight line
          let positions
          try {
            positions = leg.geometry
              ? polylineCodec.decode(leg.geometry)
              : [[from.lat, from.lng], [to.lat, to.lng]]
          } catch {
            positions = [[from.lat, from.lng], [to.lat, to.lng]]
          }
          return (
            <Polyline
              key={leg.id}
              positions={positions}
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
