import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TravelTips from '../../components/planner/TravelTips'

const makePlace = (overrides = {}) => ({
  id: 'test-place',
  name: 'Test Place',
  category: 'landmark',
  is_outdoor: false,
  best_time_start: '09:00',
  ...overrides,
})

describe('TravelTips', () => {
  it('renders nothing when places is empty', () => {
    const { container } = render(<TravelTips places={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('always shows EZ-Link tip', () => {
    render(<TravelTips places={[makePlace()]} />)
    expect(screen.getByText(/EZ-Link/)).toBeInTheDocument()
  })

  it('always shows cash tip', () => {
    render(<TravelTips places={[makePlace()]} />)
    expect(screen.getByText(/tiền mặt SGD/)).toBeInTheDocument()
  })

  it('shows outdoor tip when any place is outdoor', () => {
    render(<TravelTips places={[makePlace({ is_outdoor: true })]} />)
    expect(screen.getByText(/kem chống nắng/)).toBeInTheDocument()
  })

  it('does not show outdoor tip when no outdoor places', () => {
    render(<TravelTips places={[makePlace({ is_outdoor: false })]} />)
    expect(screen.queryByText(/kem chống nắng/)).not.toBeInTheDocument()
  })

  it('shows religious tip for museum category', () => {
    render(<TravelTips places={[makePlace({ category: 'museum' })]} />)
    expect(screen.getByText(/ăn mặc kín đáo/i)).toBeInTheDocument()
  })

  it('shows religious tip for heritage category', () => {
    render(<TravelTips places={[makePlace({ category: 'heritage' })]} />)
    expect(screen.getByText(/ăn mặc kín đáo/i)).toBeInTheDocument()
  })

  it('shows religious tip when place name contains "mosque"', () => {
    render(<TravelTips places={[makePlace({ name: 'Sultan Mosque' })]} />)
    expect(screen.getByText(/ăn mặc kín đáo/i)).toBeInTheDocument()
  })

  it('shows religious tip when place name contains "temple"', () => {
    render(<TravelTips places={[makePlace({ name: 'Sri Mariamman Temple' })]} />)
    expect(screen.getByText(/ăn mặc kín đáo/i)).toBeInTheDocument()
  })

  it('does not show religious tip for regular landmark', () => {
    render(<TravelTips places={[makePlace({ category: 'landmark', name: 'Merlion Park' })]} />)
    expect(screen.queryByText(/ăn mặc kín đáo/i)).not.toBeInTheDocument()
  })

  it('shows night tip when any place has best_time_start >= 19:00', () => {
    render(<TravelTips places={[makePlace({ best_time_start: '19:00' })]} />)
    expect(screen.getByText(/book vé trước/i)).toBeInTheDocument()
  })

  it('does not show night tip for daytime places', () => {
    render(<TravelTips places={[makePlace({ best_time_start: '10:00' })]} />)
    expect(screen.queryByText(/book vé trước/i)).not.toBeInTheDocument()
  })

  it('shows nature/weather tip for nature category', () => {
    render(<TravelTips places={[makePlace({ category: 'nature' })]} />)
    expect(screen.getByText(/dự báo thời tiết/)).toBeInTheDocument()
  })

  it('does not show weather tip for non-nature category', () => {
    render(<TravelTips places={[makePlace({ category: 'entertainment' })]} />)
    expect(screen.queryByText(/dự báo thời tiết/)).not.toBeInTheDocument()
  })

  it('shows correct tip count in header', () => {
    // landmark, indoor, daytime, non-nature → only 2 always tips
    render(<TravelTips places={[makePlace()]} />)
    expect(screen.getByText('Lưu ý hành trình (2)')).toBeInTheDocument()
  })

  it('shows 6 tips for a comprehensive trip', () => {
    const places = [
      makePlace({ is_outdoor: true }),
      makePlace({ id: 'p2', category: 'heritage', name: 'Peranakan Museum' }),
      makePlace({ id: 'p3', best_time_start: '20:00' }),
      makePlace({ id: 'p4', category: 'nature' }),
    ]
    render(<TravelTips places={places} />)
    expect(screen.getByText('Lưu ý hành trình (6)')).toBeInTheDocument()
  })
})
