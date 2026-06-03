import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
vi.mock('../../services/api', () => ({
  api: {
    updateLeg: vi.fn(() => Promise.resolve({})),
    addDay: vi.fn(() => Promise.resolve({ days: [] })),
    removeDay: vi.fn(() => Promise.resolve({ days: [] })),
    optimizeRoute: vi.fn(() => Promise.resolve({ days: [] })),
    updateLocation: vi.fn(() => Promise.resolve({})),
  },
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
import { api } from '../../services/api'

const makeTrip = (overrides = {}) => ({
  id: 'trip-123',
  days: [{
    day: 1,
    legs: [{
      id: 'leg-1',
      from_place_id: 'p1',
      to_place_id: 'p2',
      transport_mode: 'MRT',
      duration_minutes: 12,
      cost_sgd: 1.5,
    }],
  }],
  places: [
    { id: 'p1', name: 'Marina Bay', lat: 1.283, lng: 103.86, category: 'landmark' },
    { id: 'p2', name: 'Bugis', lat: 1.300, lng: 103.855, category: 'shopping' },
  ],
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

  it('renders day by day board when loaded', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Day by day/i }))
    expect(screen.getByRole('button', { name: /Day 1/i })).toBeInTheDocument()
    expect(screen.getByText('Marina Bay')).toBeInTheDocument()
  })

  it('opens map view after selecting a day', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Day by day/i }))
    fireEvent.click(screen.getByRole('button', { name: /Day 1/i }))
    expect(screen.getByTestId('trip-map')).toBeInTheDocument()
  })

  it('allows changing transport mode from day by day', async () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null, refresh: vi.fn() })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Day by day/i }))
    fireEvent.click(screen.getByRole('button', { name: /change transport from marina bay to bugis/i }))
    fireEvent.click(screen.getByRole('button', { name: /Bus/i }))

    await waitFor(() => {
      expect(api.updateLeg).toHaveBeenCalledWith('trip-123', 'leg-1', { transport_mode: 'BUS' })
    })
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
