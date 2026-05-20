import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useAlerts } from '../../hooks/useAlerts'

const mockSubscribe = vi.fn()
const mockOn = vi.fn()
const mockChannel = vi.fn()
const mockRemoveChannel = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    channel: (...args) => mockChannel(...args),
    removeChannel: (...args) => mockRemoveChannel(...args),
  },
}))

// Sets up the full supabase mock chain.
// channelRef is the object subscribe() returns — same one removeChannel() should receive.
// getHandler() returns the realtime INSERT handler captured from .on() call.
function setupMocks({ initialData = [] } = {}) {
  const channelRef = { _name: 'mock-channel' }
  mockEq.mockResolvedValue({ data: initialData, error: null })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
  mockSubscribe.mockReturnValue(channelRef)
  let capturedHandler = null
  mockOn.mockImplementation((_event, _filter, handler) => {
    capturedHandler = handler
    return { subscribe: mockSubscribe }
  })
  mockChannel.mockReturnValue({ on: mockOn })
  return { channelRef, getHandler: () => capturedHandler }
}

describe('useAlerts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not subscribe when tripId is null', () => {
    setupMocks()
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

  it('subscribes only to INSERT events on lta_alerts', async () => {
    setupMocks()
    renderHook(() => useAlerts('trip-1'))
    await act(async () => {})
    expect(mockOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ event: 'INSERT', table: 'lta_alerts' }),
      expect.any(Function)
    )
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
    const { getHandler } = setupMocks({ initialData: [] })
    const { result } = renderHook(() => useAlerts('trip-1'))
    await act(async () => {})

    const newAlert = { id: '99', alert_type: 'weather_warning', message: 'Rain', trip_id: 'trip-1' }
    act(() => getHandler()({ new: newAlert }))

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

  it('removes the correct channel object on unmount', async () => {
    const { channelRef } = setupMocks()
    const { unmount } = renderHook(() => useAlerts('trip-1'))
    await act(async () => {})
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1)
    expect(mockRemoveChannel).toHaveBeenCalledWith(channelRef)
  })

  it('ignores initial fetch result after unmount (ignore flag)', async () => {
    let resolveQuery
    mockEq.mockReturnValue(new Promise((r) => { resolveQuery = r }))
    mockSelect.mockReturnValue({ eq: mockEq })
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSubscribe.mockReturnValue({})
    mockOn.mockReturnValue({ subscribe: mockSubscribe })
    mockChannel.mockReturnValue({ on: mockOn })

    const { result, unmount } = renderHook(() => useAlerts('trip-1'))
    unmount()
    await act(async () => {
      resolveQuery({ data: [{ id: '1', alert_type: 'transport_alert' }], error: null })
    })
    expect(result.current.alerts).toHaveLength(0)
  })
})
