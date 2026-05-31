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

vi.mock('../../hooks/useSavedTrips', () => ({
  useSavedTrips: () => ({ save: vi.fn() }),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('../../services/api', () => ({
  api: {
    createTrip: vi.fn(),
    planTrip: vi.fn(),
    getCuratedPlaces: vi.fn().mockResolvedValue([]),
    saveTrip: vi.fn(),   // auto-save draft — called after planTrip succeeds
  },
}))

// Two-place mock so transport chip tests work
vi.mock('../../components/planner/PlaceSearch', () => ({
  default: ({ onAdd, addedIds }) => (
    <div>
      <button onClick={() => onAdd({ id: 'p1', name: 'Gardens by the Bay', lat: 1.28, lng: 103.86, category: 'nature', in_curated_dataset: true })}>
        Add Gardens
      </button>
      <button onClick={() => onAdd({ id: 'p2', name: 'Sentosa', lat: 1.25, lng: 103.82, category: 'beach', in_curated_dataset: true })}>
        Add Sentosa
      </button>
      <span data-testid="added-size">{addedIds?.size ?? 0}</span>
    </div>
  ),
}))

import { api } from '../../services/api'

const wrap = () => render(
  <BrowserRouter><LanguageProvider><Planner /></LanguageProvider></BrowserRouter>
)

describe('Planner', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })

  /* ── Mode chooser ───────────────────────────────────── */
  it('shows mode chooser on initial render', () => {
    wrap()
    expect(screen.getByText('Build it yourself')).toBeInTheDocument()
    expect(screen.getByText('Plan with AI')).toBeInTheDocument()
    expect(screen.getByText('Recommended')).toBeInTheDocument()
  })

  it('mode chooser in Vietnamese when lang=vi', () => {
    localStorage.setItem('imove_lang', 'vi')
    wrap()
    expect(screen.getByText('Tự tạo hành trình')).toBeInTheDocument()
  })

  /* ── Manual mode ────────────────────────────────────── */
  const enterManual = () => {
    wrap()
    fireEvent.click(screen.getByText('Build it yourself'))
  }

  it('enters manual mode on primary card click', () => {
    enterManual()
    expect(screen.getByText('Add place')).toBeInTheDocument()
  })

  it('back button returns to mode chooser', () => {
    enterManual()
    fireEvent.click(screen.getByText('Change method'))
    expect(screen.getByText('Build it yourself')).toBeInTheDocument()
  })

  it('shows empty state when no places added', () => {
    enterManual()
    expect(screen.getByText('No places added yet')).toBeInTheDocument()
  })

  it('opens search panel on Add place click', () => {
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    expect(screen.getByText('Add Gardens')).toBeInTheDocument()
  })

  it('search panel stays open after adding a place (bug fix)', () => {
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    fireEvent.click(screen.getByText('Add Gardens'))
    // Panel must still be open
    expect(screen.getByText('Add Gardens')).toBeInTheDocument()
  })

  it('passes correct addedIds to PlaceSearch after adding', () => {
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    expect(screen.getByTestId('added-size').textContent).toBe('0')
    fireEvent.click(screen.getByText('Add Gardens'))
    expect(screen.getByTestId('added-size').textContent).toBe('1')
    fireEvent.click(screen.getByText('Add Sentosa'))
    expect(screen.getByTestId('added-size').textContent).toBe('2')
  })

  it('does not add duplicate places', () => {
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    fireEvent.click(screen.getByText('Add Gardens'))
    fireEvent.click(screen.getByText('Add Gardens'))
    expect(screen.getByTestId('added-size').textContent).toBe('1')
  })

  it('shows place in list after adding', () => {
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    fireEvent.click(screen.getByText('Add Gardens'))
    expect(screen.getByText('Gardens by the Bay')).toBeInTheDocument()
  })

  it('shows transport chip between two places', () => {
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    fireEvent.click(screen.getByText('Add Gardens'))
    fireEvent.click(screen.getByText('Add Sentosa'))
    // Distance ~5.5km → MRT
    expect(screen.getByText(/mrt/i)).toBeInTheDocument()
  })

  it('transport chip label changes language with toggle', () => {
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    fireEvent.click(screen.getByText('Add Gardens'))
    fireEvent.click(screen.getByText('Add Sentosa'))
    expect(screen.getByText('MRT')).toBeInTheDocument()
  })

  it('create trip button disabled with no places', () => {
    enterManual()
    expect(screen.getByText(/create itinerary/i)).toBeInTheDocument()
    expect(screen.getByText(/add at least/i)).toBeInTheDocument()
  })

  it('calls createTrip then planTrip on submit', async () => {
    api.createTrip.mockResolvedValue({ trip_id: 'trip-abc' })
    api.planTrip.mockResolvedValue({})
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    fireEvent.click(screen.getByText('Add Gardens'))
    // close search, then find the create button (gradient button not disabled)
    const createBtn = screen.getAllByRole('button').find(b =>
      b.textContent.includes('Create Itinerary') && !b.disabled
    )
    fireEvent.click(createBtn)
    await waitFor(() => expect(api.createTrip).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.planTrip).toHaveBeenCalledWith('trip-abc', expect.objectContaining({
      place_ids: ['p1'],
      optimize_order: false,
    })))
  })

  it('navigates to /trip/:id after successful submit', async () => {
    api.createTrip.mockResolvedValue({ trip_id: 'trip-xyz' })
    api.planTrip.mockResolvedValue({})
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    fireEvent.click(screen.getByText('Add Gardens'))
    const createBtn = screen.getAllByRole('button').find(b =>
      b.textContent.includes('Create Itinerary') && !b.disabled
    )
    fireEvent.click(createBtn)
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(
      '/trip/trip-xyz',
      expect.objectContaining({ state: expect.objectContaining({ pendingSave: expect.any(Object) }) })
    ))
  })

  it('shows error when planTrip fails', async () => {
    api.createTrip.mockResolvedValue({ trip_id: 'trip-abc' })
    api.planTrip.mockRejectedValue(new Error('Server error'))
    enterManual()
    fireEvent.click(screen.getByText('Add place'))
    fireEvent.click(screen.getByText('Add Gardens'))
    const createBtn = screen.getAllByRole('button').find(b =>
      b.textContent.includes('Create Itinerary') && !b.disabled
    )
    fireEvent.click(createBtn)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server error'))
  })

  /* ── AI mode ────────────────────────────────────────── */
  const enterAI = () => {
    wrap()
    fireEvent.click(screen.getByText('Plan with AI'))
  }

  it('enters AI mode on secondary card click', () => {
    enterAI()
    expect(screen.getByText('Plan with AI')).toBeInTheDocument() // button label
    expect(screen.getByText('Preferences')).toBeInTheDocument()
  })

  it('AI back button returns to mode chooser', () => {
    enterAI()
    fireEvent.click(screen.getByText('Change method'))
    expect(screen.getByText('Build it yourself')).toBeInTheDocument()
  })

  it('AI mode shows companion and style chips', () => {
    enterAI()
    expect(screen.getByText('Solo')).toBeInTheDocument()
    expect(screen.getByText('Cultural')).toBeInTheDocument()
  })

  it('AI mode shows pace options', () => {
    enterAI()
    expect(screen.getByText('Ambitious')).toBeInTheDocument()
    expect(screen.getByText('Moderate')).toBeInTheDocument()
    expect(screen.getByText('Relaxed')).toBeInTheDocument()
  })
})
