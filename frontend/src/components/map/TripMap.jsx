import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'

export default function TripMap({ places }) {
  if (!places?.length) return null
  const center = [places[0].lat, places[0].lng]
  const positions = places.map((p) => [p.lat, p.lng])

  return (
    <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {places.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]}>
          <Popup>
            <strong>{p.name}</strong><br />
            Dwell: {p.dwell_minutes} min<br />
            Best time: {p.best_time_start}–{p.best_time_end}
          </Popup>
        </Marker>
      ))}
      <Polyline positions={positions} color="blue" />
    </MapContainer>
  )
}
