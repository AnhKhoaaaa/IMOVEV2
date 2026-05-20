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
    expect(screen.getByText('Ngày 1 — 2 địa điểm')).toBeInTheDocument()
  })

  it('renders "0 địa điểm" when legs is empty', () => {
    render(<DayPlan day={2} legs={[]} />)
    expect(screen.getByText('Ngày 2 — 0 địa điểm')).toBeInTheDocument()
  })

  it('counts multiple legs correctly: 3 legs = 4 places', () => {
    const legs = [
      makeLeg({ id: 'l1' }),
      makeLeg({ id: 'l2', from_place_id: 'B', to_place_id: 'C' }),
      makeLeg({ id: 'l3', from_place_id: 'C', to_place_id: 'D' }),
    ]
    render(<DayPlan day={3} legs={legs} />)
    expect(screen.getByText('Ngày 3 — 4 địa điểm')).toBeInTheDocument()
  })

  it('renders all legs', () => {
    const legs = [
      makeLeg({ id: 'l1', transport_mode: 'MRT' }),
      makeLeg({ id: 'l2', transport_mode: 'WALK', from_place_id: 'B', to_place_id: 'C' }),
    ]
    render(<DayPlan day={1} legs={legs} />)
    expect(screen.getByText(/MRT/)).toBeInTheDocument()
    expect(screen.getByText(/Đi bộ/)).toBeInTheDocument()
  })

  it('shows "~ Ước tính" badge for estimated leg', () => {
    render(<DayPlan day={1} legs={[makeLeg({ is_estimated: true })]} />)
    expect(screen.getByText('~ Ước tính')).toBeInTheDocument()
  })

  it('does not show badge for non-estimated leg', () => {
    render(<DayPlan day={1} legs={[makeLeg({ is_estimated: false })]} />)
    expect(screen.queryByText('~ Ước tính')).not.toBeInTheDocument()
  })

  it('renders badge only for estimated legs when mixed', () => {
    const legs = [
      makeLeg({ id: 'l1', is_estimated: true }),
      makeLeg({ id: 'l2', is_estimated: false, from_place_id: 'B', to_place_id: 'C' }),
    ]
    render(<DayPlan day={1} legs={legs} />)
    expect(screen.getAllByText('~ Ước tính')).toHaveLength(1)
  })
})
