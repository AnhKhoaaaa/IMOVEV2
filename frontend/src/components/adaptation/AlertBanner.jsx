import { useState } from 'react'
import { AlertTriangle, CloudRain, Info, X, RefreshCw } from 'lucide-react'
import { api } from '../../services/api'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'

const TYPE_CONFIG = {
  transport_alert:    { icon: AlertTriangle, variant: 'destructive', label: 'Cảnh báo giao thông' },
  service_unavailable:{ icon: Info,          variant: 'warning',     label: 'Dịch vụ không khả dụng' },
  weather_warning:    { icon: CloudRain,     variant: 'default',     label: 'Cảnh báo thời tiết' },
}

export default function AlertBanner({ alert, tripId, onDismiss }) {
  const { icon: Icon, variant, label } = TYPE_CONFIG[alert.alert_type] ?? TYPE_CONFIG.transport_alert
  const [adaptError, setAdaptError] = useState(null)
  const [adapting, setAdapting] = useState(false)

  const handleAdapt = async () => {
    setAdapting(true)
    setAdaptError(null)
    try {
      await api.adaptTrip(tripId, { alert_id: alert.id })
      onDismiss(alert.id)
    } catch (e) {
      setAdaptError(e.message)
    } finally {
      setAdapting(false)
    }
  }

  return (
    <div className="mb-3">
      <Alert variant={variant} className="pr-10 relative">
        <Icon className="h-4 w-4" />
        <div className="flex-1">
          <p className="text-xs font-semibold mb-0.5 uppercase tracking-wide opacity-70">{label}</p>
          <AlertDescription>{alert.message}</AlertDescription>
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={handleAdapt}
              disabled={adapting}
            >
              <RefreshCw className="h-3 w-3" />
              {adapting ? 'Đang cập nhật...' : 'Cập nhật kế hoạch'}
            </Button>
          </div>
          {adaptError && (
            <p className="text-xs mt-1 opacity-80">{adaptError}</p>
          )}
        </div>
        <button
          onClick={() => onDismiss(alert.id)}
          aria-label="Đóng cảnh báo"
          className="absolute right-3 top-3 opacity-60 hover:opacity-100 transition-opacity"
        >
          <X className="h-4 w-4" />
        </button>
      </Alert>
    </div>
  )
}
