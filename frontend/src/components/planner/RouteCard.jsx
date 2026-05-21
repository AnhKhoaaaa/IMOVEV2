import { useState } from 'react'
import { Train, Bus, Footprints, Car, Bike, Pencil, AlertCircle } from 'lucide-react'
import { api } from '../../services/api'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Alert, AlertDescription } from '../ui/alert'
import { Card, CardContent } from '../ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { Label } from '../ui/label'

const MODE_CONFIG = {
  MRT:    { icon: Train,      label: 'MRT',     color: 'text-sky-600' },
  SUBWAY: { icon: Train,      label: 'MRT',     color: 'text-sky-600' },
  BUS:    { icon: Bus,        label: 'Bus',     color: 'text-emerald-600' },
  WALK:   { icon: Footprints, label: 'Đi bộ',  color: 'text-orange-500' },
  DRIVE:  { icon: Car,        label: 'Xe hơi',  color: 'text-purple-600' },
  CYCLE:  { icon: Bike,       label: 'Xe đạp', color: 'text-teal-600' },
}
const MODES = ['MRT', 'BUS', 'WALK', 'DRIVE', 'CYCLE']

export default function RouteCard({ leg, tripId, onUpdated }) {
  const [displayMode, setDisplayMode] = useState(leg.transport_mode)
  const [editOpen, setEditOpen] = useState(false)
  const [newMode, setNewMode] = useState(leg.transport_mode)
  const [updateError, setUpdateError] = useState(null)
  const [updating, setUpdating] = useState(false)

  const config = MODE_CONFIG[displayMode?.toUpperCase()] ?? MODE_CONFIG.BUS
  const Icon = config.icon
  const cost = leg.cost_sgd != null ? `SGD ${leg.cost_sgd.toFixed(2)}` : 'SGD —'

  const openEdit = () => { setNewMode(displayMode); setUpdateError(null); setEditOpen(true) }

  const handleUpdate = async () => {
    setUpdating(true)
    setUpdateError(null)
    try {
      await api.updateLeg(tripId, leg.id, { transport_mode: newMode })
      setDisplayMode(newMode)
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
      <Card className="mb-2">
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 ${config.color}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-slate-900">{config.label}</span>
                <span className="text-slate-300">·</span>
                <span className="text-sm text-slate-600">{leg.duration_minutes} phút</span>
                <span className="text-slate-300">·</span>
                <span className="text-sm text-slate-600">{cost}</span>
                {leg.is_estimated && (
                  <Badge variant="warning" className="text-xs">~ Ước tính</Badge>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate">
                {leg.from_place_id} → {leg.to_place_id}
              </p>
            </div>
            {tripId && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit transport mode"
                onClick={openEdit}
                className="h-7 w-7 shrink-0 text-slate-400 hover:text-slate-600"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      {tripId && (
        <Dialog open={editOpen} onOpenChange={(open) => { if (!open) { setEditOpen(false); setUpdateError(null) } }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>Đổi phương tiện</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="transport-mode-select">Phương tiện mới</Label>
                <select
                  id="transport-mode-select"
                  value={newMode}
                  onChange={(e) => setNewMode(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>{MODE_CONFIG[m].label}</option>
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
                  {updating ? 'Đang lưu...' : 'Xác nhận'}
                </Button>
                <Button variant="outline" onClick={() => { setEditOpen(false); setUpdateError(null) }}>
                  Huỷ
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
