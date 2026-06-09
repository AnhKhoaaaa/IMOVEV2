import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, LogIn, RotateCcw, Save, SlidersHorizontal } from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { cn } from '../lib/utils'
import AuthModal from '../components/auth/AuthModal'

const DEFAULT_PROFILE = {
  duration_w: 0.4,
  cost_w: 0.3,
  walking_w: 0.2,
  transfers_w: 0.1,
}

const WEIGHTS = [
  { key: 'duration_w', label: 'Faster routes', desc: 'Prefer shorter travel time' },
  { key: 'cost_w', label: 'Lower fare', desc: 'Prefer cheaper transit options' },
  { key: 'walking_w', label: 'Less walking', desc: 'Reduce walking distance' },
  { key: 'transfers_w', label: 'Fewer transfers', desc: 'Avoid complicated routes' },
]

// 3-level priority model replaces raw percentages. Coefficients are normalized on save.
const LEVELS = [
  { key: 'low', label: 'Low', coeff: 1 },
  { key: 'med', label: 'Medium', coeff: 2 },
  { key: 'high', label: 'High', coeff: 3 },
]
const LEVEL_COEFF = { low: 1, med: 2, high: 3 }

// Map a stored normalized weight (0–1) back to a qualitative level for display.
function valueToLevel(weight) {
  const w = Number(weight ?? 0)
  if (w >= 0.30) return 'high'
  if (w >= 0.18) return 'med'
  return 'low'
}

function levelsFromProfile(profile) {
  const out = {}
  for (const item of WEIGHTS) out[item.key] = valueToLevel(profile[item.key])
  return out
}

// Convert chosen levels into normalized weights summing to 1.00 (backend also normalizes).
function weightsFromLevels(levels) {
  const total = WEIGHTS.reduce((sum, item) => sum + LEVEL_COEFF[levels[item.key]], 0) || 1
  const out = {}
  for (const item of WEIGHTS) {
    out[item.key] = Number((LEVEL_COEFF[levels[item.key]] / total).toFixed(4))
  }
  return out
}

export default function Settings() {
  const { user } = useAuth()
  const [levels, setLevels] = useState(() => levelsFromProfile(DEFAULT_PROFILE))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const [showAuth, setShowAuth] = useState(false)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    setError(null)
    api.getUserPreferences()
      .then((data) => setLevels(levelsFromProfile({ ...DEFAULT_PROFILE, ...data })))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [user])

  const setLevel = (key, level) => {
    setLevels((current) => ({ ...current, [key]: level }))
    setMessage(null)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await api.updateUserPreferences(weightsFromLevels(levels))
      setLevels(levelsFromProfile({ ...DEFAULT_PROFILE, ...saved }))
      setMessage('Preferences saved.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setLevels(levelsFromProfile(DEFAULT_PROFILE))
    setMessage(null)
    setError(null)
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <p className="text-[12px] font-bold uppercase tracking-wide text-blue-600">Settings</p>
          <h1 className="mt-1 font-display text-[32px] font-extrabold text-slate-950">Transport preferences</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-6 text-slate-500">
            IMOVE uses these priorities when choosing between MRT, bus, walking, and cycling alternatives.
          </p>
        </div>

        {!user ? (
          <section className="rounded-lg border border-blue-200 bg-white p-6 shadow-card">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-[18px] font-extrabold text-slate-950">Sign in to personalise routing</h2>
                <ul className="mt-3 space-y-1.5 text-[13.5px] text-slate-600">
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Save your transport priorities across devices</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Get routes ranked to your personal profile</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Use “My Preferences” as a travel style in the planner</li>
                </ul>
              </div>
              <button
                onClick={() => setShowAuth(true)}
                className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 text-[14px] font-bold text-white shadow-card hover:bg-blue-500"
              >
                <LogIn size={16} /> Sign in
              </button>
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-[1fr_300px] gap-6">
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-card">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5 text-blue-600" />
                  <h2 className="font-display text-[18px] font-extrabold text-slate-950">Routing priorities</h2>
                </div>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </div>

              <div className="space-y-6">
                {WEIGHTS.map((item) => (
                  <div key={item.key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-[14px] font-bold text-slate-800">{item.label}</p>
                      <p className="text-[12px] text-slate-400">{item.desc}</p>
                    </div>
                    <div
                      role="radiogroup"
                      aria-label={item.label}
                      className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-0.5"
                    >
                      {LEVELS.map((lvl) => (
                        <button
                          key={lvl.key}
                          type="button"
                          role="radio"
                          aria-checked={levels[item.key] === lvl.key}
                          onClick={() => setLevel(item.key, lvl.key)}
                          className={cn(
                            'h-8 w-[72px] rounded-md text-[12.5px] font-bold transition',
                            levels[item.key] === lvl.key
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          )}
                        >
                          {lvl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
                <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400">How it works</p>
                <p className="mt-2 text-[12.5px] leading-5 text-slate-500">
                  A higher level gives that factor stronger priority. Levels are balanced automatically when you save.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={reset}
                    className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
                    title="Reset"
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button
                    onClick={save}
                    disabled={saving}
                    className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-[13px] font-bold text-white hover:bg-blue-500 disabled:opacity-60"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    Save
                  </button>
                </div>
              </section>

              {(message || error) && (
                <section className={`rounded-lg border p-4 ${error ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                  <div className="flex gap-2">
                    {error ? <AlertCircle className="h-4 w-4 text-red-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    <p className={`text-[13px] font-semibold ${error ? 'text-red-700' : 'text-emerald-700'}`}>
                      {error ?? message}
                    </p>
                  </div>
                </section>
              )}
            </aside>
          </div>
        )}
      </div>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </main>
  )
}
