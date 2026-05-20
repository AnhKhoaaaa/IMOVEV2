import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Settings, Sparkles, X, AlertCircle, Check } from 'lucide-react'
import PlaceSearch from '../components/planner/PlaceSearch'
import { api } from '../services/api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Checkbox } from '../components/ui/checkbox'
import { Alert, AlertDescription } from '../components/ui/alert'

const STEPS = [
  { id: 1, label: 'Điểm đến', icon: MapPin },
  { id: 2, label: 'Địa điểm', icon: MapPin },
  { id: 3, label: 'Tuỳ chỉnh', icon: Settings },
  { id: 4, label: 'Xác nhận', icon: Sparkles },
]

const generateId = () =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export default function Planner() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [places, setPlaces] = useState([])
  const [numDays, setNumDays] = useState(1)
  const [budget, setBudget] = useState(50)
  const [preferMrt, setPreferMrt] = useState(true)
  const [maxWalkMinutes, setMaxWalkMinutes] = useState(15)
  const [optimizeOrder, setOptimizeOrder] = useState(true)
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const addPlace = (place) =>
    setPlaces((prev) => prev.some((p) => p.id === place.id) ? prev : [...prev, place])

  const removePlace = (id) => setPlaces((prev) => prev.filter((p) => p.id !== id))

  const handleNumDays = (e) => {
    const v = parseInt(e.target.value, 10)
    if (!isNaN(v) && v >= 1) setNumDays(v)
  }

  const handleBudget = (e) => {
    const v = parseInt(e.target.value, 10)
    if (!isNaN(v) && v >= 1) setBudget(v)
  }

  const submit = async () => {
    setLoading(true)
    setSubmitError(null)
    try {
      let sessionId
      try { sessionId = localStorage.getItem('session_id') ?? generateId(); localStorage.setItem('session_id', sessionId) }
      catch { sessionId = generateId() }

      const trip = await api.createTrip({ session_id: sessionId, num_days: numDays, budget_sgd: budget })
      await api.planTrip(trip.id, {
        place_ids: places.map((p) => p.id),
        optimize_order: optimizeOrder,
        preferences: { prefer_mrt: preferMrt, max_walk_minutes: maxWalkMinutes },
      })
      navigate(`/trip/${trip.id}`)
    } catch (e) {
      setSubmitError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${step > s.id ? 'bg-sky-500 text-white' : step === s.id ? 'bg-sky-500 text-white ring-4 ring-sky-100' : 'bg-slate-200 text-slate-500'}`}>
                  {step > s.id ? <Check className="h-4 w-4" /> : s.id}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 w-full mx-1 sm:mx-2 ${step > s.id ? 'bg-sky-500' : 'bg-slate-200'}`} style={{ width: '2rem' }} />
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500 text-center">
            Bước {step} / {STEPS.length} — {STEPS[step - 1].label}
          </p>
        </div>

        {/* Card container */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Điểm đến</h2>
                <p className="text-sm text-slate-500 mt-1">Chúng tôi hỗ trợ lập kế hoạch tại Singapore trong MVP này</p>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100">
                  <MapPin className="h-5 w-5 text-sky-600" />
                </div>
                <div>
                  <p className="font-medium text-slate-900">Singapore</p>
                  <p className="text-xs text-slate-500">Thành phố sư tử — Hub giao thông công cộng hàng đầu Châu Á</p>
                </div>
              </div>
              <Button className="w-full" onClick={() => setStep(2)}>Tiếp theo</Button>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Chọn địa điểm</h2>
                <p className="text-sm text-slate-500 mt-1">Tìm và thêm các địa điểm bạn muốn ghé thăm</p>
              </div>
              <PlaceSearch onAdd={addPlace} />

              {places.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">Đã chọn ({places.length})</p>
                  <ul className="space-y-1.5">
                    {places.map((p) => (
                      <li key={p.id} className="flex items-center justify-between rounded-lg bg-sky-50 border border-sky-100 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                          <span className="text-sm text-slate-700">{p.name}</span>
                        </div>
                        <button
                          onClick={() => removePlace(p.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors ml-2"
                          aria-label={`Xoá ${p.name}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Button className="w-full" onClick={() => setStep(3)} disabled={!places.length}>
                Tiếp theo {places.length > 0 && `(${places.length} địa điểm)`}
              </Button>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Tuỳ chỉnh chuyến đi</h2>
                <p className="text-sm text-slate-500 mt-1">Thiết lập thời gian, ngân sách và sở thích di chuyển</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="numDays">Số ngày</Label>
                  <Input id="numDays" type="number" value={numDays} min={1} max={7} onChange={handleNumDays} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="budget">Ngân sách (SGD)</Label>
                  <Input id="budget" type="number" value={budget} min={1} onChange={handleBudget} />
                </div>
              </div>

              <div className="space-y-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-700">Sở thích di chuyển</p>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="preferMrt"
                    checked={preferMrt}
                    onCheckedChange={(v) => setPreferMrt(v === true)}
                  />
                  <Label htmlFor="preferMrt" className="cursor-pointer">Ưu tiên MRT (nhanh hơn)</Label>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label htmlFor="walk-slider">Tối đa đi bộ</Label>
                    <span className="text-sm font-semibold text-sky-600">{maxWalkMinutes} phút</span>
                  </div>
                  <input
                    id="walk-slider"
                    type="range"
                    min={5}
                    max={60}
                    step={5}
                    value={maxWalkMinutes}
                    onChange={(e) => setMaxWalkMinutes(+e.target.value)}
                    className="w-full h-2 cursor-pointer accent-sky-500"
                  />
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>5 phút</span>
                    <span>60 phút</span>
                  </div>
                </div>
              </div>

              <Button className="w-full" onClick={() => setStep(4)}>Tiếp theo</Button>
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Xác nhận & Tạo kế hoạch</h2>
                <p className="text-sm text-slate-500 mt-1">Xem lại và tạo hành trình của bạn</p>
              </div>

              {/* Summary */}
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-sm">
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-slate-500">Địa điểm</span>
                  <span className="font-medium text-slate-900">{places.length} nơi</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-slate-500">Số ngày</span>
                  <span className="font-medium text-slate-900">{numDays} ngày</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-slate-500">Ngân sách</span>
                  <span className="font-medium text-slate-900">SGD {budget}</span>
                </div>
                <div className="flex justify-between px-4 py-2.5">
                  <span className="text-slate-500">Ưu tiên MRT</span>
                  <span className="font-medium text-slate-900">{preferMrt ? 'Có' : 'Không'}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Checkbox
                  id="optimizeOrder"
                  checked={optimizeOrder}
                  onCheckedChange={(v) => setOptimizeOrder(v === true)}
                />
                <Label htmlFor="optimizeOrder" className="cursor-pointer">
                  Tự động tối ưu thứ tự địa điểm
                </Label>
              </div>

              {submitError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              )}

              <Button className="w-full" onClick={submit} disabled={loading} size="lg">
                {loading ? (
                  <span className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Đang tạo kế hoạch...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Tạo kế hoạch
                  </span>
                )}
              </Button>

              <button
                onClick={() => setStep(3)}
                className="w-full text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                ← Quay lại
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
