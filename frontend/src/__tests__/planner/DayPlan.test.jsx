import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DayPlan from '../../components/planner/DayPlan'

const makeLeg = (overrides = {}) => ({
  id: 'leg-1',
  transport_mode: 'MRT',
  duration_minutes: 10,
  cost_sgd: 1.50,
  is_estimated: false,
  from_place_id: 'A',
  to_place_id: 'B',
  ...overrides,
})

describe('DayPlan', () => {
  it('renders day header: 1 leg = 2 places', () => {
    render(<DayPlan day={1} legs={[makeLeg()]} />)
    expect(screen.getByRole('heading', { level: 2, name: /Day 1/i })).toBeInTheDocument()
    expect(screen.getByText(/2 stops/)).toBeInTheDocument()
  })

  it('renders "No stops yet" when legs is empty', () => {
    render(<DayPlan day={2} legs={[]} />)
    expect(screen.getByRole('heading', { level: 2, name: /Day 2/i })).toBeInTheDocument()
    expect(screen.getByText('No stops yet')).toBeInTheDocument()
  })

  it('counts multiple legs correctly: 3 legs = 4 places', () => {
    const legs = [
      makeLeg({ id: 'l1' }),
      makeLeg({ id: 'l2', from_place_id: 'B', to_place_id: 'C' }),
      makeLeg({ id: 'l3', from_place_id: 'C', to_place_id: 'D' }),
    ]
    render(<DayPlan day={3} legs={legs} />)
    expect(screen.getByRole('heading', { level: 2, name: /Day 3/i })).toBeInTheDocument()
    expect(screen.getByText(/4 stops/)).toBeInTheDocument()
  })

  it('renders all legs', () => {
    const legs = [
      makeLeg({ id: 'l1', transport_mode: 'MRT' }),
      makeLeg({ id: 'l2', transport_mode: 'WALK', from_place_id: 'B', to_place_id: 'C' }),
    ]
    render(<DayPlan day={1} legs={legs} />)
    // TransitSegment maps MRT → "Transit", WALK → "Walking"
    expect(screen.getAllByText(/Transit/)[0]).toBeInTheDocument()
    expect(screen.getAllByText(/Walking/)[0]).toBeInTheDocument()
  })

  it('shows estimated badge for estimated leg', () => {
    render(<DayPlan day={1} legs={[makeLeg({ is_estimated: true })]} />)
    expect(screen.getByText(/Est\./)).toBeInTheDocument()
  })

  it('does not show badge for non-estimated leg', () => {
    render(<DayPlan day={1} legs={[makeLeg({ is_estimated: false })]} />)
    expect(screen.queryByText(/Est\./)).not.toBeInTheDocument()
  })

  it('renders badge only for estimated legs when mixed', () => {
    const legs = [
      makeLeg({ id: 'l1', is_estimated: true }),
      makeLeg({ id: 'l2', is_estimated: false, from_place_id: 'B', to_place_id: 'C' }),
    ]
    render(<DayPlan day={1} legs={legs} />)
    expect(screen.getAllByText(/Est\./)).toHaveLength(1)
  })

  describe('time slot grouping', () => {
    it('shows slot headers when legs have time_slot', () => {
      const legs = [
        makeLeg({ id: 'l1', time_slot: 'morning' }),
        makeLeg({ id: 'l2', from_place_id: 'B', to_place_id: 'C', time_slot: 'evening' }),
      ]
      render(<DayPlan day={1} legs={legs} />)
      expect(screen.getByText('🌅 Buổi sáng')).toBeInTheDocument()
      expect(screen.getByText('🌙 Buổi tối')).toBeInTheDocument()
    })

    it('does not show slot headers when all time_slot are null', () => {
      const legs = [
        makeLeg({ id: 'l1', time_slot: null }),
        makeLeg({ id: 'l2', from_place_id: 'B', to_place_id: 'C', time_slot: null }),
      ]
      render(<DayPlan day={1} legs={legs} />)
      expect(screen.queryByText('🌅 Buổi sáng')).not.toBeInTheDocument()
      expect(screen.queryByText('☀️ Buổi chiều')).not.toBeInTheDocument()
      expect(screen.queryByText('🌙 Buổi tối')).not.toBeInTheDocument()
    })

    it('does not show slot headers when time_slot is absent (legacy data)', () => {
      render(<DayPlan day={1} legs={[makeLeg()]} />)
      expect(screen.queryByText('🌅 Buổi sáng')).not.toBeInTheDocument()
    })

    it('only renders headers for slots that have legs', () => {
      const legs = [makeLeg({ id: 'l1', time_slot: 'afternoon' })]
      render(<DayPlan day={1} legs={legs} />)
      expect(screen.getByText('☀️ Buổi chiều')).toBeInTheDocument()
      expect(screen.queryByText('🌅 Buổi sáng')).not.toBeInTheDocument()
      expect(screen.queryByText('🌙 Buổi tối')).not.toBeInTheDocument()
    })

    it('renders all 3 slot headers when each slot has at least one leg', () => {
      const legs = [
        makeLeg({ id: 'l1', time_slot: 'morning' }),
        makeLeg({ id: 'l2', from_place_id: 'B', to_place_id: 'C', time_slot: 'afternoon' }),
        makeLeg({ id: 'l3', from_place_id: 'C', to_place_id: 'D', time_slot: 'evening' }),
      ]
      render(<DayPlan day={1} legs={legs} />)
      expect(screen.getByText('🌅 Buổi sáng')).toBeInTheDocument()
      expect(screen.getByText('☀️ Buổi chiều')).toBeInTheDocument()
      expect(screen.getByText('🌙 Buổi tối')).toBeInTheDocument()
    })
  })
})
