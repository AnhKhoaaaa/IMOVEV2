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
    expect(screen.getByText(/10 min/)).toBeInTheDocument()
  })

  it('renders formatted cost', () => {
    render(<RouteCard leg={baseLeg} />)
    expect(screen.getByText(/S\$1\.50/)).toBeInTheDocument()
  })

  it('shows estimated badge when is_estimated is true', () => {
    render(<RouteCard leg={{ ...baseLeg, is_estimated: true }} />)
    expect(screen.getByText(/~Est\./)).toBeInTheDocument()
  })

  it('does not show badge when is_estimated is false', () => {
    render(<RouteCard leg={{ ...baseLeg, is_estimated: false }} />)
    expect(screen.queryByText(/~Est\./)).not.toBeInTheDocument()
  })

  it('omits cost when cost_sgd is null', () => {
    render(<RouteCard leg={{ ...baseLeg, cost_sgd: null }} />)
    expect(screen.queryByText(/S\$/)).not.toBeInTheDocument()
  })

  it('omits cost when cost_sgd is undefined', () => {
    render(<RouteCard leg={{ ...baseLeg, cost_sgd: undefined }} />)
    expect(screen.queryByText(/S\$/)).not.toBeInTheDocument()
  })

  it('renders leg info with from/to place IDs without exposing raw IDs', () => {
    render(<RouteCard leg={baseLeg} />)
    expect(screen.getByText(/MRT/)).toBeInTheDocument()
    expect(screen.queryByText('place-a')).not.toBeInTheDocument()
    expect(screen.queryByText('place-b')).not.toBeInTheDocument()
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

  it('clicking Cancel closes the edit dialog', async () => {
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
  })

  it('calls updateLeg with correct args when confirming new mode', async () => {
    api.updateLeg.mockResolvedValue({})
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BUS' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() =>
      expect(api.updateLeg).toHaveBeenCalledWith('trip-1', 'leg-1', { transport_mode: 'BUS' })
    )
  })

  it('closes edit dialog after successful update', async () => {
    api.updateLeg.mockResolvedValue({})
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
  })

  it('updates displayed transport mode after successful update', async () => {
    api.updateLeg.mockResolvedValue({})
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BUS' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
    expect(screen.getByText(/Bus/)).toBeInTheDocument()
  })

  it('seeds dropdown from confirmed mode on re-open', async () => {
    api.updateLeg.mockResolvedValue({})
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    await waitFor(() => screen.getByRole('combobox'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BUS' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
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
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Update failed')
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  // ── instructions rendering ────────────────────────────────────────────────

  it('renders correctly with geometry=null and no instructions', () => {
    render(<RouteCard leg={{ ...baseLeg, geometry: null, instructions: [] }} />)
    expect(screen.getByText(/MRT/)).toBeInTheDocument()
    expect(screen.getByText(/10 min/)).toBeInTheDocument()
  })

  it('expands to show instructions when leg.instructions is non-empty', async () => {
    const legWithInstructions = {
      ...baseLeg,
      geometry: null,
      instructions: ['Walk to Bayfront Station (5 min)', 'Board EW line at Bayfront'],
    }
    render(<RouteCard leg={legWithInstructions} />)

    // Initially collapsed — instructions not visible
    expect(screen.queryByText('Walk to Bayfront Station (5 min)')).not.toBeInTheDocument()

    // Click the card header button to expand
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])

    await waitFor(() =>
      expect(screen.getByText('Walk to Bayfront Station (5 min)')).toBeInTheDocument()
    )
    expect(screen.getByText('Board EW line at Bayfront')).toBeInTheDocument()
  })
})
