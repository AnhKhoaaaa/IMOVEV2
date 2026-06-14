import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as tlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import AlertBanner from '../../components/adaptation/AlertBanner'
import { LanguageProvider } from '../../contexts/LanguageContext'

const render = (ui, options) => tlRender(ui, { wrapper: LanguageProvider, ...options })

vi.mock('../../services/api', () => ({
  api: { adaptTrip: vi.fn(), acceptSwap: vi.fn() },
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
  const onAdapted = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => {
        if (key === 'imove_lang') return 'vi'
        return 'sess-test-12345678'
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
  })

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
    expect(screen.getByLabelText('Dismiss')).toBeInTheDocument()
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
    expect(screen.getByText(/Mưa/i)).toBeInTheDocument()

    rerender(<AlertBanner alert={makeAlert({ alert_type: 'service_unavailable' })} tripId="t" onDismiss={onDismiss} />)
    expect(screen.getByText(/Dịch vụ không khả dụng/i)).toBeInTheDocument()
  })

  it('falls back to service_unavailable for unknown type — no adapt button (safe default)', () => {
    render(<AlertBanner alert={makeAlert({ alert_type: 'unknown_type' })} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.queryByText('Cập nhật kế hoạch')).not.toBeInTheDocument()
    expect(screen.getByText('Đã hiểu')).toBeInTheDocument()
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

  it('calls api.adaptTrip with session_id, then acceptSwap, then onAdapted and onDismiss on success', async () => {
    api.adaptTrip.mockResolvedValue({ changes: ['Change A'] })
    api.acceptSwap.mockResolvedValue({})
    render(
      <AlertBanner alert={makeAlert()} tripId="trip-1" onDismiss={onDismiss} onAdapted={onAdapted} />
    )

    fireEvent.click(screen.getByText('Cập nhật kế hoạch'))

    await waitFor(() =>
      expect(api.adaptTrip).toHaveBeenCalledWith('trip-1', {
        alert_id: 'alert-1',
        session_id: 'sess-test-12345678',
      })
    )

    // Two-step flow: after preview, click accept
    await waitFor(() => expect(screen.getByText('Chấp nhận')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Chấp nhận'))

    await waitFor(() =>
      expect(api.acceptSwap).toHaveBeenCalledWith('trip-1', {
        alert_id: 'alert-1',
        session_id: 'sess-test-12345678',
      })
    )
    await waitFor(() => expect(onAdapted).toHaveBeenCalled())
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('alert-1'))
  })

  it('returns to Preview when the pending transit adaptation expired', async () => {
    api.adaptTrip.mockResolvedValue({ changes: ['Change A'] })
    api.acceptSwap.mockRejectedValue(new Error('No pending adaptation found for this trip'))
    render(<AlertBanner alert={makeAlert()} tripId="trip-1" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('Cập nhật kế hoạch'))
    fireEvent.click(await screen.findByText('Chấp nhận'))

    expect(await screen.findByText(/Bản xem trước đã hết hiệu lực/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cập nhật kế hoạch' })).toBeInTheDocument()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('returns to Preview when the pending weather adaptation expired', async () => {
    api.adaptTrip.mockResolvedValue({ changes: ['Swap outdoor stop'] })
    api.acceptSwap.mockRejectedValue(new Error('No pending adaptation found for this trip'))
    render(
      <AlertBanner
        alert={makeAlert({ alert_type: 'weather_warning' })}
        tripId="trip-1"
        onDismiss={onDismiss}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cập nhật kế hoạch' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cập nhật kế hoạch' }))

    expect(await screen.findByText(/Bản xem trước đã hết hiệu lực/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cập nhật kế hoạch' })).toBeInTheDocument()
    expect(onDismiss).not.toHaveBeenCalled()
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
    expect(screen.getByText('Cập nhật kế hoạch')).not.toBeDisabled()
  })

  it('dismiss button is disabled while adapt is in-flight', async () => {
    let resolve
    api.adaptTrip.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<AlertBanner alert={makeAlert()} tripId="trip-1" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('Cập nhật kế hoạch'))
    expect(await screen.findByText('Đang cập nhật...')).toBeInTheDocument()
    expect(screen.getByText('Bỏ qua')).toBeDisabled()

    resolve({})
    await waitFor(() => expect(screen.queryByText('Đang cập nhật...')).not.toBeInTheDocument())
    expect(screen.getByText('Bỏ qua')).not.toBeDisabled()
  })

  it('clears stale adaptError when alert.id changes', async () => {
    api.adaptTrip.mockRejectedValue(new Error('Timeout'))
    const { rerender } = render(
      <AlertBanner alert={makeAlert({ id: 'a1' })} tripId="trip-1" onDismiss={onDismiss} />
    )
    fireEvent.click(screen.getByText('Cập nhật kế hoạch'))
    await waitFor(() => expect(screen.getByText('Timeout')).toBeInTheDocument())

    rerender(<AlertBanner alert={makeAlert({ id: 'a2' })} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.queryByText('Timeout')).not.toBeInTheDocument()
  })
})

// --- dev20: closing_risk banner ---

const makeClosingRisk = (resolutionOverrides = {}, alertOverrides = {}) => ({
  id: 'cr-1',
  alert_type: 'closing_risk',
  trip_id: 'trip-1',
  day_number: 1,
  message: 'fallback message',
  metadata: {
    place_id: 'p3',
    place_name: 'Tràng An',
    projected_arrival: '18:25',
    close_time: '18:00',
    deficit_min: 25,
    resolutions: {
      leave_earlier: { feasible: true, current_place_name: 'P2', target_leave_time: '17:40', save_minutes: 20 },
      skip: { feasible: true },
      push: {
        feasible: true,
        day_capacity: [
          { day: 2, date: '2026-06-12', weekday: 'Friday', remaining_minutes: 120, status: 'room' },
          { day: 3, date: '2026-06-13', weekday: 'Saturday', remaining_minutes: 0, status: 'full' },
          { day: 4, date: '2026-06-14', weekday: 'Sunday', remaining_minutes: 0, status: 'closed' },
        ],
      },
      ...resolutionOverrides,
    },
    ...alertOverrides,
  },
})

describe('AlertBanner closing_risk', () => {
  const onDismiss = vi.fn()
  const onAdapted = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => (key === 'imove_lang' ? 'vi' : 'sess-test-12345678')),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
  })

  it('renders the header and only the feasible actions (leave_earlier recommended)', () => {
    render(<AlertBanner alert={makeClosingRisk()} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.getByText(/Tràng An đóng cửa lúc 18:00/)).toBeInTheDocument()
    expect(screen.getByText('Nên dùng')).toBeInTheDocument()
    expect(screen.getByText(/Rời P2 trước 17:40/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bỏ điểm này/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Đẩy sang ngày khác/ })).toBeInTheDocument()
  })

  it('leave_earlier action calls adaptTrip with resolution leave_earlier', async () => {
    api.adaptTrip.mockResolvedValue({ adapted: true, changes: ['Rời P2 trước 17:40'] })
    render(<AlertBanner alert={makeClosingRisk()} tripId="trip-1" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /Rời sớm hơn/ }))
    await waitFor(() =>
      expect(api.adaptTrip).toHaveBeenCalledWith('trip-1', {
        alert_id: 'cr-1', session_id: 'sess-test-12345678',
        resolution: 'leave_earlier', target_day: null,
      })
    )
  })

  it('push expands the day picker with status badges; closed day is disabled', () => {
    render(<AlertBanner alert={makeClosingRisk()} tripId="trip-1" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /Đẩy sang ngày khác/ }))
    expect(screen.getByText('còn ~2h')).toBeInTheDocument()
    expect(screen.getByText('Đã đầy')).toBeInTheDocument()
    expect(screen.getByText('Đóng cửa Sunday')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ngày 4/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Ngày 2/ })).not.toBeDisabled()
  })

  it('selecting a day calls adaptTrip with resolution push + target_day', async () => {
    api.adaptTrip.mockResolvedValue({ adapted: true, changes: ['Moved'] })
    render(<AlertBanner alert={makeClosingRisk()} tripId="trip-1" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /Đẩy sang ngày khác/ }))
    fireEvent.click(screen.getByRole('button', { name: /Ngày 2/ }))
    await waitFor(() =>
      expect(api.adaptTrip).toHaveBeenCalledWith('trip-1', {
        alert_id: 'cr-1', session_id: 'sess-test-12345678',
        resolution: 'push', target_day: 2,
      })
    )
  })

  it('shows the reason text when push is infeasible (closed_all) and hides the push button', () => {
    const alert = makeClosingRisk({ push: { feasible: false, reason: 'closed_all', day_capacity: [] } })
    render(<AlertBanner alert={alert} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.queryByRole('button', { name: /Đẩy sang ngày khác/ })).not.toBeInTheDocument()
    expect(screen.getByText(/đóng cửa vào tất cả các ngày còn lại/)).toBeInTheDocument()
  })

  it('shows no_other_day reason when there is no other day', () => {
    const alert = makeClosingRisk({ push: { feasible: false, reason: 'no_other_day', day_capacity: [] } })
    render(<AlertBanner alert={alert} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.getByText(/đây là ngày cuối/)).toBeInTheDocument()
  })

  it('hides leave_earlier card when infeasible but keeps skip', () => {
    const alert = makeClosingRisk({ leave_earlier: { feasible: false } })
    render(<AlertBanner alert={alert} tripId="trip-1" onDismiss={onDismiss} />)
    expect(screen.queryByText('Nên dùng')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bỏ điểm này/ })).toBeInTheDocument()
  })

  it('skip → preview → confirm calls acceptSwap', async () => {
    api.adaptTrip.mockResolvedValue({ adapted: true, changes: ['Skipped Tràng An'], delta_active_time: -30 })
    api.acceptSwap.mockResolvedValue({})
    render(<AlertBanner alert={makeClosingRisk()} tripId="trip-1" onDismiss={onDismiss} onAdapted={onAdapted} />)

    fireEvent.click(screen.getByRole('button', { name: /Bỏ điểm này/ }))
    await waitFor(() =>
      expect(api.adaptTrip).toHaveBeenCalledWith('trip-1', {
        alert_id: 'cr-1', session_id: 'sess-test-12345678', resolution: 'skip', target_day: null,
      })
    )
    fireEvent.click(await screen.findByText('Xác nhận'))
    await waitFor(() =>
      expect(api.acceptSwap).toHaveBeenCalledWith('trip-1', {
        alert_id: 'cr-1', session_id: 'sess-test-12345678',
      })
    )
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith('cr-1'))
  })

  it('returns to resolution choices when the pending closing-risk adaptation expired', async () => {
    api.adaptTrip.mockResolvedValue({ adapted: true, changes: ['Skipped Tràng An'] })
    api.acceptSwap.mockRejectedValue(new Error('No pending adaptation found for this trip'))
    render(<AlertBanner alert={makeClosingRisk()} tripId="trip-1" onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: /Bỏ điểm này/ }))
    fireEvent.click(await screen.findByText('Xác nhận'))

    expect(await screen.findByText(/Bản xem trước đã hết hiệu lực/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bỏ điểm này/ })).toBeInTheDocument()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('surfaces the backend reason when an action is rejected (adapted=false)', async () => {
    api.adaptTrip.mockResolvedValue({ adapted: false, changes: ['Cannot move — closed on Sunday'] })
    render(<AlertBanner alert={makeClosingRisk()} tripId="trip-1" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: /Bỏ điểm này/ }))
    await waitFor(() => expect(screen.getByText('Cannot move — closed on Sunday')).toBeInTheDocument())
  })
})
