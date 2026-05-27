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

const makePlace = (id, name) => ({
  id,
  name,
  lat: 1.3,
  lng: 103.8,
  dwell_minutes: 60,
  best_time_start: '09:00',
  best_time_end: '12:00',
  category: 'landmark',
  is_outdoor: false,
})

const placesById = {
  A: makePlace('A', 'Place A'),
  B: makePlace('B', 'Place B'),
  C: makePlace('C', 'Place C'),
  D: makePlace('D', 'Place D'),
}

describe('DayPlan', () => {
  it('renders current day header and stop count', () => {
    render(<DayPlan day={1} legs={[makeLeg()]} placesById={placesById} />)
    expect(screen.getByRole('heading', { name: /Day 1/i })).toBeInTheDocument()
    expect(screen.getByText(/2 stops/i)).toBeInTheDocument()
    expect(screen.getAllByText(/S\$1\.50/i).length).toBeGreaterThan(0)
  })

  it('renders an empty state when there are no legs', () => {
    render(<DayPlan day={2} legs={[]} placesById={placesById} />)
    expect(screen.getByText(/No stops yet/i)).toBeInTheDocument()
    expect(screen.getByText(/No places yet/i)).toBeInTheDocument()
  })

  it('counts multiple connected legs correctly', () => {
    const legs = [
      makeLeg({ id: 'l1' }),
      makeLeg({ id: 'l2', from_place_id: 'B', to_place_id: 'C' }),
      makeLeg({ id: 'l3', from_place_id: 'C', to_place_id: 'D' }),
    ]
    render(<DayPlan day={3} legs={legs} placesById={placesById} />)
    expect(screen.getByRole('heading', { name: /Day 3/i })).toBeInTheDocument()
    expect(screen.getByText(/4 stops/i)).toBeInTheDocument()
  })

  it('renders places and transit segments from the timeline', () => {
    const legs = [
      makeLeg({ id: 'l1', transport_mode: 'MRT' }),
      makeLeg({ id: 'l2', transport_mode: 'WALK', from_place_id: 'B', to_place_id: 'C' }),
    ]
    render(<DayPlan day={1} legs={legs} placesById={placesById} />)
    expect(screen.getByText('Place A')).toBeInTheDocument()
    expect(screen.getByText('Place B')).toBeInTheDocument()
    expect(screen.getByText('Place C')).toBeInTheDocument()
    expect(screen.getByText(/Transit/i)).toBeInTheDocument()
    expect(screen.getByText(/Walking/i)).toBeInTheDocument()
  })

  it('shows an estimated badge for estimated legs', () => {
    render(<DayPlan day={1} legs={[makeLeg({ is_estimated: true })]} placesById={placesById} />)
    expect(screen.getByText('~ Est.')).toBeInTheDocument()
  })

  it('does not show estimated badge for non-estimated legs', () => {
    render(<DayPlan day={1} legs={[makeLeg({ is_estimated: false })]} placesById={placesById} />)
    expect(screen.queryByText('~ Est.')).not.toBeInTheDocument()
  })

  it('renders the estimated badge only for estimated legs when mixed', () => {
    const legs = [
      makeLeg({ id: 'l1', is_estimated: true }),
      makeLeg({ id: 'l2', is_estimated: false, from_place_id: 'B', to_place_id: 'C' }),
    ]
    render(<DayPlan day={1} legs={legs} placesById={placesById} />)
    expect(screen.getAllByText('~ Est.')).toHaveLength(1)
  })
})
