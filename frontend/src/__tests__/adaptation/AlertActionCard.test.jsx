import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as tlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import AlertActionCard from '../../components/adaptation/AlertActionCard'
import { LanguageProvider } from '../../contexts/LanguageContext'

// dev25 P2 — AlertActionCard is the shared resolver extracted from AlertBanner (which is now a
// thin wrapper). AlertBanner.test.jsx already exercises the full behaviour through the wrapper;
// this file pins the extracted component directly and the new in-chat callback contract.

const render = (ui, options) => tlRender(ui, { wrapper: LanguageProvider, ...options })

vi.mock('../../services/api', () => ({
  api: { adaptTrip: vi.fn(), acceptSwap: vi.fn(), submitFeedback: vi.fn() },
}))

import { api } from '../../services/api'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key) => (key === 'imove_lang' ? 'vi' : 'sess-test-12345678')),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })
})

describe('AlertActionCard', () => {
  const onDismiss = vi.fn()
  const onAdapted = vi.fn()

  it('weather: preview → accept calls adaptTrip then acceptSwap, then onAdapted + onDismiss', async () => {
    api.adaptTrip.mockResolvedValue({ changes: ['Swap outdoor stop'] })
    api.acceptSwap.mockResolvedValue({ id: 'trip-1' })
    render(
      <AlertActionCard
        alert={{ id: 'al-1', alert_type: 'weather_warning', message: '70% rain', day_number: 2 }}
        tripId="trip-1"
        onDismiss={onDismiss}
        onAdapted={onAdapted}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật kế hoạch' }))
    await waitFor(() =>
      expect(api.adaptTrip).toHaveBeenCalledWith('trip-1', {
        alert_id: 'al-1', session_id: 'sess-test-12345678',
      })
    )
    // After preview, the weather accept button reuses the alertAcceptSwap label (same VI text).
    await waitFor(() => expect(screen.getByText('Swap outdoor stop')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật kế hoạch' }))
    await waitFor(() => expect(api.acceptSwap).toHaveBeenCalled())
    await waitFor(() => expect(onAdapted).toHaveBeenCalledWith({ id: 'trip-1' }))
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('al-1'))
  })

  it('closing_risk: skip → confirm calls acceptSwap and onAdapted', async () => {
    api.adaptTrip.mockResolvedValue({ adapted: true, changes: ['Skipped'] })
    api.acceptSwap.mockResolvedValue({ id: 'trip-1' })
    render(
      <AlertActionCard
        alert={{
          id: 'cr-1', alert_type: 'closing_risk', day_number: 1, message: 'fallback',
          metadata: { place_name: 'X', resolutions: { skip: { feasible: true }, push: { feasible: false } } },
        }}
        tripId="trip-1"
        onDismiss={onDismiss}
        onAdapted={onAdapted}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Bỏ điểm này/ }))
    await waitFor(() =>
      expect(api.adaptTrip).toHaveBeenCalledWith('trip-1', {
        alert_id: 'cr-1', session_id: 'sess-test-12345678', resolution: 'skip', target_day: null,
      })
    )
    fireEvent.click(await screen.findByText('Xác nhận'))
    await waitFor(() => expect(api.acceptSwap).toHaveBeenCalled())
    await waitFor(() => expect(onAdapted).toHaveBeenCalledWith({ id: 'trip-1' }))
  })

  it('generic (service_unavailable): renders "Đã hiểu", dismiss fires onDismiss', () => {
    render(
      <AlertActionCard
        alert={{ id: 's-1', alert_type: 'service_unavailable', message: 'No data' }}
        tripId="trip-1"
        onDismiss={onDismiss}
      />
    )
    fireEvent.click(screen.getByText('Đã hiểu'))
    expect(onDismiss).toHaveBeenCalledWith('s-1')
  })
})
