import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PlaceSearch from '../components/planner/PlaceSearch'
import { api } from '../services/api'

export default function Planner() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [places, setPlaces] = useState([])
  const [numDays, setNumDays] = useState(1)
  const [budget, setBudget] = useState(50)
  const [optimizeOrder, setOptimizeOrder] = useState(true)
  const [loading, setLoading] = useState(false)

  const addPlace = (place) => setPlaces((prev) => [...prev, place])

  const submit = async () => {
    setLoading(true)
    try {
      const sessionId = localStorage.getItem('session_id') ?? crypto.randomUUID()
      localStorage.setItem('session_id', sessionId)
      const trip = await api.createTrip({ session_id: sessionId, num_days: numDays, budget_sgd: budget })
      await api.planTrip(trip.id, { place_ids: places.map((p) => p.id), optimize_order: optimizeOrder })
      navigate(`/trip/${trip.id}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: '0 24px' }}>
      <h2>Plan Your Trip</h2>

      {step === 1 && (
        <div>
          <p>Destination: <strong>Singapore</strong></p>
          <button onClick={() => setStep(2)}>Next</button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h3>Add Places</h3>
          <PlaceSearch onAdd={addPlace} />
          <ul>{places.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
          <button onClick={() => setStep(3)} disabled={!places.length}>Next</button>
        </div>
      )}

      {step === 3 && (
        <div>
          <label>Days: <input type="number" value={numDays} min={1} onChange={(e) => setNumDays(+e.target.value)} /></label>
          <label>Budget (SGD): <input type="number" value={budget} min={1} onChange={(e) => setBudget(+e.target.value)} /></label>
          <label><input type="checkbox" checked={optimizeOrder} onChange={(e) => setOptimizeOrder(e.target.checked)} /> Optimize order</label>
          <button onClick={submit} disabled={loading}>{loading ? 'Planning...' : 'Generate Plan'}</button>
        </div>
      )}
    </main>
  )
}
