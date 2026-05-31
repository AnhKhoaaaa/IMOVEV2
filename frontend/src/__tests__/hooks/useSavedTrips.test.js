import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSavedTrips } from '../../hooks/useSavedTrips'
import { computeTripStatus } from '../../lib/tripUtils'

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

  // ── isDraft flag propagation ──────────────────────────────────────────────

  it('passes isDraft=true from stored meta to computeTripStatus', () => {
    api.getSavedTrips.mockReturnValue([
      { id: 't1', startDate: '2030-01-01', numDays: 3, isDraft: true },
    ])
    renderHook(() => useSavedTrips(null))
    expect(computeTripStatus).toHaveBeenCalledWith('2030-01-01', 3, true)
  })

  it('passes isDraft=false when flag absent (backward compat)', () => {
    api.getSavedTrips.mockReturnValue([
      { id: 't2', startDate: '2030-01-01', numDays: 2 },
    ])
    renderHook(() => useSavedTrips(null))
    expect(computeTripStatus).toHaveBeenCalledWith('2030-01-01', 2, false)
  })
})

// ── computeTripStatus — isDraft override (real implementation) ────────────────

describe('computeTripStatus — isDraft', () => {
  // Use the real implementation, not the mock
  it('returns draft when isDraft=true even with a future startDate', async () => {
    const { computeTripStatus: real } = await vi.importActual('../../lib/tripUtils')
    expect(real('2099-12-31', 3, true)).toBe('draft')
  })

  it('returns draft when isDraft=true even with today startDate', async () => {
    const { computeTripStatus: real } = await vi.importActual('../../lib/tripUtils')
    const today = new Date().toISOString().slice(0, 10)
    expect(real(today, 1, true)).toBe('draft')
  })

  it('returns upcoming normally when isDraft=false and date is future', async () => {
    const { computeTripStatus: real } = await vi.importActual('../../lib/tripUtils')
    expect(real('2099-12-31', 3, false)).toBe('upcoming')
  })

  it('returns draft when isDraft omitted and no startDate', async () => {
    const { computeTripStatus: real } = await vi.importActual('../../lib/tripUtils')
    expect(real(null, 3)).toBe('draft')
  })
})
