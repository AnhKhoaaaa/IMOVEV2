import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTrip } from '../hooks/useTrip'
import { useAlerts } from '../hooks/useAlerts'
import DayPlan from '../components/planner/DayPlan'
import TripMap from '../components/map/TripMap'
import AlertBanner from '../components/adaptation/AlertBanner'

export default function Trip() {
  const { id } = useParams()
  const { trip, loading, error } = useTrip(id)
  const { alerts, dismiss } = useAlerts(id)
  const [tab, setTab] = useState('list')

  if (loading) return <p>Loading...</p>
  if (error) return <p>Error: {error.message}</p>
  if (!trip) return null

  return (
    <main style={{ maxWidth: 960, margin: '40px auto', padding: '0 24px' }}>
      {alerts.map((a) => <AlertBanner key={a.id} alert={a} tripId={id} onDismiss={dismiss} />)}

      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <button onClick={() => setTab('list')} style={{ fontWeight: tab === 'list' ? 700 : 400 }}>List</button>
        <button onClick={() => setTab('map')} style={{ fontWeight: tab === 'map' ? 700 : 400 }}>Map</button>
      </div>

      {tab === 'list' && trip.days?.map((day) => (
        <DayPlan key={day.day} day={day.day} legs={day.legs} />
      ))}

      {tab === 'map' && (
        <div style={{ height: 480 }}>
          <TripMap places={trip.places} />
        </div>
      )}
    </main>
  )
}
