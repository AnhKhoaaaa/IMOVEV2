import { describe, it, expect, beforeEach } from 'vitest'
import { api } from '../../services/api'

describe('api storage — per-user isolation', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves trips under user-specific key, invisible to other users', () => {
    api.saveTrip('trip-1', { name: 'User A Trip' }, 'user-a')
    expect(api.getSavedTrips('user-a')).toHaveLength(1)
    expect(api.getSavedTrips('user-b')).toHaveLength(0)
  })

  it('guest key is separate from logged-in user key', () => {
    api.saveTrip('trip-guest', { name: 'Guest Trip' }, null)
    api.saveTrip('trip-user', { name: 'User Trip' }, 'user-a')
    expect(api.getSavedTrips(null)).toHaveLength(1)
    expect(api.getSavedTrips('user-a')).toHaveLength(1)
    expect(api.getSavedTrips(null)[0].id).toBe('trip-guest')
    expect(api.getSavedTrips('user-a')[0].id).toBe('trip-user')
  })

  it('deleteSavedTrip only removes from the correct user key', () => {
    api.saveTrip('trip-1', { name: 'A trip' }, 'user-a')
    api.saveTrip('trip-1', { name: 'Same ID guest' }, null)
    api.deleteSavedTrip('trip-1', 'user-a')
    expect(api.getSavedTrips('user-a')).toHaveLength(0)
    expect(api.getSavedTrips(null)).toHaveLength(1)
  })

  it('cacheTripData and getCachedTripData use user-specific keys', () => {
    api.cacheTripData('trip-1', { days: [1, 2] }, 'user-a')
    expect(api.getCachedTripData('trip-1', 'user-a')).toEqual({ days: [1, 2] })
    expect(api.getCachedTripData('trip-1', null)).toBeNull()
  })

  it('omitting userId falls back to guest key (undefined == null)', () => {
    api.saveTrip('trip-anon', { name: 'Anon' })
    expect(api.getSavedTrips()).toHaveLength(1)
    expect(api.getSavedTrips(null)).toHaveLength(1)
    expect(api.getSavedTrips('any-user')).toHaveLength(0)
  })
})
