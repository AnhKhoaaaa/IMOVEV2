import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertTriangle, X } from 'lucide-react'
import { useTrip } from '../hooks/useTrip'
import { useAlerts } from '../hooks/useAlerts'
import DayPlan from '../components/planner/DayPlan'
import TripMap from '../components/map/TripMap'
import AlertBanner from '../components/adaptation/AlertBanner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Skeleton } from '../components/ui/skeleton'
import { Alert, AlertDescription } from '../components/ui/alert'

function TripSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Đang tải hành trình">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-3/4 rounded-xl" />
    </div>
  )
}

export default function Trip() {
  const { id } = useParams()
  const { trip, loading, error } = useTrip(id)
  const { alerts, dismiss } = useAlerts(id)
  const [dismissedWarnings, setDismissedWarnings] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">

        {/* Alerts from realtime */}
        {alerts.map((a) => (
          <AlertBanner key={a.id} alert={a} tripId={id} onDismiss={dismiss} />
        ))}

        {/* Best-time warnings */}
        {!dismissedWarnings && trip?.warnings?.length > 0 && (
          <Alert variant="warning" className="mb-4 pr-10 relative">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {trip.warnings.join(' · ')}
            </AlertDescription>
            <button
              onClick={() => setDismissedWarnings(true)}
              aria-label="Dismiss warnings"
              className="absolute right-3 top-3 opacity-60 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>
          </Alert>
        )}

        {/* Loading */}
        {loading && <TripSkeleton />}

        {/* Error */}
        {error && !loading && (
          <Alert variant="destructive">
            <AlertDescription>
              Không thể tải hành trình: {String(error?.message ?? error)}
            </AlertDescription>
          </Alert>
        )}

        {/* Content */}
        {trip && !loading && (
          <Tabs defaultValue="list">
            <TabsList className="mb-4">
              <TabsTrigger value="list">Danh sách</TabsTrigger>
              <TabsTrigger value="map">Bản đồ</TabsTrigger>
            </TabsList>

            <TabsContent value="list">
              {trip.days?.map((day) => (
                <DayPlan key={day.day} day={day.day} legs={day.legs} tripId={id} />
              ))}
            </TabsContent>

            <TabsContent value="map">
              <div className="h-[480px] rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                <TripMap places={trip.places} />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  )
}
