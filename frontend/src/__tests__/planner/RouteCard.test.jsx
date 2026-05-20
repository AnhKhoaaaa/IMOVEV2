import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RouteCard from '../../components/planner/RouteCard'

vi.mock('../../services/api', () => ({
  api: { updateLeg: vi.fn() },
}))

import { api } from '../../services/api'

const baseLeg = {
  id: 'leg-1',
  transport_mode: 'MRT',
  duration_minutes: 10,
  cost_sgd: 1.50,
  is_estimated: false,
  from_place_id: 'place-a',
  to_place_id: 'place-b',
}

describe('RouteCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders transport mode and duration', () => {
    render(<RouteCard leg={baseLeg} />)
    expect(screen.getByText(/MRT/)).toBeInTheDocument()
    expect(screen.getByText(/10 phút/)).toBeInTheDocument()
  })

  it('renders formatted cost', () => {
    render(<RouteCard leg={baseLeg} />)
    expect(screen.getByText(/SGD 1\.50/)).toBeInTheDocument()
  })

  it('shows "~ Ước tính" badge when is_estimated is true', () => {
    render(<RouteCard leg={{ ...baseLeg, is_estimated: true }} />)
    expect(screen.getByText('~ Ước tính')).toBeInTheDocument()
  })

  it('does not show badge when is_estimated is false', () => {
    render(<RouteCard leg={{ ...baseLeg, is_estimated: false }} />)
    expect(screen.queryByText('~ Ước tính')).not.toBeInTheDocument()
  })

  it('renders "SGD —" when cost_sgd is null', () => {
    render(<RouteCard leg={{ ...baseLeg, cost_sgd: null }} />)
    expect(screen.getByText(/SGD —/)).toBeInTheDocument()
  })

  it('renders "SGD —" when cost_sgd is undefined', () => {
    render(<RouteCard leg={{ ...baseLeg, cost_sgd: undefined }} />)
    expect(screen.getByText(/SGD —/)).toBeInTheDocument()
  })

  it('renders route direction', () => {
    render(<RouteCard leg={baseLeg} />)
    expect(screen.getByText('place-a → place-b')).toBeInTheDocument()
  })

  // ── Edit button ───────────────────────────────────────────────────────────

  it('does not show edit button when tripId is not provided', () => {
    render(<RouteCard leg={baseLeg} />)
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
  })

  it('shows edit button when tripId is provided', () => {
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
  })

  it('clicking edit button opens transport mode selector', async () => {
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument())
  })

  it('clicking Huỷ closes the edit dialog', async () => {
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('button', { name: /huỷ/i }))
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
  })

  it('calls updateLeg with correct args when confirming new mode', async () => {
    api.updateLeg.mockResolvedValue({})
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BUS' } })
    fireEvent.click(screen.getByRole('button', { name: /xác nhận/i }))

    await waitFor(() =>
      expect(api.updateLeg).toHaveBeenCalledWith('trip-1', 'leg-1', { transport_mode: 'BUS' })
    )
  })

  it('closes edit dialog after successful update', async () => {
    api.updateLeg.mockResolvedValue({})
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('button', { name: /xác nhận/i }))

    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
  })

  it('updates displayed transport mode after successful update', async () => {
    api.updateLeg.mockResolvedValue({})
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BUS' } })
    fireEvent.click(screen.getByRole('button', { name: /xác nhận/i }))

    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
    expect(screen.getByText(/Bus/)).toBeInTheDocument()
  })

  it('seeds dropdown from confirmed mode on re-open', async () => {
    api.updateLeg.mockResolvedValue({})
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BUS' } })
    fireEvent.click(screen.getByRole('button', { name: /xác nhận/i }))
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    expect(screen.getByRole('combobox')).toHaveValue('BUS')
  })

  it('shows error when updateLeg fails', async () => {
    api.updateLeg.mockRejectedValue(new Error('Update failed'))
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('button', { name: /xác nhận/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Update failed')
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
