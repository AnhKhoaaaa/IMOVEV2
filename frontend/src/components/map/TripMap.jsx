import React, { useEffect, useMemo } from 'react'
import L from 'leaflet'
import polylineCodec from '@mapbox/polyline'
import { MapContainer, TileLayer, Marker, Popup, Polyline, Tooltip, useMap } from 'react-leaflet'
import { buildOrderedPlaces } from '../../lib/tripUtils'
import { normalizeTransportMode, transportMeta } from '../../lib/transport'

const MODE_STYLE = {
  METRO: { color: '#2563eb', dashArray: null },
  MRT:   { color: '#6366f1', dashArray: null },
  LRT:   { color: '#7c3aed', dashArray: null },
  BUS:   { color: '#10b981', dashArray: null },
  WALK:  { color: '#f97316', dashArray: '4,8' },
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

function placeIcon(category, index, dimmed) {
  const color = dimmed
    ? '#cbd5e1'
    : (CATEGORY_DOT_COLORS[category?.toLowerCase()] ?? '#64748b')
  const textColor = dimmed ? '#94a3b8' : '#fff'
  const shadow = dimmed ? '0.08' : '0.28'
  const label = dimmed ? '' : String(index + 1)
  return L.divIcon({
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,${shadow});display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${textColor}">${label}</div>`,
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

export default function TripMap({ places, legs, userPosition, activeLegId, dayGroups, activeDayNum }) {
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
      {/* Legend */}
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

        {/* Place markers — numbered, dimmed for non-active day */}
        {ordered.map((place, idx) => {
          const isDimmed = activeDayNum != null
            && dayGroups != null
            && dayGroups[place.id] != null
            && dayGroups[place.id] !== activeDayNum
          return (
            <Marker key={place.id} position={[place.lat, place.lng]} icon={placeIcon(place.category, idx, isDimmed)}>
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
          )
        })}

        {/* Route polylines — glow layer for active leg + main line for all */}
        {(legs ?? []).map((leg) => {
          const from = byId[leg.from_place_id]
          const to   = byId[leg.to_place_id]
          if (!from || !to) return null
          const norm    = normalizeTransportMode(leg.transport_mode)
          const style   = MODE_STYLE[norm] ?? MODE_STYLE.METRO
          const isWalk   = norm === 'WALK'
          const isActive = leg.id != null && leg.id === activeLegId
          let positions
          try {
            positions = leg.geometry
              ? polylineCodec.decode(leg.geometry)
              : [[from.lat, from.lng], [to.lat, to.lng]]
          } catch {
            positions = [[from.lat, from.lng], [to.lat, to.lng]]
          }
          return (
            <React.Fragment key={leg.id}>
              {isActive && (
                <Polyline
                  positions={positions}
                  color={style.color}
                  weight={16}
                  opacity={0.2}
                  className="active-route-glow"
                />
              )}
              <Polyline
                positions={positions}
                color={style.color}
                dashArray={isActive ? null : (style.dashArray ?? null)}
                weight={isActive ? 6 : (isWalk ? 3 : 5)}
                opacity={isActive ? 1 : 0.75}
              >
                <Tooltip sticky>{legTooltip(leg)}</Tooltip>
              </Polyline>
            </React.Fragment>
          )
        })}

        {/* User position marker */}
        {userPosition && (
          <Marker position={[userPosition.lat, userPosition.lng]} icon={userIcon()}>
            <Popup>Your current location</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}
