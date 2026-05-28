import { describe, it, expect, beforeEach } from 'vitest'
import { migrateLocalStorage } from '../../lib/migrate'

describe('migrateLocalStorage', () => {
  beforeEach(() => localStorage.clear())

  it('is a no-op when old key does not exist', () => {
    migrateLocalStorage()
    expect(localStorage.getItem('imove_trips_guest')).toBeNull()
  })

  it('moves imove_trips to imove_trips_guest when guest bucket is empty', () => {
    localStorage.setItem('imove_trips', JSON.stringify([{ id: 't1', name: 'Old Trip' }]))
    migrateLocalStorage()
    const guest = JSON.parse(localStorage.getItem('imove_trips_guest'))
    expect(guest).toHaveLength(1)
    expect(guest[0].id).toBe('t1')
  })

  it('removes the old key after migration', () => {
    localStorage.setItem('imove_trips', JSON.stringify([{ id: 't1' }]))
    migrateLocalStorage()
    expect(localStorage.getItem('imove_trips')).toBeNull()
  })

  it('merges old trips into existing guest bucket without duplicates', () => {
    localStorage.setItem('imove_trips_guest', JSON.stringify([{ id: 't1', name: 'Existing' }]))
    localStorage.setItem('imove_trips', JSON.stringify([
      { id: 't1', name: 'Old duplicate' },
      { id: 't2', name: 'New trip' },
    ]))
    migrateLocalStorage()
    const guest = JSON.parse(localStorage.getItem('imove_trips_guest'))
    expect(guest).toHaveLength(2)
    expect(guest.find((t) => t.id === 't1').name).toBe('Existing')
    expect(guest.find((t) => t.id === 't2').name).toBe('New trip')
  })

  it('migrates imove_trip_data to imove_trip_data_guest when guest cache is empty', () => {
    localStorage.setItem('imove_trip_data', JSON.stringify({ 't1': { days: [1] } }))
    migrateLocalStorage()
    const cache = JSON.parse(localStorage.getItem('imove_trip_data_guest'))
    expect(cache['t1']).toEqual({ days: [1] })
    expect(localStorage.getItem('imove_trip_data')).toBeNull()
  })

  it('does not overwrite existing trip data cache on migration', () => {
    localStorage.setItem('imove_trip_data_guest', JSON.stringify({ 't1': { days: [2] } }))
    localStorage.setItem('imove_trip_data', JSON.stringify({ 't1': { days: [99] } }))
    migrateLocalStorage()
    const cache = JSON.parse(localStorage.getItem('imove_trip_data_guest'))
    expect(cache['t1']).toEqual({ days: [2] })
  })

  it('is idempotent — running twice does nothing on second run', () => {
    localStorage.setItem('imove_trips', JSON.stringify([{ id: 't1' }]))
    migrateLocalStorage()
    migrateLocalStorage()
    const guest = JSON.parse(localStorage.getItem('imove_trips_guest'))
    expect(guest).toHaveLength(1)
  })
})
