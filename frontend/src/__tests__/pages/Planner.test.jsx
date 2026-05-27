import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Planner from '../../pages/Planner'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('../../services/api', () => ({
  api: {
    getCuratedPlaces: vi.fn(),
    createTrip: vi.fn(),
    planTrip: vi.fn(),
    getSavedTrips: vi.fn(),
    saveTrip: vi.fn(),
    deleteSavedTrip: vi.fn(),
  },
}))

import { api } from '../../services/api'

const curatedPlaces = [
  { id: 'gardens-by-the-bay', name: 'Gardens by the Bay', lat: 1.2816, lng: 103.8636, category: 'nature', is_outdoor: true },
  { id: 'marina-bay-sands', name: 'Marina Bay Sands', lat: 1.3016, lng: 103.8636, category: 'landmark', is_outdoor: false },
  { id: 'national-gallery', name: 'National Gallery Singapore', lat: 1.3216, lng: 103.8636, category: 'museum', is_outdoor: false },
  { id: 'sentosa', name: 'Sentosa', lat: 1.3416, lng: 103.8636, category: 'entertainment', is_outdoor: true },
]

const renderPlanner = () => render(<BrowserRouter><Planner /></BrowserRouter>)

describe('Planner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    mockNavigate.mockReset()
    api.getSavedTrips.mockReturnValue([])
    api.getCuratedPlaces.mockResolvedValue(curatedPlaces)
    api.createTrip.mockResolvedValue({ trip_id: 'trip-abc' })
    api.planTrip.mockResolvedValue({})
  })

  it('renders the current one-screen Singapore planner', () => {
    renderPlanner()
    expect(screen.getByText('Singapore')).toBeInTheDocument()
    expect(screen.getByText(/Specific dates/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create Itinerary/i })).toBeInTheDocument()
  })

  it('creates and plans a trip with default settings', async () => {
    renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: /Create Itinerary/i }))

    await waitFor(() => expect(api.getCuratedPlaces).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.createTrip).toHaveBeenCalledWith(expect.objectContaining({
      num_days: 3,
      budget_sgd: 60,
    })))
    await waitFor(() => expect(api.planTrip).toHaveBeenCalledWith('trip-abc', {
      place_ids: curatedPlaces.map((p) => p.id),
      optimize_order: true,
      preferences: {
        prefer_mrt: true,
        max_walk_minutes: 15,
        travel_styles: [],
        group_type: 'solo',
      },
    }))
    expect(api.saveTrip).toHaveBeenCalledWith('trip-abc', expect.objectContaining({
      name: 'Singapore Trip',
      numDays: 3,
    }))
    expect(mockNavigate).toHaveBeenCalledWith('/trip/trip-abc')
  })

  it('includes selected duration, group, style, and pace in the API payload', async () => {
    renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: /Family/i }))
    fireEvent.click(screen.getByRole('button', { name: /Nature/i }))
    fireEvent.click(screen.getByRole('button', { name: /Relaxed/i }))
    fireEvent.click(screen.getByRole('button', { name: '+' }))

    fireEvent.click(screen.getByRole('button', { name: /Create Itinerary/i }))

    await waitFor(() => expect(api.createTrip).toHaveBeenCalledWith(expect.objectContaining({
      num_days: 4,
      budget_sgd: 100,
    })))
    await waitFor(() => expect(api.planTrip).toHaveBeenCalledWith('trip-abc', expect.objectContaining({
      preferences: expect.objectContaining({
        max_walk_minutes: 30,
        travel_styles: ['nature'],
        group_type: 'family',
      }),
    })))
  })

  it('shows loading state while itinerary creation is pending', async () => {
    api.createTrip.mockReturnValue(new Promise(() => {}))
    renderPlanner()

    fireEvent.click(screen.getByRole('button', { name: /Create Itinerary/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Planning your trip/i })).toBeDisabled()
    )
  })

  it('shows backend error and re-enables submit after failure', async () => {
    api.planTrip.mockRejectedValue(new Error('Budget exceeded'))
    renderPlanner()

    fireEvent.click(screen.getByRole('button', { name: /Create Itinerary/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Budget exceeded'))
    expect(screen.getByRole('button', { name: /Create Itinerary/i })).not.toBeDisabled()
  })
})
