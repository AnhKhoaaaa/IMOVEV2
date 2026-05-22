import { useState } from 'react'
import { api } from '../../services/api'
import CitymapperTransitCard from './CitymapperTransitCard'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'
import { AlertCircle } from 'lucide-react'

const MODES = ['MRT', 'LRT', 'BUS', 'WALK', 'DRIVE']
const MODE_LABEL = { MRT: 'MRT', LRT: 'LRT', BUS: 'Bus', WALK: 'Walk', DRIVE: 'Drive / Taxi' }

export default function RouteCard({ leg, tripId, onUpdated }) {
  const [editOpen, setEditOpen] = useState(false)
  const [newMode, setNewMode] = useState(leg.transport_mode)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState(null)

  const openEdit = () => { setNewMode(leg.transport_mode); setUpdateError(null); setEditOpen(true) }

  const handleUpdate = async () => {
    setUpdating(true)
    setUpdateError(null)
    try {
      await api.updateLeg(tripId, leg.id, { transport_mode: newMode })
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
        leg={leg}
        onEdit={tripId ? openEdit : undefined}
      />

      {tripId && (
        <Dialog open={editOpen} onOpenChange={(open) => { if (!open) { setEditOpen(false); setUpdateError(null) } }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>Change transport mode</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="transport-mode-select">New mode</Label>
                <select
                  id="transport-mode-select"
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>{MODE_LABEL[m]}</option>
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
                  {updating ? 'Saving...' : 'Confirm'}
                </Button>
                <Button variant="outline" onClick={() => { setEditOpen(false); setUpdateError(null) }}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
