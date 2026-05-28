import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Trip from '../../pages/Trip'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ id: 'trip-123' }) }
})

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: null })),
}))

vi.mock('../../hooks/useTrip')
vi.mock('../../hooks/useSavedTrips', () => ({
  useSavedTrips: vi.fn(() => ({ trips: [], save: vi.fn(), remove: vi.fn(), reload: vi.fn() })),
}))
vi.mock('../../hooks/useAlerts', () => ({
  useAlerts: () => ({ alerts: [], dismiss: vi.fn() }),
}))
vi.mock('../../hooks/useGeolocation', () => ({
  useGeolocation: () => ({ position: null, error: null }),
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
import { useSavedTrips } from '../../hooks/useSavedTrips'
import { useAuth } from '../../contexts/AuthContext'

const makeTrip = (overrides = {}) => ({
  id: 'trip-123',
  days: [{ day: 1, legs: [] }],
  places: [],
  warnings: [],
  ...overrides,
})

describe('Trip page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows loading skeleton', () => {
    useTrip.mockReturnValue({ trip: null, loading: true, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByLabelText('Loading trip')).toBeInTheDocument()
  })

  it('shows error message', () => {
    useTrip.mockReturnValue({ trip: null, loading: false, error: new Error('Not found') })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByText(/Not found/)).toBeInTheDocument()
  })

  it('renders trip days when loaded', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Day 1' }))
    expect(screen.getByTestId('day-1')).toBeInTheDocument()
  })

  it('passes tripId to DayPlan', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Day 1' }))
    expect(screen.getByTestId('day-1')).toHaveAttribute('data-trip-id', 'trip-123')
  })

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

  it('P6-BUG-1: handleSaveSetup uses hook saveTrip, not api.saveTrip directly', async () => {
    const mockSave = vi.fn()
    useSavedTrips.mockReturnValue({
      trips: [{ id: 'trip-123', name: 'My Trip' }],
      save: mockSave,
      remove: vi.fn(),
      reload: vi.fn(),
    })
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    // Open the TripSetupModal via the Settings button
    fireEvent.click(screen.getByTitle('Edit setup'))
    // Click Save changes in the modal
    fireEvent.click(screen.getByText('Save changes'))
    expect(mockSave).toHaveBeenCalledWith('trip-123', expect.any(Object))
  })

  it('P6-BUG-2: passes authUserId from useAuth to useTrip', () => {
    useAuth.mockReturnValue({ user: { id: 'user-abc' } })
    useTrip.mockReturnValue({ trip: null, loading: true, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(useTrip).toHaveBeenCalledWith('trip-123', 'user-abc')
  })

  it('P6-BUG-6: savedMeta name shown in header comes from savedTrips (no double getSavedTrips)', () => {
    useSavedTrips.mockReturnValue({
      trips: [{ id: 'trip-123', name: 'My Singapore Adventure' }],
      save: vi.fn(),
      remove: vi.fn(),
      reload: vi.fn(),
    })
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByText('My Singapore Adventure')).toBeInTheDocument()
  })
})
