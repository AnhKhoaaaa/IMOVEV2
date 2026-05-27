import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import TripMap from '../../components/map/TripMap'

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn((options) => ({ options })),
  },
}))

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  return {
    MapContainer: ({ center, zoom, children }) => (
      <div data-testid="map" data-center={JSON.stringify(center)} data-zoom={zoom}>
        {children}
      </div>
    ),
    TileLayer: () => <div data-testid="tile-layer" />,
    Marker: ({ position, children }) => (
      <div data-testid="marker" data-position={JSON.stringify(position)}>
        {children}
      </div>
    ),
    Popup: ({ children }) => <div data-testid="popup">{children}</div>,
    Polyline: ({ positions, color, dashArray, children }) => (
      <div
        data-testid="polyline"
        data-positions={JSON.stringify(positions)}
        data-color={color}
        data-dasharray={dashArray ?? ''}
      >
        {children}
      </div>
    ),
    Tooltip: ({ children }) => <div data-testid="tooltip">{children}</div>,
    useMap: () => ({
      fitBounds: vi.fn(),
      setView: vi.fn(),
    }),
  }
})

const places = [
  {
    id: 'gardens',
    name: 'Gardens by the Bay',
    lat: 1.2816,
    lng: 103.8636,
    dwell_minutes: 120,
    best_time_start: '09:00',
    best_time_end: '11:00',
  },
  {
    id: 'marina',
    name: 'Marina Bay Sands',
    lat: 1.2834,
    lng: 103.8607,
    dwell_minutes: 90,
    best_time_start: '12:00',
    best_time_end: '14:00',
  },
]

const leg = {
  id: 'leg-1',
  from_place_id: 'gardens',
  to_place_id: 'marina',
  transport_mode: 'WALK',
  duration_minutes: 10,
  cost_sgd: 0,
  is_estimated: true,
}

describe('TripMap', () => {
  it('shows a non-crashing placeholder when no mappable places exist', () => {
    render(<TripMap places={[]} legs={[]} />)

    expect(screen.getByRole('status', { name: /map unavailable/i })).toHaveTextContent('No mappable places yet')
  })

  it('renders one place without requiring route legs', () => {
    render(<TripMap places={[places[0]]} legs={[]} />)

    expect(screen.getByTestId('map')).toHaveAttribute('data-center', JSON.stringify([1.2816, 103.8636]))
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
    expect(screen.queryByTestId('polyline')).not.toBeInTheDocument()
  })

  it('renders multiple places without route legs', () => {
    render(<TripMap places={places} legs={[]} />)

    expect(screen.getAllByTestId('marker')).toHaveLength(2)
    expect(screen.queryByTestId('polyline')).not.toBeInTheDocument()
  })

  it('renders route tooltip with mode, cost, and estimated status', () => {
    render(<TripMap places={places} legs={[leg]} />)

    const line = screen.getByTestId('polyline')
    expect(line).toHaveAttribute('data-color', '#f97316')
    expect(line).toHaveAttribute('data-dasharray', '5,5')
    expect(within(line).getByTestId('tooltip')).toHaveTextContent('Walk - 10 min - S$0.00 - Estimated')
  })

  it('falls unknown route modes back to bus styling and label', () => {
    render(<TripMap places={places} legs={[{ ...leg, transport_mode: 'DRIVE', is_estimated: false }]} />)

    const line = screen.getByTestId('polyline')
    expect(line).toHaveAttribute('data-color', '#10b981')
    expect(within(line).getByTestId('tooltip')).toHaveTextContent('Bus - 10 min - S$0.00')
  })

  it('skips legs whose endpoints are not mappable', () => {
    render(<TripMap places={places} legs={[{ ...leg, to_place_id: 'missing-place' }]} />)

    expect(screen.queryByTestId('polyline')).not.toBeInTheDocument()
  })

  it('filters places and user marker with invalid coordinates', () => {
    render(
      <TripMap
        places={[places[0], { ...places[1], lat: null }]}
        legs={[leg]}
        userPosition={{ lat: 'not-a-number', lng: 103.8 }}
      />
    )

    expect(screen.getAllByTestId('marker')).toHaveLength(1)
    expect(screen.queryByTestId('polyline')).not.toBeInTheDocument()
  })
})
