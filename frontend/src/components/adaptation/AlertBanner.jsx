import { useState, useEffect } from 'react'
import { AlertTriangle, Info, CloudRain } from 'lucide-react'
import { api } from '../../services/api'

const TYPE_CONFIG = {
  transport_alert: {
    Icon: AlertTriangle,
    bg: '#fee2e2',
    color: '#991b1b',
    label: 'Cảnh báo giao thông',
    showAdapt: true,
  },
  service_unavailable: {
    Icon: Info,
    bg: '#f3f4f6',
    color: '#374151',
    label: 'Dịch vụ không khả dụng',
    showAdapt: false,
  },
  weather_warning: {
    Icon: CloudRain,
    bg: '#dbeafe',
    color: '#1e40af',
    label: 'Cảnh báo thời tiết',
    showAdapt: true,
  },
}

function getSessionId() {
  try {
    return localStorage.getItem('session_id')
  } catch {
    return null
  }
}

export default function AlertBanner({ alert, tripId, onDismiss, onAdapted }) {
  // Unknown types fall back to the most restrictive config (no adapt button).
  const config = TYPE_CONFIG[alert.alert_type] ?? TYPE_CONFIG.service_unavailable
  const { Icon, bg, color, label, showAdapt } = config
  const [adapting, setAdapting] = useState(false)
  const [adaptError, setAdaptError] = useState(null)

  // Clear stale error when a different alert is shown in the same slot.
  useEffect(() => { setAdaptError(null) }, [alert.id])

  const handleAdapt = async () => {
    setAdapting(true)
    setAdaptError(null)
    try {
      const sessionId = getSessionId()
      await api.adaptTrip(tripId, { alert_id: alert.id, session_id: sessionId })
      if (onAdapted) await onAdapted()
      onDismiss(alert.id)
    } catch (e) {
      setAdaptError(e.message)
    } finally {
      setAdapting(false)
    }
  }

  return (
    <div
      role="alert"
      style={{
        background: bg,
        color,
        borderRadius: 8,
        marginBottom: 8,
        padding: '12px 16px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        position: 'relative',
      }}
    >
      <Icon size={18} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7, margin: '0 0 2px' }}>
          {label}
        </p>
        <p style={{ margin: '0 0 8px', fontSize: 14 }}>{alert.message}</p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {showAdapt && (
            <button
              onClick={handleAdapt}
              disabled={adapting}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 4,
                border: `1px solid ${color}`,
                background: 'transparent',
                color,
                cursor: adapting ? 'not-allowed' : 'pointer',
                opacity: adapting ? 0.6 : 1,
              }}
            >
              {adapting ? 'Đang cập nhật...' : 'Cập nhật kế hoạch'}
            </button>
          )}
          <button
            onClick={() => onDismiss(alert.id)}
            disabled={adapting}
            style={{
              padding: '4px 10px',
              fontSize: 12,
              borderRadius: 4,
              border: `1px solid ${color}`,
              background: 'transparent',
              color,
              cursor: adapting ? 'not-allowed' : 'pointer',
              opacity: adapting ? 0.6 : 1,
            }}
          >
            {showAdapt ? 'Bỏ qua' : 'Đã hiểu'}
          </button>
        </div>

        {adaptError && (
          <p style={{ marginTop: 6, fontSize: 12, color: '#dc2626' }}>{adaptError}</p>
        )}
      </div>
    </div>
  )
}
