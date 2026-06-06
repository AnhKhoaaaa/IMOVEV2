import L from 'leaflet'
import polylineCodec from '@mapbox/polyline'
import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet'
import { buildOrderedPlaces } from '../../lib/tripUtils'
import { normalizeTransportMode, transportMeta } from '../../lib/transport'

const MODE_STYLE = {
  METRO: { color: '#1d4ed8', halo: '#eff6ff', outline: '#172554', dashArray: null },
  MRT:   { color: '#4f46e5', halo: '#eef2ff', outline: '#312e81', dashArray: null },
  LRT:   { color: '#7c3aed', halo: '#f5f3ff', outline: '#4c1d95', dashArray: null },
  BUS:   { color: '#059669', halo: '#ecfdf5', outline: '#064e3b', dashArray: null },
  WALK:  { color: '#ea580c', halo: '#fff7ed', outline: '#7c2d12', dashArray: '8,8' },
  CYCLE: { color: '#0f766e', halo: '#f0fdfa', outline: '#134e4a', dashArray: '10,6' },
}
const FALLBACK_ROUTE_STYLE = { color: '#2563eb', halo: '#eff6ff', outline: '#1e3a8a', dashArray: null }

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

// Task 3b + 4b: numbered dot with optional 50% dimming
function placeIcon(category, num, dimmed = false) {
  const color = CATEGORY_DOT_COLORS[category?.toLowerCase()] ?? '#64748b'
  const numLabel = num != null
    ? `<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;line-height:1">${num}</span>`
    : ''
  const opacityStyle = dimmed ? 'opacity:0.5;' : ''
  return L.divIcon({
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28);position:relative;${opacityStyle}">${numLabel}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
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

function decodeLegPositions(leg, from, to) {
  const encoded = leg.geometries?.length ? leg.geometries : leg.geometry ? [leg.geometry] : []
  const decoded = []
  for (const geometry of encoded) {
    try {
      const segment = polylineCodec.decode(geometry)
      if (segment.length) decoded.push(...segment)
    } catch {
      // Fall through to straight-line fallback below.
    }
  }
  // Task 2: force polyline to start/end exactly on the place marker dots
  if (decoded.length >= 2) {
    decoded[0] = [from.lat, from.lng]
    decoded[decoded.length - 1] = [to.lat, to.lng]
    return decoded
  }
  return [[from.lat, from.lng], [to.lat, to.lng]]
}

function metersPerLng(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180)
}

function projectMeters(point, origin) {
  return {
    x: (point[1] - origin.lng) * metersPerLng(origin.lat),
    y: (point[0] - origin.lat) * 110540,
  }
}

function unprojectMeters(point, origin) {
  return [
    origin.lat + point.y / 110540,
    origin.lng + point.x / metersPerLng(origin.lat),
  ]
}

function trimPositionsFromUser(positions, userPosition, maxSnapMeters = 250) {
  if (!userPosition || positions.length < 2) return positions

  let best = null
  for (let i = 0; i < positions.length - 1; i++) {
    const a = projectMeters(positions[i], userPosition)
    const b = projectMeters(positions[i + 1], userPosition)
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    if (!lenSq) continue

    const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lenSq))
    const point = { x: a.x + dx * t, y: a.y + dy * t }
    const distance = Math.hypot(point.x, point.y)
    if (!best || distance < best.distance) best = { index: i, point, distance }
  }

  if (!best || best.distance > maxSnapMeters) return positions

  const snapped = unprojectMeters(best.point, userPosition)
  const remaining = [snapped, ...positions.slice(best.index + 1)]
  return remaining.length >= 2 ? remaining : positions
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

function routeStyleFor(leg) {
  return MODE_STYLE[normalizeTransportMode(leg.transport_mode)] ?? FALLBACK_ROUTE_STYLE
}

export default function TripMap({ places, legs, userPosition, activeLegId = null, trimActiveRoute = false, placeSequences = {}, activeDayPlaceIds = null, trackingPath = [] }) {
  const { ordered, byId } = useMemo(
    () => places?.length ? buildOrderedPlaces(places, legs ?? []) : { ordered: [], byId: {} },
    [places, legs]
  )
  const routeLegs = useMemo(() => (
    (legs ?? []).map((leg) => {
      const from = byId[leg.from_place_id]
      const to = byId[leg.to_place_id]
      if (!from || !to) return null
      const rawPositions = decodeLegPositions(leg, from, to)
      const positions = trimActiveRoute && userPosition && leg.id === activeLegId
        ? trimPositionsFromUser(rawPositions, userPosition)
        : rawPositions
      return { leg, from, to, positions }
    }).filter(Boolean)
  ), [legs, byId, activeLegId, trimActiveRoute, userPosition])
  const fitPositions = useMemo(
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
                  <span
                    className="inline-block h-0 w-7 border-t-[4px] border-dashed"
                    style={{
                      borderColor: style.color,
                      filter: `drop-shadow(0 0 0 ${style.outline}) drop-shadow(0 1px 1px rgba(15,23,42,.25))`,
                    }}
                  />
                ) : (
                  <span
                    className="inline-block h-2.5 w-7 rounded-full border border-white"
                    style={{
                      background: style.color,
                      boxShadow: `0 0 0 2px ${style.outline}, 0 2px 4px rgba(15,23,42,.24)`,
                    }}
                  />
                )}
                <span className="font-semibold text-slate-800">{transportMeta(mode).label}</span>
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
        <FitBounds positions={fitPositions} />

        {ordered.map((place) => (
          <Marker
            key={place.id}
            position={[place.lat, place.lng]}
            icon={placeIcon(
              place.category,
              placeSequences[place.id],
              (activeDayPlaceIds != null && !activeDayPlaceIds.has(place.id)) || (place._dim ?? false)
            )}
          >
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

        {/* Halo layer */}
        {routeLegs.map(({ leg, positions }) => {
          const style = routeStyleFor(leg)
          const isActive = trimActiveRoute && leg.id === activeLegId
          return (
            <Polyline
              key={`${leg.id}-halo`}
              positions={positions}
              color={style.halo}
              dashArray={style.dashArray}
              weight={isActive ? 14 : 12}
              opacity={0.95}
              lineCap="round"
              lineJoin="round"
            />
          )
        })}

        {/* Outline layer */}
        {routeLegs.map(({ leg, positions }) => {
          const style = routeStyleFor(leg)
          const isActive = trimActiveRoute && leg.id === activeLegId
          return (
            <Polyline
              key={`${leg.id}-outline`}
              positions={positions}
              color={style.outline}
              dashArray={style.dashArray}
              weight={isActive ? 9 : 8}
              opacity={0.72}
              lineCap="round"
              lineJoin="round"
            />
          )
        })}

        {/* Fill layer */}
        {routeLegs.map(({ leg, positions }) => {
          const style = routeStyleFor(leg)
          const isActive = trimActiveRoute && leg.id === activeLegId
          return (
            <Polyline
              key={`${leg.id}-route`}
              positions={positions}
              color={style.color}
              dashArray={style.dashArray}
              weight={isActive ? 6 : 5}
              opacity={1}
              lineCap="round"
              lineJoin="round"
            >
              <Tooltip sticky direction="top" opacity={0.96}>{legTooltip(leg)}</Tooltip>
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

        {/* Task 8c: live GPS trail for WALK/CYCLE legs */}
        {trackingPath.length >= 2 && (
          <Polyline
            positions={trackingPath}
            color="#2563eb"
            weight={5}
            opacity={0.9}
            lineCap="round"
            lineJoin="round"
          />
        )}
      </MapContainer>
    </div>
  )
}
