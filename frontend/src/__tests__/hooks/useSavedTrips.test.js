import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSavedTrips } from '../../hooks/useSavedTrips'

vi.mock('../../services/api', () => ({
  api: {
    getSavedTrips: vi.fn(() => []),
    saveTrip: vi.fn(),
    deleteSavedTrip: vi.fn(),
  },
}))

vi.mock('../../lib/tripUtils', () => ({
  computeTripStatus: vi.fn(() => 'draft'),
}))

import { api } from '../../services/api'

describe('useSavedTrips', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls getSavedTrips with the provided userId', () => {
    renderHook(() => useSavedTrips('user-a'))
    expect(api.getSavedTrips).toHaveBeenCalledWith('user-a')
  })

  it('calls getSavedTrips with null for guest (no arg)', () => {
    renderHook(() => useSavedTrips())
    expect(api.getSavedTrips).toHaveBeenCalledWith(null)
  })

  it('save passes userId to api.saveTrip', () => {
    const { result } = renderHook(() => useSavedTrips('user-a'))
    act(() => result.current.save('trip-1', { name: 'Trip' }))
    expect(api.saveTrip).toHaveBeenCalledWith('trip-1', { name: 'Trip' }, 'user-a')
  })

  it('remove passes userId to api.deleteSavedTrip', () => {
    const { result } = renderHook(() => useSavedTrips('user-a'))
    act(() => result.current.remove('trip-1'))
    expect(api.deleteSavedTrip).toHaveBeenCalledWith('trip-1', 'user-a')
  })

  it('reloads with new userId when userId prop changes (auth switch)', () => {
    const { rerender } = renderHook(({ uid }) => useSavedTrips(uid), {
      initialProps: { uid: null },
    })
    expect(api.getSavedTrips).toHaveBeenCalledWith(null)
    act(() => rerender({ uid: 'user-a' }))
    expect(api.getSavedTrips).toHaveBeenCalledWith('user-a')
  })
})
