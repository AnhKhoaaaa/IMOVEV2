import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import TripMap from '../../components/map/TripMap'

const mockFitBounds = vi.fn()
const mockSetView = vi.fn()

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children, position }) => (
    <div data-testid="marker" data-pos={JSON.stringify(position)}>
      {children}
    </div>
  ),
  Popup: ({ children }) => <div data-testid="popup">{children}</div>,
  Polyline: ({ children, color, dashArray }) => (
    <div
      data-testid="polyline"
      data-color={color}
      data-dash={dashArray ?? ''}
    >
      {children}
    </div>
  ),
  Tooltip: ({ children }) => <div data-testid="tooltip">{children}</div>,
  useMap: () => ({ fitBounds: mockFitBounds, setView: mockSetView }),
}))

vi.mock('leaflet', () => ({
  default: { divIcon: vi.fn(() => ({})) },
  divIcon: vi.fn(() => ({})),
}))

// --- Fixtures ---

const makePlaces = () => [
  { id: 'p1', name: 'Marina Bay Sands', lat: 1.2840, lng: 103.8607, dwell_minutes: 90, best_time_start: '09:00', best_time_end: '11:00' },
  { id: 'p2', name: 'Gardens by the Bay', lat: 1.2816, lng: 103.8636, dwell_minutes: 120, best_time_start: '10:00', best_time_end: '12:00' },
  { id: 'p3', name: 'Sentosa Island', lat: 1.2494, lng: 103.8303, dwell_minutes: 180, best_time_start: '14:00', best_time_end: '18:00' },
]

const makeLegs = () => [
  { id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'MRT', duration_minutes: 10, cost_sgd: 1.80, is_estimated: false },
  { id: 'l2', from_place_id: 'p2', to_place_id: 'p3', transport_mode: 'BUS', duration_minutes: 25, cost_sgd: 1.20, is_estimated: false },
]

describe('TripMap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --- Null / empty guard ---

  it('renders nothing when places is empty', () => {
    const { container } = render(<TripMap places={[]} legs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when places is undefined', () => {
    const { container } = render(<TripMap />)
    expect(container.firstChild).toBeNull()
  })

  // --- Markers ---

  it('renders a marker for each place', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(3)
  })

  it('renders markers in leg order (p1 → p2 → p3)', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const markers = screen.getAllByTestId('marker')
    const positions = markers.map((m) => JSON.parse(m.dataset.pos))
    expect(positions[0]).toEqual([1.2840, 103.8607])  // p1
    expect(positions[1]).toEqual([1.2816, 103.8636])  // p2
    expect(positions[2]).toEqual([1.2494, 103.8303])  // p3
  })

  it('popup contains place name, dwell, and best time', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const popups = screen.getAllByTestId('popup')
    expect(popups[0]).toHaveTextContent('Marina Bay Sands')
    expect(popups[0]).toHaveTextContent('90 phút')
    expect(popups[0]).toHaveTextContent('09:00–11:00')
  })

  it('falls back to places order when legs is empty', () => {
    render(<TripMap places={makePlaces()} legs={[]} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(3)
  })

  // --- Polylines ---

  it('renders a polyline for each leg', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    expect(screen.getAllByTestId('polyline')).toHaveLength(2)
  })

  it('MRT leg polyline is red (#ef4444)', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const polylines = screen.getAllByTestId('polyline')
    expect(polylines[0]).toHaveAttribute('data-color', '#ef4444')
  })

  it('BUS leg polyline is green (#22c55e)', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const polylines = screen.getAllByTestId('polyline')
    expect(polylines[1]).toHaveAttribute('data-color', '#22c55e')
  })

  it('WALK leg polyline is orange with dashArray', () => {
    const legs = [{ id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'WALK', duration_minutes: 8, cost_sgd: null, is_estimated: false }]
    render(<TripMap places={makePlaces()} legs={legs} />)
    const polyline = screen.getByTestId('polyline')
    expect(polyline).toHaveAttribute('data-color', '#f97316')
    expect(polyline).toHaveAttribute('data-dash', '5,5')
  })

  it('DRIVE and CYCLE legs use blue (#3b82f6)', () => {
    const legs = [
      { id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'DRIVE', duration_minutes: 15, cost_sgd: null, is_estimated: false },
      { id: 'l2', from_place_id: 'p2', to_place_id: 'p3', transport_mode: 'CYCLE', duration_minutes: 20, cost_sgd: null, is_estimated: false },
    ]
    render(<TripMap places={makePlaces()} legs={legs} />)
    const polylines = screen.getAllByTestId('polyline')
    expect(polylines[0]).toHaveAttribute('data-color', '#3b82f6')
    expect(polylines[1]).toHaveAttribute('data-color', '#3b82f6')
  })

  // --- Tooltips ---

  it('tooltip shows mode, duration, and cost', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    const tooltips = screen.getAllByTestId('tooltip')
    expect(tooltips[0]).toHaveTextContent('MRT · 10 phút · SGD 1.80')
  })

  it('tooltip appends "(ước tính)" when is_estimated is true', () => {
    const legs = [{ id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'MRT', duration_minutes: 12, cost_sgd: 1.50, is_estimated: true }]
    render(<TripMap places={makePlaces()} legs={legs} />)
    expect(screen.getByTestId('tooltip')).toHaveTextContent('(ước tính)')
  })

  it('tooltip omits cost when cost_sgd is null', () => {
    const legs = [{ id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'WALK', duration_minutes: 8, cost_sgd: null, is_estimated: false }]
    render(<TripMap places={makePlaces()} legs={legs} />)
    expect(screen.getByTestId('tooltip')).not.toHaveTextContent('SGD')
    expect(screen.getByTestId('tooltip')).toHaveTextContent('WALK · 8 phút')
  })

  // --- Edge cases ---

  it('skips leg when from_place_id is not in places (no crash)', () => {
    const legs = [{ id: 'l1', from_place_id: 'GHOST', to_place_id: 'p2', transport_mode: 'MRT', duration_minutes: 5, cost_sgd: null, is_estimated: false }]
    expect(() => render(<TripMap places={makePlaces()} legs={legs} />)).not.toThrow()
    expect(screen.queryAllByTestId('polyline')).toHaveLength(0)
  })

  it('unknown transport_mode falls back to blue (#3b82f6)', () => {
    const legs = [{ id: 'l1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'FERRY', duration_minutes: 30, cost_sgd: null, is_estimated: false }]
    render(<TripMap places={makePlaces()} legs={legs} />)
    expect(screen.getByTestId('polyline')).toHaveAttribute('data-color', '#3b82f6')
  })

  // --- FitBounds ---

  it('calls fitBounds when there are multiple places', () => {
    render(<TripMap places={makePlaces()} legs={makeLegs()} />)
    expect(mockFitBounds).toHaveBeenCalledTimes(1)
    expect(mockFitBounds).toHaveBeenCalledWith(expect.any(Array), { padding: [40, 40] })
  })

  it('calls setView (not fitBounds) when there is only one place', () => {
    const single = [makePlaces()[0]]
    render(<TripMap places={single} legs={[]} />)
    expect(mockSetView).toHaveBeenCalledTimes(1)
    expect(mockFitBounds).not.toHaveBeenCalled()
  })
})
