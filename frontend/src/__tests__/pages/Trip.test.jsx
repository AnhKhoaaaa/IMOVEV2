import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Trip from '../../pages/Trip'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'trip-123' }) }
})

vi.mock('../../hooks/useTrip')
vi.mock('../../hooks/useAlerts', () => ({
  useAlerts: () => ({ alerts: [], dismiss: vi.fn() }),
}))
vi.mock('../../components/planner/DayPlan', () => ({
  default: ({ day, legs, tripId }) => (
    <div data-testid={`day-${day}`} data-trip-id={tripId}>{legs.length} legs</div>
  ),
}))
vi.mock('../../components/adaptation/AlertBanner', () => ({
  default: ({ alert }) => <div data-testid="alert-banner">{alert.message}</div>,
}))
vi.mock('../../components/map/TripMap', () => ({
  default: () => <div data-testid="trip-map" />,
}))

import { useTrip } from '../../hooks/useTrip'

const makeTrip = (overrides = {}) => ({
  id: 'trip-123',
  days: [{ day: 1, legs: [] }],
  places: [],
  warnings: [],
  ...overrides,
})

const renderTrip = () => render(<BrowserRouter><Trip /></BrowserRouter>)

describe('Trip page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('shows loading skeleton', () => {
    const { container } = renderTripWith({ trip: null, loading: true, error: null })
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
  })

  it('shows error message', () => {
    renderTripWith({ trip: null, loading: false, error: new Error('Not found') })
    expect(screen.getByText(/Could not load trip: Not found/i)).toBeInTheDocument()
  })

  it('renders overview and day tabs when loaded', () => {
    renderTripWith({ trip: makeTrip(), loading: false, error: null })
    expect(screen.getByRole('button', { name: /Overview/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Day 1/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Summary/i })).toBeInTheDocument()
  })

  it('renders selected day content and passes tripId to DayPlan', () => {
    renderTripWith({ trip: makeTrip(), loading: false, error: null })
    fireEvent.click(screen.getAllByRole('button', { name: /Day 1/i })[0])
    expect(screen.getByTestId('day-1')).toHaveAttribute('data-trip-id', 'trip-123')
  })

  it('does not show warnings banner when warnings is empty', () => {
    renderTripWith({ trip: makeTrip({ warnings: [] }), loading: false, error: null })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows warnings banner when trip has warnings', () => {
    renderTripWith({
      trip: makeTrip({ warnings: ['Sentosa best time conflict'] }),
      loading: false,
      error: null,
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Sentosa best time conflict')
  })

  it('dismisses warnings banner when Dismiss is clicked', () => {
    renderTripWith({
      trip: makeTrip({ warnings: ['Some warning'] }),
      loading: false,
      error: null,
    })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows multiple warnings in the banner', () => {
    renderTripWith({
      trip: makeTrip({ warnings: ['Warning A', 'Warning B'] }),
      loading: false,
      error: null,
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Warning A')
    expect(screen.getByRole('alert')).toHaveTextContent('Warning B')
  })
})

function renderTripWith(state) {
  useTrip.mockReturnValue({ refresh: vi.fn(), ...state })
  return renderTrip()
}
