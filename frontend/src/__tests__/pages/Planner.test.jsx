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
    createTrip: vi.fn(),
    planTrip: vi.fn(),
  },
}))

vi.mock('../../components/planner/PlaceBrowser', () => ({
  default: ({ selectedIds, onToggle }) => (
    <button
      onClick={() =>
        onToggle({ id: 'place-1', name: 'Gardens by the Bay', in_curated_dataset: true, category: 'nature', dwell_minutes: 180 })
      }
    >
      Add Gardens
    </button>
  ),
}))

import { api } from '../../services/api'

const renderPlanner = () => render(<BrowserRouter><Planner /></BrowserRouter>)

const advanceTo = async (targetStep) => {
  fireEvent.click(screen.getByRole('button', { name: /tiếp theo/i }))
  if (targetStep === 2) return
  fireEvent.click(screen.getByRole('button', { name: /add gardens/i }))
  fireEvent.click(screen.getByRole('button', { name: /tiếp theo/i }))
  if (targetStep === 3) return
  fireEvent.click(screen.getByRole('button', { name: /tiếp theo/i }))
}

describe('Planner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders step 1 with Singapore destination', () => {
    renderPlanner()
    expect(screen.getByText('Singapore')).toBeInTheDocument()
    expect(screen.getByText(/bước 1 \/ 4/i)).toBeInTheDocument()
  })

  it('advances to step 2 when Tiếp theo is clicked', () => {
    renderPlanner()
    fireEvent.click(screen.getByRole('button', { name: /tiếp theo/i }))
    expect(screen.getByText(/bước 2 \/ 4/i)).toBeInTheDocument()
  })

  it('"Tiếp theo" is disabled on step 2 when no places selected', async () => {
    renderPlanner()
    await advanceTo(2)
    expect(screen.getByRole('button', { name: /tiếp theo/i })).toBeDisabled()
  })

  it('enables "Tiếp theo" after adding a place', async () => {
    renderPlanner()
    await advanceTo(2)
    fireEvent.click(screen.getByRole('button', { name: /add gardens/i }))
    expect(screen.getByRole('button', { name: /tiếp theo/i })).not.toBeDisabled()
  })

  it('shows added place in list', async () => {
    renderPlanner()
    await advanceTo(2)
    fireEvent.click(screen.getByRole('button', { name: /add gardens/i }))
    expect(screen.getByText('Gardens by the Bay')).toBeInTheDocument()
  })

  it('removes place when Xoá is clicked', async () => {
    renderPlanner()
    await advanceTo(2)
    fireEvent.click(screen.getByRole('button', { name: /add gardens/i }))
    fireEvent.click(screen.getByRole('button', { name: /xoá gardens by the bay/i }))
    expect(screen.queryByText('Gardens by the Bay')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tiếp theo/i })).toBeDisabled()
  })

  it('removes a place when toggled a second time', async () => {
    renderPlanner()
    await advanceTo(2)
    fireEvent.click(screen.getByRole('button', { name: /add gardens/i }))
    fireEvent.click(screen.getByRole('button', { name: /add gardens/i }))
    expect(screen.queryByText('Gardens by the Bay')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tiếp theo/i })).toBeDisabled()
  })

  it('renders MRT checkbox and walk slider on step 3', async () => {
    renderPlanner()
    await advanceTo(3)
    expect(screen.getByText(/ưu tiên mrt/i)).toBeInTheDocument()
    expect(screen.getByRole('slider')).toBeInTheDocument()
  })

  it('MRT checkbox is checked by default', async () => {
    renderPlanner()
    await advanceTo(3)
    const checkbox = screen.getAllByRole('checkbox')[0]
    expect(checkbox).toBeChecked()
  })

  it('walk slider defaults to 15 phút', async () => {
    renderPlanner()
    await advanceTo(3)
    expect(screen.getByText('15 phút')).toBeInTheDocument()
  })

  it('updates walk minutes label when slider changes', async () => {
    renderPlanner()
    await advanceTo(3)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } })
    expect(screen.getByText('30 phút')).toBeInTheDocument()
  })

  it('renders optimize toggle and submit button on step 4', async () => {
    renderPlanner()
    await advanceTo(4)
    expect(screen.getByText(/tối ưu thứ tự/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tạo kế hoạch/i })).toBeInTheDocument()
  })

  it('calls createTrip then planTrip with correct payload', async () => {
    api.createTrip.mockResolvedValue({ trip_id: 'trip-abc' })
    api.planTrip.mockResolvedValue({})
    renderPlanner()
    await advanceTo(4)

    fireEvent.click(screen.getByRole('button', { name: /tạo kế hoạch/i }))

    await waitFor(() => expect(api.createTrip).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.planTrip).toHaveBeenCalledWith('trip-abc', {
      place_ids: ['place-1'],
      optimize_order: true,
      preferences: { prefer_mrt: true, max_walk_minutes: 15 },
    }))
  })

  it('includes updated preferences in planTrip payload', async () => {
    api.createTrip.mockResolvedValue({ trip_id: 'trip-abc' })
    api.planTrip.mockResolvedValue({})
    renderPlanner()
    await advanceTo(3)

    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /tiếp theo/i }))

    fireEvent.click(screen.getByRole('button', { name: /tạo kế hoạch/i }))

    await waitFor(() => expect(api.planTrip).toHaveBeenCalledWith('trip-abc', expect.objectContaining({
      preferences: { prefer_mrt: false, max_walk_minutes: 30 },
    })))
  })

  it('navigates to /trip/:id after successful submit', async () => {
    api.createTrip.mockResolvedValue({ trip_id: 'trip-xyz' })
    api.planTrip.mockResolvedValue({})
    renderPlanner()
    await advanceTo(4)

    fireEvent.click(screen.getByRole('button', { name: /tạo kế hoạch/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/trip/trip-xyz'))
  })

  it('shows loading text while submitting', async () => {
    api.createTrip.mockResolvedValue({ trip_id: 'trip-abc' })
    api.planTrip.mockReturnValue(new Promise(() => {}))
    renderPlanner()
    await advanceTo(4)

    fireEvent.click(screen.getByRole('button', { name: /tạo kế hoạch/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /đang tạo kế hoạch/i })).toBeDisabled()
    )
  })

  it('shows backend error message when planTrip fails', async () => {
    api.createTrip.mockResolvedValue({ trip_id: 'trip-abc' })
    api.planTrip.mockRejectedValue(new Error('Không đủ ngân sách'))
    renderPlanner()
    await advanceTo(4)

    fireEvent.click(screen.getByRole('button', { name: /tạo kế hoạch/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Không đủ ngân sách')
    )
  })

  it('shows backend error message when createTrip fails', async () => {
    api.createTrip.mockRejectedValue(new Error('Session expired'))
    renderPlanner()
    await advanceTo(4)

    fireEvent.click(screen.getByRole('button', { name: /tạo kế hoạch/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Session expired')
    )
  })

  it('re-enables submit button after error', async () => {
    api.createTrip.mockRejectedValue(new Error('Server error'))
    renderPlanner()
    await advanceTo(4)

    fireEvent.click(screen.getByRole('button', { name: /tạo kế hoạch/i }))

    await waitFor(() => screen.getByRole('alert'))
    expect(screen.getByRole('button', { name: /tạo kế hoạch/i })).not.toBeDisabled()
  })
})
