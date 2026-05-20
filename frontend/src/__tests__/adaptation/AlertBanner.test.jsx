import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AlertBanner from '../../components/adaptation/AlertBanner'

vi.mock('../../services/api', () => ({
  api: { adaptTrip: vi.fn() },
}))

import { api } from '../../services/api'

const makeAlert = (overrides = {}) => ({
  id: 'alert-1',
  alert_type: 'transport_alert',
  message: 'MRT North-South Line bị gián đoạn',
  trip_id: 'trip-1',
  ...overrides,
})

describe('AlertBanner', () => {
  const onDismiss = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  // --- Rendering by type ---

  it('renders transport_alert with adapt + dismiss buttons', () => {
    render(<AlertBanner alert={makeAlert()} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.getByText('Cập nhật kế hoạch')).toBeInTheDocument()
    expect(screen.getByText('Bỏ qua')).toBeInTheDocument()
    expect(screen.queryByText('Đã hiểu')).not.toBeInTheDocument()
  })

  it('renders service_unavailable WITHOUT adapt button, only "Đã hiểu"', () => {
    render(<AlertBanner alert={makeAlert({ alert_type: 'service_unavailable' })} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.queryByText('Cập nhật kế hoạch')).not.toBeInTheDocument()
    expect(screen.getByText('Đã hiểu')).toBeInTheDocument()
  })

  it('renders weather_warning with adapt + dismiss buttons', () => {
    render(<AlertBanner alert={makeAlert({ alert_type: 'weather_warning' })} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.getByText('Cập nhật kế hoạch')).toBeInTheDocument()
    expect(screen.getByText('Bỏ qua')).toBeInTheDocument()
  })

  it('displays the alert message', () => {
    render(<AlertBanner alert={makeAlert()} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.getByText('MRT North-South Line bị gián đoạn')).toBeInTheDocument()
  })

  it('displays label for each type', () => {
    const { rerender } = render(
      <AlertBanner alert={makeAlert({ alert_type: 'transport_alert' })} tripId="t" onDismiss={onDismiss} />
    )
    expect(screen.getByText(/Cảnh báo giao thông/i)).toBeInTheDocument()

    rerender(<AlertBanner alert={makeAlert({ alert_type: 'weather_warning' })} tripId="t" onDismiss={onDismiss} />)
    expect(screen.getByText(/Cảnh báo thời tiết/i)).toBeInTheDocument()

    rerender(<AlertBanner alert={makeAlert({ alert_type: 'service_unavailable' })} tripId="t" onDismiss={onDismiss} />)
    expect(screen.getByText(/Dịch vụ không khả dụng/i)).toBeInTheDocument()
  })

  it('falls back to transport_alert config for unknown type', () => {
    render(<AlertBanner alert={makeAlert({ alert_type: 'unknown_type' })} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.getByText('Cập nhật kế hoạch')).toBeInTheDocument()
  })

  // --- Dismiss button ---

  it('calls onDismiss with alert id when dismiss button clicked', () => {
    render(<AlertBanner alert={makeAlert()} tripId="trip-1" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText('Bỏ qua'))
    expect(onDismiss).toHaveBeenCalledWith('alert-1')
  })

  it('calls onDismiss when "Đã hiểu" clicked for service_unavailable', () => {
    render(<AlertBanner alert={makeAlert({ alert_type: 'service_unavailable' })} tripId="trip-1" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByText('Đã hiểu'))
    expect(onDismiss).toHaveBeenCalledWith('alert-1')
  })

  // --- Adapt button (success) ---

  it('calls api.adaptTrip and then onDismiss on success', async () => {
    api.adaptTrip.mockResolvedValue({})
    render(<AlertBanner alert={makeAlert()} tripId="trip-1" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('Cập nhật kế hoạch'))

    await waitFor(() => expect(api.adaptTrip).toHaveBeenCalledWith('trip-1', { alert_id: 'alert-1' }))
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('alert-1'))
  })

  it('shows loading text while adapting', async () => {
    let resolve
    api.adaptTrip.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<AlertBanner alert={makeAlert()} tripId="trip-1" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('Cập nhật kế hoạch'))
    expect(await screen.findByText('Đang cập nhật...')).toBeInTheDocument()
    expect(screen.getByText('Đang cập nhật...')).toBeDisabled()

    resolve({})
    await waitFor(() => expect(screen.queryByText('Đang cập nhật...')).not.toBeInTheDocument())
  })

  // --- Adapt button (error) ---

  it('shows error message and does NOT dismiss when adaptTrip fails', async () => {
    api.adaptTrip.mockRejectedValue(new Error('Backend offline'))
    render(<AlertBanner alert={makeAlert()} tripId="trip-1" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('Cập nhật kế hoạch'))

    await waitFor(() => expect(screen.getByText('Backend offline')).toBeInTheDocument())
    expect(onDismiss).not.toHaveBeenCalled()
    // Button should be re-enabled after failure
    expect(screen.getByText('Cập nhật kế hoạch')).not.toBeDisabled()
  })
})
