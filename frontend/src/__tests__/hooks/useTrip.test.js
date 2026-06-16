import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useTrip } from '../../hooks/useTrip'

vi.mock('../../services/api', () => ({
  api: {
    getTrip: vi.fn(),
    cacheTripData: vi.fn(),
    getCachedTripData: vi.fn(() => null),
  },
}))

import { api } from '../../services/api'

const mockTrip = { id: 'trip-1', days: [], places: [] }

describe('useTrip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fetches trip on mount and sets trip state', async () => {
    api.getTrip.mockResolvedValue(mockTrip)
    const { result } = renderHook(() => useTrip('trip-1'))
    await waitFor(() => expect(result.current.trip).toEqual(mockTrip))
    expect(result.current.loading).toBe(false)
    expect(result.current.isOffline).toBe(false)
  })

  it('caches trip data with provided userId', async () => {
    api.getTrip.mockResolvedValue(mockTrip)
    const { result } = renderHook(() => useTrip('trip-1', 'user-a'))
    await waitFor(() => expect(result.current.trip).toEqual(mockTrip))
    expect(api.cacheTripData).toHaveBeenCalledWith('trip-1', mockTrip, 'user-a')
  })

  it('caches with null userId when no userId given', async () => {
    api.getTrip.mockResolvedValue(mockTrip)
    const { result } = renderHook(() => useTrip('trip-1'))
    await waitFor(() => expect(result.current.trip).toEqual(mockTrip))
    expect(api.cacheTripData).toHaveBeenCalledWith('trip-1', mockTrip, null)
  })

  it('reads offline cache with provided userId on fetch failure', async () => {
    api.getTrip.mockRejectedValue(new Error('network'))
    api.getCachedTripData.mockReturnValue(mockTrip)
    const { result } = renderHook(() => useTrip('trip-1', 'user-a'))
    await waitFor(() => expect(result.current.trip).toEqual(mockTrip))
    expect(result.current.isOffline).toBe(true)
    expect(api.getCachedTripData).toHaveBeenCalledWith('trip-1', 'user-a')
  })

  it('reads offline cache with null userId when no userId given', async () => {
    api.getTrip.mockRejectedValue(new Error('network'))
    api.getCachedTripData.mockReturnValue(mockTrip)
    const { result } = renderHook(() => useTrip('trip-1'))
    await waitFor(() => expect(result.current.isOffline).toBe(true))
    expect(api.getCachedTripData).toHaveBeenCalledWith('trip-1', null)
  })

  it('sets error when fetch fails and no cached data', async () => {
    api.getTrip.mockRejectedValue(new Error('network'))
    api.getCachedTripData.mockReturnValue(null)
    const { result } = renderHook(() => useTrip('trip-1', 'user-a'))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.trip).toBeNull()
  })

  it('re-fetches when userId changes to avoid showing another user cache', async () => {
    api.getTrip.mockResolvedValue(mockTrip)
    const { result, rerender } = renderHook(({ uid }) => useTrip('trip-1', uid), {
      initialProps: { uid: null },
    })
    await waitFor(() => expect(result.current.trip).toEqual(mockTrip))
    const callCount = api.getTrip.mock.calls.length
    rerender({ uid: 'user-a' })
    await waitFor(() => expect(api.getTrip.mock.calls.length).toBe(callCount + 1))
  })

  it('does not fall back to cached data on 401/403 auth errors', async () => {
    const err = new Error('Access denied')
    err.status = 403
    api.getTrip.mockRejectedValue(err)
    api.getCachedTripData.mockReturnValue(mockTrip)

    const { result } = renderHook(() => useTrip('trip-1', 'user-a'))

    await waitFor(() => expect(result.current.error).toBe(err))
    expect(result.current.trip).toBeNull()
    expect(result.current.isOffline).toBe(false)
    expect(api.getCachedTripData).not.toHaveBeenCalled()
  })
})
