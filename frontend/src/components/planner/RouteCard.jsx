import { useState } from 'react'
import { api } from '../../services/api'
import CitymapperTransitCard from './CitymapperTransitCard'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'
import { AlertCircle } from 'lucide-react'
import { useT } from '../../contexts/LanguageContext'

const MODES = ['MRT', 'LRT', 'BUS', 'WALK', 'DRIVE']
const MODE_LABEL_KEY = { MRT: 'transport_mrt', LRT: 'ctLrt', BUS: 'transport_bus', WALK: 'transport_walk', DRIVE: 'ctDriveTaxi' }

export default function RouteCard({ leg, tripId, onUpdated }) {
  const { t } = useT()
  const [editOpen, setEditOpen] = useState(false)
  const [confirmedMode, setConfirmedMode] = useState(leg.transport_mode)
  const [newMode, setNewMode] = useState(leg.transport_mode)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState(null)

  const openEdit = () => { setNewMode(confirmedMode); setUpdateError(null); setEditOpen(true) }

  const handleUpdate = async () => {
    setUpdating(true)
    setUpdateError(null)
    try {
      await api.updateLeg(tripId, leg.id, { transport_mode: newMode })
      setConfirmedMode(newMode)
      setEditOpen(false)
      if (onUpdated) await onUpdated()
    } catch (e) {
      setUpdateError(e.message)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <>
      <CitymapperTransitCard
        leg={{ ...leg, transport_mode: confirmedMode }}
        onEdit={tripId ? openEdit : undefined}
      />

      {tripId && (
        <Dialog open={editOpen} onOpenChange={(open) => { if (!open) { setEditOpen(false); setUpdateError(null) } }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>{t('rcChangeMode')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="transport-mode-select">{t('rcNewMode')}</Label>
                <select
                  id="transport-mode-select"
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>{t(MODE_LABEL_KEY[m])}</option>
                  ))}
                </select>
              </div>
              {updateError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{updateError}</AlertDescription>
                </Alert>
              )}
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleUpdate} disabled={updating}>
                  {updating ? t('rcSaving') : t('tripConfirm')}
                </Button>
                <Button variant="outline" onClick={() => { setEditOpen(false); setUpdateError(null) }}>
                  {t('tripCancel')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
