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
  default: ({ legs }) => <div data-testid="trip-map" data-leg-count={legs?.length ?? 0} />,
}))
vi.mock('../../components/planner/TravelTips', () => ({
  default: ({ places }) => (
    <div data-testid="travel-tips" data-place-count={places.length} />
  ),
}))

import { useTrip } from '../../hooks/useTrip'

const makeTrip = (overrides = {}) => ({
  id: 'trip-123',
  days: [{ day: 1, legs: [] }],
  places: [],
  warnings: [],
  ...overrides,
})

const makeLeg = (id = 'l1') => ({
  id,
  from_place_id: 'A',
  to_place_id: 'B',
  transport_mode: 'MRT',
  duration_minutes: 10,
  cost_sgd: 1.5,
  is_estimated: false,
})

describe('Trip page', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── Loading / error states ───────────────────────────────────────
  it('shows loading skeleton', () => {
    useTrip.mockReturnValue({ trip: null, loading: true, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByLabelText('Đang tải hành trình')).toBeInTheDocument()
  })

  it('shows error message', () => {
    useTrip.mockReturnValue({ trip: null, loading: false, error: new Error('Not found') })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByText(/Not found/)).toBeInTheDocument()
  })

  // ── Content rendering ────────────────────────────────────────────
  it('renders trip days when loaded', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByTestId('day-1')).toBeInTheDocument()
  })

  it('passes tripId to DayPlan', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByTestId('day-1')).toHaveAttribute('data-trip-id', 'trip-123')
  })

  it('renders TravelTips with trip places', () => {
    const places = [
      { id: 'gardens', name: 'Gardens by the Bay', category: 'nature', is_outdoor: true, best_time_start: '08:00' },
    ]
    useTrip.mockReturnValue({ trip: makeTrip({ places }), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    const tips = screen.getByTestId('travel-tips')
    expect(tips).toBeInTheDocument()
    expect(tips).toHaveAttribute('data-place-count', '1')
  })

  // ── Warnings ─────────────────────────────────────────────────────
  it('does not show warnings banner when warnings is empty', () => {
    useTrip.mockReturnValue({ trip: makeTrip({ warnings: [] }), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows warnings banner when trip has warnings', () => {
    useTrip.mockReturnValue({
      trip: makeTrip({ warnings: ['Sentosa best time conflict'] }),
      loading: false,
      error: null,
    })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Sentosa best time conflict')
  })

  it('dismisses warnings banner when × is clicked', () => {
    useTrip.mockReturnValue({
      trip: makeTrip({ warnings: ['Some warning'] }),
      loading: false,
      error: null,
    })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /dismiss warnings/i }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows multiple warnings joined by separator', () => {
    useTrip.mockReturnValue({
      trip: makeTrip({ warnings: ['Warning A', 'Warning B'] }),
      loading: false,
      error: null,
    })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByRole('alert')).toHaveTextContent('Warning A · Warning B')
  })

  // ── Map always in DOM ─────────────────────────────────────────────
  it('map is always in the DOM when trip is loaded (no tab required)', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByTestId('trip-map')).toBeInTheDocument()
  })

  it('map receives all legs when all days are shown', () => {
    const leg = makeLeg()
    const trip = makeTrip({ days: [{ day: 1, legs: [leg] }] })
    useTrip.mockReturnValue({ trip, loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-leg-count', '1')
  })

  // ── Day filter tabs ───────────────────────────────────────────────
  it('does not show day tabs for single-day trip', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('shows day tabs for multi-day trip', () => {
    const trip = makeTrip({
      days: [{ day: 1, legs: [] }, { day: 2, legs: [] }],
    })
    useTrip.mockReturnValue({ trip, loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Tất cả' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ngày 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Ngày 2' })).toBeInTheDocument()
  })

  it('"Tất cả" tab is selected by default', () => {
    const trip = makeTrip({
      days: [{ day: 1, legs: [] }, { day: 2, legs: [] }],
    })
    useTrip.mockReturnValue({ trip, loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByRole('tab', { name: 'Tất cả' })).toHaveAttribute('aria-selected', 'true')
  })

  it('clicking a day tab shows only that day', () => {
    const trip = makeTrip({
      days: [{ day: 1, legs: [] }, { day: 2, legs: [] }],
    })
    useTrip.mockReturnValue({ trip, loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)

    fireEvent.click(screen.getByRole('tab', { name: 'Ngày 2' }))

    expect(screen.queryByTestId('day-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('day-2')).toBeInTheDocument()
  })

  it('clicking a day tab filters map legs to that day', () => {
    const leg1 = makeLeg('leg-1')
    const leg2 = makeLeg('leg-2')
    const trip = makeTrip({
      days: [
        { day: 1, legs: [leg1] },
        { day: 2, legs: [leg2] },
      ],
    })
    useTrip.mockReturnValue({ trip, loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)

    // All days selected → 2 legs
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-leg-count', '2')

    fireEvent.click(screen.getByRole('tab', { name: 'Ngày 1' }))
    expect(screen.getByTestId('trip-map')).toHaveAttribute('data-leg-count', '1')
  })

  // ── Header ────────────────────────────────────────────────────────
  it('shows day and place count in header when trip is loaded', () => {
    const places = [
      { id: 'p1', name: 'Place 1', category: 'landmark', is_outdoor: false, best_time_start: '09:00' },
    ]
    useTrip.mockReturnValue({ trip: makeTrip({ places }), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByText(/1 ngày · 1 địa điểm/)).toBeInTheDocument()
  })

  // ── Mobile map toggle ─────────────────────────────────────────────
  it('shows mobile map toggle button in header', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByRole('button', { name: /xem bản đồ/i })).toBeInTheDocument()
  })
})
