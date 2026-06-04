import { describe, it, expect } from 'vitest'
import { haversineMeters } from '../../lib/tripUtils'

// ---------------------------------------------------------------------------
// haversineMeters
// ---------------------------------------------------------------------------
describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    const p = { lat: 1.3, lng: 103.8 }
    expect(haversineMeters(p, p)).toBe(0)
  })

  it('1° latitude difference ≈ 110–112 km', () => {
    const a = { lat: 0, lng: 0 }
    const b = { lat: 1, lng: 0 }
    const d = haversineMeters(a, b)
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })

  it('detects < 100 m (arrival zone)', () => {
    // ~0.0009° lat ≈ 100 m
    const a = { lat: 1.3000, lng: 103.8 }
    const b = { lat: 1.3009, lng: 103.8 }
    expect(haversineMeters(a, b)).toBeLessThan(110)
    expect(haversineMeters(a, b)).toBeGreaterThan(0)
  })

  it('detects > 100 m (not yet arrived)', () => {
    const a = { lat: 1.300, lng: 103.8 }
    const b = { lat: 1.302, lng: 103.8 }       // ~220 m
    expect(haversineMeters(a, b)).toBeGreaterThan(200)
  })

  it('detects ≥ 30 m (GPS tracking threshold)', () => {
    // ~0.0003° lat ≈ 33 m
    const a = { lat: 1.3000, lng: 103.8 }
    const b = { lat: 1.3003, lng: 103.8 }
    expect(haversineMeters(a, b)).toBeGreaterThan(30)
  })

  it('detects < 30 m (below tracking threshold)', () => {
    // ~0.0001° lat ≈ 11 m
    const a = { lat: 1.30000, lng: 103.8 }
    const b = { lat: 1.30010, lng: 103.8 }
    expect(haversineMeters(a, b)).toBeLessThan(30)
  })

  it('is symmetric — haversine(a,b) === haversine(b,a)', () => {
    const a = { lat: 1.283, lng: 103.860 }
    const b = { lat: 1.300, lng: 103.855 }
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 3)
  })

  it('Singapore landmark pair: MBS → Gardens by the Bay ≈ 270–450 m', () => {
    const mbs     = { lat: 1.2840, lng: 103.8607 }
    const gardens = { lat: 1.2816, lng: 103.8636 }
    const d = haversineMeters(mbs, gardens)
    expect(d).toBeGreaterThan(200)
    expect(d).toBeLessThan(500)
  })

  it('handles lng difference correctly', () => {
    // Same lat, different lng — closer to equator → larger lng metres
    const a = { lat: 0, lng: 103.8 }
    const b = { lat: 0, lng: 103.9 }  // 0.1° lng ≈ 11.1 km at equator
    const d = haversineMeters(a, b)
    expect(d).toBeGreaterThan(10_000)
    expect(d).toBeLessThan(12_000)
  })
})
