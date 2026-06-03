import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, Save, Settings as SettingsIcon, SlidersHorizontal, User } from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

const DEFAULT_PROFILE = {
  duration_w: 0.4,
  cost_w: 0.3,
  walking_w: 0.2,
  transfers_w: 0.1,
  constraints: {
    avoid_bus: false,
    avoid_metro: false,
    minimize_walking: false,
    minimize_fee: false,
  },
}

const WEIGHTS = [
  { key: 'duration_w', label: 'Faster routes', desc: 'Prefer shorter travel time' },
  { key: 'cost_w', label: 'Lower fare', desc: 'Prefer cheaper transit options' },
  { key: 'walking_w', label: 'Less walking', desc: 'Reduce walking distance' },
  { key: 'transfers_w', label: 'Fewer transfers', desc: 'Avoid complicated routes' },
]

const CONSTRAINTS = [
  { key: 'avoid_bus', label: 'Avoid bus when possible' },
  { key: 'avoid_metro', label: 'Avoid MRT when possible' },
  { key: 'minimize_walking', label: 'Strongly minimize walking' },
  { key: 'minimize_fee', label: 'Strongly minimize fare' },
]

function normalize(profile) {
  const total = WEIGHTS.reduce((sum, item) => sum + Number(profile[item.key] ?? 0), 0)
  if (!total) return DEFAULT_PROFILE
  return {
    ...profile,
    duration_w: Number((profile.duration_w / total).toFixed(4)),
    cost_w: Number((profile.cost_w / total).toFixed(4)),
    walking_w: Number((profile.walking_w / total).toFixed(4)),
    transfers_w: Number((profile.transfers_w / total).toFixed(4)),
    constraints: { ...DEFAULT_PROFILE.constraints, ...(profile.constraints ?? {}) },
  }
}

export default function Settings() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(DEFAULT_PROFILE)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!user) return
    setLoading(true)
    setError(null)
    api.getUserPreferences()
      .then((data) => setProfile(normalize({ ...DEFAULT_PROFILE, ...data })))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [user])

  const weightTotal = useMemo(
    () => WEIGHTS.reduce((sum, item) => sum + Number(profile[item.key] ?? 0), 0),
    [profile]
  )

  const setWeight = (key, value) => {
    setProfile((current) => ({ ...current, [key]: Number(value) }))
    setMessage(null)
  }

  const setConstraint = (key, checked) => {
    setProfile((current) => ({
      ...current,
      constraints: { ...current.constraints, [key]: checked },
    }))
    setMessage(null)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const saved = await api.updateUserPreferences(normalize(profile))
      setProfile(normalize(saved))
      setMessage('Preferences saved and normalized.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setProfile(DEFAULT_PROFILE)
    setMessage(null)
    setError(null)
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-slate-50 px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-[12px] font-bold uppercase tracking-wide text-blue-600">Settings</p>
            <h1 className="mt-1 font-display text-[32px] font-extrabold text-slate-950">Transport preferences</h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-slate-500">
              IMOVE uses these weights when choosing between MRT, bus, walking, and cycling alternatives.
            </p>
          </div>
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-blue-600 text-white shadow-card">
            <SettingsIcon size={20} />
          </div>
        </div>

        {!user ? (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-6">
            <div className="flex gap-3">
              <User className="mt-0.5 h-5 w-5 text-amber-600" />
              <div>
                <h2 className="font-display text-[18px] font-extrabold text-amber-950">Sign in required</h2>
                <p className="mt-1 text-[14px] text-amber-800">
                  Preferences are stored per Supabase account. Sign in from the header before saving route weights.
                </p>
              </div>
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-[1fr_320px] gap-6">
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-card">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5 text-blue-600" />
                  <h2 className="font-display text-[18px] font-extrabold text-slate-950">Scoring weights</h2>
                </div>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </div>

              <div className="space-y-6">
                {WEIGHTS.map((item) => (
                  <label key={item.key} className="block">
                    <div className="mb-2 flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[14px] font-bold text-slate-800">{item.label}</p>
                        <p className="text-[12px] text-slate-400">{item.desc}</p>
                      </div>
                      <span className="font-mono-code text-[13px] font-bold text-blue-700">
                        {Math.round((profile[item.key] ?? 0) * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={profile[item.key] ?? 0}
                      onChange={(event) => setWeight(item.key, event.target.value)}
                      className="w-full accent-blue-600"
                    />
                  </label>
                ))}
              </div>
            </section>

            <aside className="space-y-4">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
                <h2 className="font-display text-[16px] font-extrabold text-slate-950">Constraints</h2>
                <div className="mt-4 space-y-3">
                  {CONSTRAINTS.map((item) => (
                    <label key={item.key} className="flex items-center gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={!!profile.constraints?.[item.key]}
                        onChange={(event) => setConstraint(item.key, event.target.checked)}
                        className="h-4 w-4 accent-blue-600"
                      />
                      <span className="text-[13px] font-semibold text-slate-700">{item.label}</span>
                    </label>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-card">
                <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400">Weight total</p>
                <p className="mt-2 font-display text-[28px] font-extrabold text-slate-950">{weightTotal.toFixed(2)}</p>
                <p className="mt-1 text-[12px] leading-5 text-slate-500">
                  The backend normalizes weights to exactly 1.00 when saved.
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
    </main>
  )
}
