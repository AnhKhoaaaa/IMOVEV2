import { api } from '../../services/api'

const STYLES = {
  transport_alert: { background: '#fee2e2', icon: '!' },
  service_unavailable: { background: '#fef9c3', icon: '!' },
  weather_warning: { background: '#dbeafe', icon: '☔' },
}

export default function AlertBanner({ alert, tripId, onDismiss }) {
  const { background, icon } = STYLES[alert.alert_type] ?? STYLES.transport_alert

  const handleAdapt = async () => {
    await api.adaptTrip(tripId, { alert_id: alert.id })
    onDismiss(alert.id)
  }

  return (
    <div style={{ background, padding: '12px 16px', borderRadius: 8, marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
      <span>{icon}</span>
      <span style={{ flex: 1 }}>{alert.message}</span>
      <button onClick={handleAdapt}>Cap nhat ke hoach</button>
      <button onClick={() => onDismiss(alert.id)}>x</button>
    </div>
  )
}
