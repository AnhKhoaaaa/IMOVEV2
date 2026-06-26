import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useLiveCompanion } from '../../hooks/useLiveCompanion'

// dev25 P5 — the live GPS companion hook polls /chat/companion-check while the chat is active and
// fires onNudge once per distinct nudge. The endpoint usually returns { nudge: null } (stay quiet).

vi.mock('../../services/api', () => ({ api: { companionCheck: vi.fn() } }))
import { api } from '../../services/api'

const gps = { lat: 1.287, lng: 103.854 }
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => { vi.clearAllMocks() })

describe('useLiveCompanion', () => {
  it('fires onNudge when the endpoint returns a nudge', async () => {
    api.companionCheck.mockResolvedValue({ nudge: { text: 'rain near you', alert_id: 'n1', alert_type: 'weather_live' } })
    const onNudge = vi.fn()
    renderHook(() => useLiveCompanion({ enabled: true, sessionId: 's1', tripId: 't1', gps, lang: 'en', onNudge }))
    await waitFor(() => expect(onNudge).toHaveBeenCalledWith('rain near you', 'n1', 'weather_live'))
    expect(api.companionCheck).toHaveBeenCalledWith({ session_id: 's1', trip_id: 't1', gps, lang: 'en' })
  })

  it('stays silent when the endpoint returns null', async () => {
    api.companionCheck.mockResolvedValue({ nudge: null })
    const onNudge = vi.fn()
    renderHook(() => useLiveCompanion({ enabled: true, sessionId: 's1', tripId: 't1', gps, lang: 'en', onNudge }))
    await waitFor(() => expect(api.companionCheck).toHaveBeenCalled())
    expect(onNudge).not.toHaveBeenCalled()
  })

  it('does not poll for guests (enabled=false)', async () => {
    const onNudge = vi.fn()
    renderHook(() => useLiveCompanion({ enabled: false, sessionId: 's1', tripId: 't1', gps, lang: 'en', onNudge }))
    await tick()
    expect(api.companionCheck).not.toHaveBeenCalled()
  })

  it('does not poll without GPS', async () => {
    const onNudge = vi.fn()
    renderHook(() => useLiveCompanion({ enabled: true, sessionId: 's1', tripId: 't1', gps: null, lang: 'en', onNudge }))
    await tick()
    expect(api.companionCheck).not.toHaveBeenCalled()
  })

  it('does not re-fire the same nudge id on a re-activation', async () => {
    api.companionCheck.mockResolvedValue({ nudge: { text: 'rain', alert_id: 'n1' } })
    const onNudge = vi.fn()
    const base = { enabled: true, sessionId: 's1', tripId: 't1', gps, lang: 'en', onNudge }
    const { rerender } = renderHook((p) => useLiveCompanion(p), { initialProps: base })
    await waitFor(() => expect(onNudge).toHaveBeenCalledTimes(1))

    rerender({ ...base, enabled: false })   // tear down the poll
    rerender({ ...base, enabled: true })    // re-activate → polls again
    await waitFor(() => expect(api.companionCheck).toHaveBeenCalledTimes(2))
    expect(onNudge).toHaveBeenCalledTimes(1) // same id → deduped client-side
  })
})
