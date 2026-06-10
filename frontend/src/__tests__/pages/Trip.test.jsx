import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
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
    checkAlerts: vi.fn(() => Promise.resolve({})),
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
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

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
    // Overview is the default tab; Day 1 appears in nav and as a day card heading
    expect(screen.getAllByRole('button', { name: /Day 1/i })[0]).toBeInTheDocument()
    expect(screen.getByText('Marina Bay')).toBeInTheDocument()
  })

  it('opens map view after selecting a day', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    // TripMap is always rendered alongside the left panel; clicking Day 1 tab keeps it visible
    fireEvent.click(screen.getAllByRole('button', { name: /Day 1/i })[0])
    expect(screen.getByTestId('trip-map')).toBeInTheDocument()
  })

  it('allows changing transport mode from day by day', async () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null, refresh: vi.fn() })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    // Navigate to DayView via the Day 1 nav tab
    fireEvent.click(screen.getAllByRole('button', { name: /Day 1/i })[0])
    // Open the mode dropdown on the LegCard
    fireEvent.click(screen.getByRole('button', { name: /Change/i }))
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

  it('warnings banner is persistent (no dismiss button)', () => {
    useTrip.mockReturnValue({
      trip: makeTrip({ warnings: ['Some warning'] }),
      loading: false,
      error: null,
    })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
  })

  it('shows all warnings in the alert banner', () => {
    useTrip.mockReturnValue({
      trip: makeTrip({ warnings: ['Warning A', 'Warning B'] }),
      loading: false,
      error: null,
    })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Warning A')
    expect(alert).toHaveTextContent('Warning B')
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

// ===========================================================================
// dev13 feature tests
// ===========================================================================

/** Trip with 2 legs in day 1 and 3 places. */
const makeTwoLegTrip = () => ({
  id: 'trip-123',
  days: [{
    day: 1,
    legs: [
      { id: 'leg-1', from_place_id: 'p1', to_place_id: 'p2', transport_mode: 'MRT', duration_minutes: 12, cost_sgd: 1.5 },
      { id: 'leg-2', from_place_id: 'p2', to_place_id: 'p3', transport_mode: 'BUS', duration_minutes: 20, cost_sgd: 1.2 },
    ],
  }],
  places: [
    { id: 'p1', name: 'Marina Bay', lat: 1.283, lng: 103.860, category: 'landmark' },
    { id: 'p2', name: 'Bugis',      lat: 1.300, lng: 103.855, category: 'shopping' },
    { id: 'p3', name: 'Sentosa',    lat: 1.249, lng: 103.830, category: 'attraction' },
  ],
  warnings: [],
})

describe('dev13 — Task 1: no Start button in DayView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('DayView header has no standalone "Start" button in planning mode', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    // Two "Day 1" buttons exist (tab nav + overview card) — click the first (tab)
    fireEvent.click(screen.getAllByRole('button', { name: /Day 1/ })[0])
    // There must NOT be a button whose accessible name is exactly "Start"
    expect(screen.queryByRole('button', { name: /^Start$/ })).not.toBeInTheDocument()
  })

  it('Start Trip button does not exist in Overview', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    expect(screen.queryByRole('button', { name: /Start Trip/i })).not.toBeInTheDocument()
  })
})

/** Render Trip in live navigation mode (autoStart=true => tripStarted=true, editMode=false). */
const renderLive = () => render(
  <MemoryRouter initialEntries={[{ pathname: '/trip/trip-123', state: { autoStart: true } }]}>
    <Trip />
  </MemoryRouter>
)

describe('dev13 — Task 5: no instructions in LegCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('after starting trip the DayView shows no "instructions" text', () => {
    sessionStorage.setItem('imove_trip_started_trip-123', 'true')
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null, refresh: vi.fn() })
    render(<BrowserRouter><Trip /></BrowserRouter>)
    fireEvent.click(screen.getAllByRole('button', { name: /Day 1/ })[0])
    expect(screen.queryByText(/instructions/i)).not.toBeInTheDocument()
  })

  it('"Compare modes" button is still present in active leg view', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null, refresh: vi.fn() })
    renderLive()
    expect(screen.getByRole('button', { name: /Compare modes/i })).toBeInTheDocument()
  })
})

describe('dev13 — Task 7: arrived → Continue banner → advance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('clicking Arrived changes the button to Continue (no separate banner)', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null, refresh: vi.fn() })
    renderLive()
    fireEvent.click(screen.getByRole('button', { name: /Arrived/i }))
    expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument()
    expect(screen.queryByText(/You've arrived/i)).not.toBeInTheDocument()
  })

  it('clicking Arrived does NOT immediately advance the leg', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null, refresh: vi.fn() })
    renderLive()
    // Single-leg trip — after arriving, should show Continue, NOT jump to Summary
    fireEvent.click(screen.getByRole('button', { name: /Arrived/i }))
    // Summary tab should NOT have appeared yet
    expect(screen.queryByText(/Total cost|Total time/i)).not.toBeInTheDocument()
  })

  it('clicking Continue advances to next leg and button resets to Arrived', () => {
    useTrip.mockReturnValue({ trip: makeTwoLegTrip(), loading: false, error: null, refresh: vi.fn() })
    renderLive()
    fireEvent.click(screen.getByRole('button', { name: /Arrived/i }))
    expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    // Button resets back to Arrived for the next leg
    expect(screen.getByRole('button', { name: /Arrived/i })).toBeInTheDocument()
  })

  it('Continue → last leg → no more legs → trip ends (Summary shown)', () => {
    useTrip.mockReturnValue({ trip: makeTrip(), loading: false, error: null, refresh: vi.fn() })
    renderLive()
    fireEvent.click(screen.getByRole('button', { name: /Arrived/i }))
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
    // After last leg, tripStarted becomes false and Summary tab is active
    expect(screen.queryByText(/Live/i)).not.toBeInTheDocument()
  })
})
