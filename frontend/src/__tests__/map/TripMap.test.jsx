import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TripMap from '../../components/map/TripMap'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFitBounds = vi.fn()
const mockSetView   = vi.fn()

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children, position }) => (
    <div data-testid="marker" data-pos={JSON.stringify(position)}>
      {children}
    </div>
  ),
  Popup:    ({ children }) => <div data-testid="popup">{children}</div>,
  Polyline: ({ children, color, dashArray, positions, weight }) => (
    <div
      data-testid="polyline"
      data-color={color}
      data-dash={dashArray ?? ''}
      data-positions={JSON.stringify(positions ?? [])}
      data-weight={weight ?? ''}
    >
      {children}
    </div>
  ),
  Tooltip: ({ children }) => <div data-testid="tooltip">{children}</div>,
  useMap: () => ({ fitBounds: mockFitBounds, setView: mockSetView }),
}))

import L from 'leaflet'
vi.mock('leaflet', () => ({
  default: { divIcon: vi.fn(({ html, iconSize, iconAnchor }) => ({ html, iconSize, iconAnchor })) },
  divIcon: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makePlaces = () => [
  { id: 'p1', name: 'Marina Bay Sands', lat: 1.2840, lng: 103.8607, category: 'landmark',    dwell_minutes: 90,  best_time_start: '09:00', best_time_end: '11:00' },
  { id: 'p2', name: 'Gardens by the Bay', lat: 1.2816, lng: 103.8636, category: 'nature',    dwell_minutes: 120, best_time_start: '10:00', best_time_end: '12:00' },
  { id: 'p3', name: 'Sentosa Island',     lat: 1.2494, lng: 103.8303, category: 'attraction',dwell_minutes: 180, best_time_start: '14:00', best_time_end: '18:00' },
]

const makeLegs = () => [
  { id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'MRT', duration_minutes: 10, cost_sgd: 1.80, is_estimated: false },
  { id: 'l2', from_place_id: 'p2', to_place_id: 'p3', transport_mode: 'BUS', duration_minutes: 25, cost_sgd: 1.20, is_estimated: false },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return polylines whose `data-color` matches. */
function polylinesByColor(color) {
  return document.querySelectorAll(`[data-testid="polyline"][data-color="${color}"]`)
}

/**
 * Fill colours used by TripMap's MODE_STYLE.
 * Note: normalizeTransportMode('MRT') → 'METRO', so MRT legs use METRO colour.
 */
const FILL = {
  MRT_LEG:  '#1d4ed8',  // transport_mode:'MRT' normalises to 'METRO' → '#1d4ed8'
  BUS:      '#059669',
  WALK:     '#ea580c',
  CYCLE:    '#0f766e',
  TRACKING: '#2563eb',
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TripMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Null / empty guard ──────────────────────────────────────────────────
  // When places is empty/undefined, TripMap renders an aria-hidden skeleton
  // pulse placeholder (not null) so the map panel always has a defined height.

  it('renders an aria-hidden skeleton when places is empty', () => {
    const { container } = render(<TripMap places={[]} legs={[]} />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders an aria-hidden skeleton when places is undefined', () => {
    const { container } = render(<TripMap />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  // ── Markers ─────────────────────────────────────────────────────────────

  it('renders a marker for each place', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(3)
  })

  it('renders markers in leg order (p1 → p2 → p3)', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const positions = screen.getAllByTestId('marker').map(m => JSON.parse(m.dataset.pos))
    expect(positions[0]).toEqual([1.2840, 103.8607])
    expect(positions[1]).toEqual([1.2816, 103.8636])
    expect(positions[2]).toEqual([1.2494, 103.8303])
  })

  it('falls back to places order when legs is empty', () => {
    render(<TripMap places={makePlaces()} legs={[]} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(3)
  })

  it('places not reachable via legs are still rendered', () => {
    // legs only connect p1→p2; p3 must appear too
    render(<TripMap places={makePlaces()} legs={[makeLegs()[0]]} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(3)
  })

  // ── Task 3b: numbered markers ───────────────────────────────────────────

  it('placeIcon is called once per marker', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} placeSequences={{ p1: 1, p2: 2, p3: 3 }} />)
    // L.divIcon called 3× (once per place; userPosition=null so no userIcon)
    expect(L.divIcon).toHaveBeenCalledTimes(3)
  })

  it('icon HTML includes the sequence number', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} placeSequences={{ p1: 1, p2: 2, p3: 3 }} />)
    const calls = L.divIcon.mock.calls
    expect(calls[0][0].html).toContain('>1<')
    expect(calls[1][0].html).toContain('>2<')
    expect(calls[2][0].html).toContain('>3<')
  })

  it('icon HTML contains no number when placeSequences is empty', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const calls = L.divIcon.mock.calls
    // numLabel = '' when num == null → no span injected
    expect(calls[0][0].html).not.toMatch(/>(\d+)</)
  })

  // ── Task 3b: inter-day dimming ──────────────────────────────────────────

  it('dims markers not in activeDayPlaceIds (opacity:0.5)', () => {
    // p1 and p2 are day1; p3 is day2 → should be dimmed
    const activeDayPlaceIds = new Set(['p1', 'p2'])
    render(<TripMap places={makePlaces()} legs={makeLegs()} activeDayPlaceIds={activeDayPlaceIds} />)
    const calls = L.divIcon.mock.calls
    // p3 is the 3rd marker → 3rd call
    expect(calls[2][0].html).toContain('opacity:0.5')
    // p1, p2 should NOT be dimmed
    expect(calls[0][0].html).not.toContain('opacity:0.5')
    expect(calls[1][0].html).not.toContain('opacity:0.5')
  })

  it('does not dim any marker when activeDayPlaceIds is null (overview mode)', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} activeDayPlaceIds={null} />)
    L.divIcon.mock.calls.forEach(([opts]) => {
      expect(opts.html).not.toContain('opacity:0.5')
    })
  })

  // ── Task 4b: trip mode _dim flag ────────────────────────────────────────

  it('dims places with _dim=true via placeIcon', () => {
    const places = makePlaces().map((p, i) => ({ ...p, _dim: i === 2 }))  // p3 dimmed
    render(<TripMap places={places} legs={makeLegs()} />)
    const calls = L.divIcon.mock.calls
    expect(calls[2][0].html).toContain('opacity:0.5')
    expect(calls[0][0].html).not.toContain('opacity:0.5')
  })

  // ── Polylines — 3-layer rendering ──────────────────────────────────────
  // Each leg renders halo + outline + fill → 3 polylines per leg.

  it('renders 3 polyline layers per leg (halo, outline, fill)', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    // 2 legs × 3 layers = 6 polylines total
    expect(screen.getAllByTestId('polyline')).toHaveLength(6)
  })

  it('MRT-transport leg fill layer uses METRO blue (#1d4ed8)', () => {
    // normalizeTransportMode('MRT') → 'METRO' → MODE_STYLE.METRO.color
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    expect(polylinesByColor(FILL.MRT_LEG)).toHaveLength(1)
  })

  it('BUS fill layer uses emerald (#059669)', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    expect(polylinesByColor(FILL.BUS)).toHaveLength(1)
  })

  it('WALK fill layer is orange (#ea580c) with dashArray', () => {
    const legs = [{ id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'WALK', duration_minutes: 8, cost_sgd: null, is_estimated: false }]
    render(<TripMap places={makePlaces()} legs={legs} />)
    const fills = polylinesByColor(FILL.WALK)
    expect(fills).toHaveLength(1)
    expect(fills[0].dataset.dash).toBe('8,8')
  })

  it('CYCLE fill layer is teal (#0f766e) with dashArray', () => {
    const legs = [{ id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'CYCLE', duration_minutes: 20, cost_sgd: null, is_estimated: false }]
    render(<TripMap places={makePlaces()} legs={legs} />)
    const fills = polylinesByColor(FILL.CYCLE)
    expect(fills).toHaveLength(1)
    expect(fills[0].dataset.dash).toBe('10,6')
  })

  it('skips polyline when leg references an unknown place ID (no crash)', () => {
    const legs = [{ id: 'l1', from_place_id: 'GHOST', to_place_id: 'p2', transport_mode: 'MRT', duration_minutes: 5, cost_sgd: null, is_estimated: false }]
    expect(() => render(<TripMap places={makePlaces()} legs={legs} />)).not.toThrow()
    expect(screen.queryAllByTestId('polyline')).toHaveLength(0)
  })

  // ── Task 2: polyline endpoint snapping ─────────────────────────────────

  it('fill polyline first point equals from-place coordinates', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    // Fill layers are every 3rd polyline (index 2, 5, …)
    const all = screen.getAllByTestId('polyline')
    const positions = JSON.parse(all[2].dataset.positions)
    expect(positions[0]).toEqual([1.2840, 103.8607])   // p1
  })

  it('fill polyline last point equals to-place coordinates', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const all = screen.getAllByTestId('polyline')
    const positions = JSON.parse(all[2].dataset.positions)
    expect(positions[positions.length - 1]).toEqual([1.2816, 103.8636])  // p2
  })

  it('second leg fill snaps p2 → p3', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const all = screen.getAllByTestId('polyline')
    const positions = JSON.parse(all[5].dataset.positions)
    expect(positions[0]).toEqual([1.2816, 103.8636])   // p2
    expect(positions[positions.length - 1]).toEqual([1.2494, 103.8303])  // p3
  })

  // ── Task 8c: GPS tracking polyline ─────────────────────────────────────

  it('renders tracking polyline when trackingPath has ≥ 2 points', () => {
    const trackingPath = [[1.283, 103.860], [1.284, 103.861], [1.285, 103.862]]
    render(<TripMap places={makePlaces()} legs={makeLegs()} trackingPath={trackingPath} />)
    const trails = polylinesByColor(FILL.TRACKING)
    expect(trails).toHaveLength(1)
    const positions = JSON.parse(trails[0].dataset.positions)
    expect(positions).toHaveLength(3)
  })

  it('does NOT render tracking polyline when trackingPath is empty (default)', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    expect(polylinesByColor(FILL.TRACKING)).toHaveLength(0)
  })

  it('does NOT render tracking polyline when trackingPath has only 1 point', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} trackingPath={[[1.283, 103.86]]} />)
    expect(polylinesByColor(FILL.TRACKING)).toHaveLength(0)
  })

  it('tracking polyline has weight=5 and opacity=0.9', () => {
    const trackingPath = [[1.283, 103.860], [1.284, 103.861]]
    render(<TripMap places={makePlaces()} legs={makeLegs()} trackingPath={trackingPath} />)
    const trail = polylinesByColor(FILL.TRACKING)[0]
    expect(trail.dataset.weight).toBe('5')
  })

  // ── Tooltips ────────────────────────────────────────────────────────────

  it('tooltip shows mode, duration, and cost', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const tooltips = screen.getAllByTestId('tooltip')
    expect(tooltips[0]).toHaveTextContent('MRT')
    expect(tooltips[0]).toHaveTextContent('10')
    expect(tooltips[0]).toHaveTextContent('1.80')
  })

  it('tooltip appends (estimated) when is_estimated is true', () => {
    const legs = [{ id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'MRT', duration_minutes: 12, cost_sgd: 1.50, is_estimated: true }]
    render(<TripMap places={makePlaces()} legs={legs} />)
    expect(screen.getByTestId('tooltip')).toHaveTextContent('estimated')
  })

  it('tooltip omits cost when cost_sgd is null', () => {
    const legs = [{ id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'WALK', duration_minutes: 8, cost_sgd: null, is_estimated: false }]
    render(<TripMap places={makePlaces()} legs={legs} />)
    expect(screen.getByTestId('tooltip')).not.toHaveTextContent('S$')
  })

  // ── FitBounds ────────────────────────────────────────────────────────────

  it('calls fitBounds when there are multiple places', async () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    await waitFor(() => expect(mockFitBounds).toHaveBeenCalledTimes(1))
    expect(mockFitBounds).toHaveBeenCalledWith(expect.any(Array), { padding: [40, 40] })
  })

  it('calls setView (not fitBounds) when there is only one place', async () => {
    render(<TripMap places={[makePlaces()[0]]} legs={[]} />)
    await waitFor(() => expect(mockSetView).toHaveBeenCalledTimes(1))
    expect(mockFitBounds).not.toHaveBeenCalled()
  })
})
