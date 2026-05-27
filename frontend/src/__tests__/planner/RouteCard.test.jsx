import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import RouteCard from '../../components/planner/RouteCard'

vi.mock('../../services/api', () => ({
  api: { updateLeg: vi.fn() },
  TRANSPORT_MODES: ['MRT', 'LRT', 'BUS', 'WALK'],
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

  it('renders transport mode, duration, and cost', () => {
    render(<RouteCard leg={baseLeg} />)
    expect(screen.getByText('MRT')).toBeInTheDocument()
    expect(screen.getByText(/10 min/i)).toBeInTheDocument()
    expect(screen.getByText(/S\$1\.50/i)).toBeInTheDocument()
  })

  it('shows estimated text when is_estimated is true', () => {
    render(<RouteCard leg={{ ...baseLeg, is_estimated: true }} />)
    expect(screen.getByText(/~Est/i)).toBeInTheDocument()
  })

  it('does not show edit button when tripId is not provided', () => {
    render(<RouteCard leg={baseLeg} />)
    expect(screen.queryByRole('button', { name: /Edit transport mode/i })).not.toBeInTheDocument()
  })

  it('opens transport mode selector when edit is clicked', async () => {
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)
    fireEvent.click(screen.getByRole('button', { name: /Edit transport mode/i }))

    await waitFor(() => expect(screen.getByRole('dialog', { name: /Change transport mode/i })).toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: /New mode/i })).toHaveValue('MRT')
    expect(screen.queryByRole('option', { name: /Drive/i })).not.toBeInTheDocument()
  })

  it('closes the edit dialog when Cancel is clicked', async () => {
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)
    fireEvent.click(screen.getByRole('button', { name: /Edit transport mode/i }))
    await waitFor(() => screen.getByRole('combobox', { name: /New mode/i }))

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))

    await waitFor(() => expect(screen.queryByRole('combobox', { name: /New mode/i })).not.toBeInTheDocument())
  })

  it('calls updateLeg with the selected backend-supported mode', async () => {
    const onUpdated = vi.fn()
    api.updateLeg.mockResolvedValue({})
    render(<RouteCard leg={baseLeg} tripId="trip-1" onUpdated={onUpdated} />)

    fireEvent.click(screen.getByRole('button', { name: /Edit transport mode/i }))
    await waitFor(() => screen.getByRole('combobox', { name: /New mode/i }))
    fireEvent.change(screen.getByRole('combobox', { name: /New mode/i }), { target: { value: 'BUS' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }))

    await waitFor(() =>
      expect(api.updateLeg).toHaveBeenCalledWith('trip-1', 'leg-1', { transport_mode: 'BUS' })
    )
    expect(onUpdated).toHaveBeenCalledTimes(1)
  })

  it('shows error when updateLeg fails and keeps dialog open', async () => {
    api.updateLeg.mockRejectedValue(new Error('Update failed'))
    render(<RouteCard leg={baseLeg} tripId="trip-1" />)

    fireEvent.click(screen.getByRole('button', { name: /Edit transport mode/i }))
    await waitFor(() => screen.getByRole('combobox', { name: /New mode/i }))
    fireEvent.click(screen.getByRole('button', { name: /Confirm/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Update failed')
    )
    expect(screen.getByRole('combobox', { name: /New mode/i })).toBeInTheDocument()
  })
})
