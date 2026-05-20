import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useTrip } from '../../hooks/useTrip'

vi.mock('../../services/api', () => ({
  api: { getTrip: vi.fn() },
}))

import { api } from '../../services/api'

const TRIP = { id: 'trip-1', days: [], places: [] }

describe('useTrip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts with loading=false and trip=null when no tripId', () => {
    const { result } = renderHook(() => useTrip(null))
    expect(result.current.loading).toBe(false)
    expect(result.current.trip).toBeNull()
  })

  it('fetches trip and sets loading correctly', async () => {
    api.getTrip.mockResolvedValue(TRIP)
    const { result } = renderHook(() => useTrip('trip-1'))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.trip).toEqual(TRIP)
    expect(result.current.error).toBeNull()
    expect(api.getTrip).toHaveBeenCalledWith('trip-1')
  })

  it('sets error when fetch fails', async () => {
    const err = new Error('Not found')
    api.getTrip.mockRejectedValue(err)
    const { result } = renderHook(() => useTrip('trip-1'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(err)
    expect(result.current.trip).toBeNull()
  })

  it('resets state and re-fetches when tripId changes', async () => {
    api.getTrip.mockResolvedValue(TRIP)
    const { result, rerender } = renderHook(({ id }) => useTrip(id), {
      initialProps: { id: 'trip-1' },
    })
    await waitFor(() => expect(result.current.trip).toEqual(TRIP))

    api.getTrip.mockResolvedValue({ ...TRIP, id: 'trip-2' })
    rerender({ id: 'trip-2' })

    expect(result.current.trip).toBeNull()
    await waitFor(() => expect(result.current.trip?.id).toBe('trip-2'))
  })

  it('refresh() re-fetches the trip', async () => {
    api.getTrip.mockResolvedValue(TRIP)
    const { result } = renderHook(() => useTrip('trip-1'))
    await waitFor(() => expect(result.current.trip).toEqual(TRIP))

    const updated = { ...TRIP, days: [{ day: 1, legs: [] }] }
    api.getTrip.mockResolvedValue(updated)
    await act(async () => { await result.current.refresh() })

    expect(result.current.trip).toEqual(updated)
    expect(api.getTrip).toHaveBeenCalledTimes(2)
  })

  it('does not setState after unmount (ignore flag)', async () => {
    let resolve
    api.getTrip.mockReturnValue(new Promise((r) => { resolve = r }))
    const { result, unmount } = renderHook(() => useTrip('trip-1'))

    expect(result.current.loading).toBe(true)
    unmount()
    // Resolving after unmount should not cause any state update or warning
    await act(async () => { resolve(TRIP) })
    // No error thrown = ignore flag working
  })
})
