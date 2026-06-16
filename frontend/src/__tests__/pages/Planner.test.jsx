import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { LanguageProvider } from '../../contexts/LanguageContext'
import Planner from '../../pages/Planner'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../services/api', () => ({
  api: {
    createTrip: vi.fn(),
    planTrip: vi.fn(),
    saveTrip: vi.fn(),
    getCuratedPlaces: vi.fn().mockResolvedValue([
      { id: 'p1', name: 'Gardens by the Bay', category: 'Nature', dwell_minutes: 120 },
      { id: 'p2', name: 'Sentosa Beach Club', category: 'Entertainment', dwell_minutes: 180 }
    ]),
    geocodeHotel: vi.fn(),
    suggestPlaces: vi.fn(),
  },
}))

// Mock PlaceBrowser
vi.mock('../../components/planner/PlaceBrowser', () => ({
  default: ({ selectedIds, onToggle }) => (
    <div>
      <button onClick={() => onToggle({ id: 'p1', name: 'Gardens by the Bay', category: 'Nature', dwell_minutes: 120 })}>
        Select Gardens
      </button>
      <button onClick={() => onToggle({ id: 'p2', name: 'Sentosa Beach Club', category: 'Entertainment', dwell_minutes: 180 })}>
        Select Sentosa
      </button>
      <span data-testid="selected-count">{selectedIds?.length ?? 0}</span>
    </div>
  )
}))

import { api } from '../../services/api'

const wrap = () => render(
  <BrowserRouter>
    <LanguageProvider>
      <Planner />
    </LanguageProvider>
  </BrowserRouter>
)

describe('Planner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders Step 1 (Essentials) initially', () => {
    wrap()
    expect(screen.getByText('General settings')).toBeInTheDocument()
    expect(screen.getAllByText('Trip Name')[0]).toBeInTheDocument()
    expect(screen.getByText('Transit Budget (SGD)')).toBeInTheDocument()
    expect(screen.getByText('Days')).toBeInTheDocument()
  })

  it('can navigate to Step 2 (Hotel Location) and search for hotels', async () => {
    wrap()
    
    // Click Next to go to Step 2
    fireEvent.click(screen.getByText('Next'))
    
    expect(await screen.findByText('Hotel Accommodation')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/e.g. Marina Bay Sands/i)).toBeInTheDocument()

    // Test searching
    api.geocodeHotel.mockResolvedValue({ address: '10 Bayfront Ave', lat: 1.28, lng: 103.86 })
    const searchInput = screen.getByPlaceholderText(/e.g. Marina Bay Sands/i)
    fireEvent.change(searchInput, { target: { value: 'Marina Bay' } })

    await waitFor(() => expect(api.geocodeHotel).toHaveBeenCalledWith('Marina Bay'))
    await waitFor(() => expect(screen.getByText('10 Bayfront Ave')).toBeInTheDocument())
    
    // Select the hotel
    fireEvent.click(screen.getByText('Use'))
    expect(screen.getAllByText('Marina Bay')[0]).toBeInTheDocument()
  })

  it('can navigate to Step 3 (Travel Style) and select presets', async () => {
    wrap()
    
    // Go to Step 3
    fireEvent.click(screen.getByText('Next')) // Step 2
    await screen.findByText('Hotel Accommodation')
    fireEvent.click(screen.getByText('Next')) // Step 3
    await screen.findByText('Transit weights')
    
    expect(screen.getByText('Transit weights')).toBeInTheDocument()
    // "Fastest" appears twice: the preset button + the Trip Config Summary value
    // (default preset = fastest), so scope to the first match.
    expect(screen.getAllByText('Fastest')[0]).toBeInTheDocument()
    expect(screen.getByText('Cheapest')).toBeInTheDocument()
    expect(screen.getByText('Least Walking')).toBeInTheDocument()
    expect(screen.getByText('Least Transfers')).toBeInTheDocument()

    // Click Cheapest preset
    fireEvent.click(screen.getByText('Cheapest'))
    expect(screen.getByText('Fare Cost')).toBeInTheDocument()
  })

  it('can navigate to Step 4 (Places) and select places', async () => {
    wrap()
    
    // Go to Step 4
    fireEvent.click(screen.getByText('Next')) // Step 2
    await screen.findByText('Hotel Accommodation')
    fireEvent.click(screen.getByText('Next')) // Step 3
    await screen.findByText('Transit weights')
    fireEvent.click(screen.getByText('Next')) // Step 4
    await screen.findByText('Singapore attractions')
    
    expect(screen.getByText('Singapore attractions')).toBeInTheDocument()
    
    // Toggle places
    fireEvent.click(screen.getByText('Select Gardens'))
    expect(screen.getByTestId('selected-count').textContent).toBe('1')
    
    fireEvent.click(screen.getByText('Select Sentosa'))
    expect(screen.getByTestId('selected-count').textContent).toBe('2')
  })

  it('submits correctly on Step 4 and calls API', async () => {
    api.createTrip.mockResolvedValue({ trip_id: 'trip-123' })
    api.planTrip.mockResolvedValue({})
    
    wrap()
    
    // Go to Step 4
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('Hotel Accommodation')
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('Transit weights')
    fireEvent.click(screen.getByText('Next'))
    await screen.findByText('Singapore attractions')
    
    // Select 2 places
    fireEvent.click(screen.getByText('Select Gardens'))
    fireEvent.click(screen.getByText('Select Sentosa'))
    
    // Click Generate Plan
    fireEvent.click(screen.getAllByText(/^Generate$/i)[0])
    
    await waitFor(() => expect(api.createTrip).toHaveBeenCalledTimes(1), { timeout: 2500 })
    await waitFor(() => expect(api.planTrip).toHaveBeenCalledWith('trip-123', expect.objectContaining({
      place_ids: ['p1', 'p2'],
      optimize_order: true,
      preferences: expect.objectContaining({
        budget_sgd: 50,
        duration_w: 0.7
      })
    })))
    
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(
      '/trip/trip-123',
      expect.any(Object)
    ))
  })
})
