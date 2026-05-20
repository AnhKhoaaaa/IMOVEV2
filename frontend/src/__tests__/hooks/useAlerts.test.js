import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAlerts } from '../../hooks/useAlerts'

// Mock supabase
const mockSubscribe = vi.fn()
const mockOn = vi.fn()
const mockChannel = vi.fn()
const mockRemoveChannel = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockFrom = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    channel: (...args) => mockChannel(...args),
    removeChannel: (...args) => mockRemoveChannel(...args),
  },
}))

function setupMocks({ initialData = [], onHandler = null } = {}) {
  mockEq.mockResolvedValue({ data: initialData })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })

  let capturedHandler = onHandler
  mockOn.mockImplementation((_event, _filter, handler) => {
    capturedHandler = handler
    return { subscribe: mockSubscribe }
  })
  mockSubscribe.mockReturnValue({})
  mockChannel.mockReturnValue({ on: mockOn })

  return { getHandler: () => capturedHandler }
}

describe('useAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('does not subscribe when tripId is null', () => {
    renderHook(() => useAlerts(null))
    expect(mockChannel).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('uses unique channel name per tripId', async () => {
    setupMocks()
    renderHook(() => useAlerts('trip-abc'))
    await act(async () => {})
    expect(mockChannel).toHaveBeenCalledWith('trip-alerts-trip-abc')
  })

  it('fetches initial alerts from DB on mount', async () => {
    const initial = [{ id: '1', alert_type: 'transport_alert', message: 'Delay', trip_id: 'trip-1' }]
    setupMocks({ initialData: initial })
    const { result } = renderHook(() => useAlerts('trip-1'))

    await waitFor(() => expect(result.current.alerts).toHaveLength(1))
    expect(result.current.alerts[0].id).toBe('1')
    expect(mockFrom).toHaveBeenCalledWith('lta_alerts')
  })

  it('adds new alert when realtime INSERT fires', async () => {
    setupMocks({ initialData: [] })
    let capturedHandler
    mockOn.mockImplementation((_event, _filter, handler) => {
      capturedHandler = handler
      return { subscribe: mockSubscribe }
    })

    const { result } = renderHook(() => useAlerts('trip-1'))
    // flush initial fetch promise
    await act(async () => {})
    expect(result.current.alerts).toHaveLength(0)

    const newAlert = { id: '99', alert_type: 'weather_warning', message: 'Rain', trip_id: 'trip-1' }
    act(() => capturedHandler({ new: newAlert }))

    expect(result.current.alerts).toHaveLength(1)
    expect(result.current.alerts[0]).toEqual(newAlert)
  })

  it('dismiss() removes alert from state', async () => {
    const initial = [
      { id: 'a1', alert_type: 'transport_alert', message: 'Delay', trip_id: 'trip-1' },
      { id: 'a2', alert_type: 'weather_warning', message: 'Rain', trip_id: 'trip-1' },
    ]
    setupMocks({ initialData: initial })
    const { result } = renderHook(() => useAlerts('trip-1'))

    await waitFor(() => expect(result.current.alerts).toHaveLength(2))
    act(() => result.current.dismiss('a1'))
    expect(result.current.alerts).toHaveLength(1)
    expect(result.current.alerts[0].id).toBe('a2')
  })

  it('removes channel on unmount', () => {
    setupMocks()
    const mockChannelRef = {}
    mockSubscribe.mockReturnValue(mockChannelRef)
    mockOn.mockReturnValue({ subscribe: mockSubscribe })
    mockChannel.mockReturnValue({ on: mockOn })

    const { unmount } = renderHook(() => useAlerts('trip-1'))
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1)
  })
})
