import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import PlaceSearch from '../../components/planner/PlaceSearch'
import { api } from '../../services/api'

vi.mock('../../services/api', () => ({
  api: { searchPlaces: vi.fn() },
}))

const PLACEHOLDER = 'Tìm địa điểm...'
const flush = () => act(async () => { await vi.runAllTimersAsync() })

describe('PlaceSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('renders search input', () => {
    render(<PlaceSearch onAdd={vi.fn()} />)
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument()
  })

  it('does not call searchPlaces before 500ms', async () => {
    api.searchPlaces.mockResolvedValue([])
    render(<PlaceSearch onAdd={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'Marina' } })
    await act(async () => { vi.advanceTimersByTime(499) })

    expect(api.searchPlaces).not.toHaveBeenCalled()
  })

  it('calls searchPlaces after 500ms debounce', async () => {
    api.searchPlaces.mockResolvedValue([])
    render(<PlaceSearch onAdd={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'Marina' } })
    await flush()

    expect(api.searchPlaces).toHaveBeenCalledTimes(1)
    expect(api.searchPlaces).toHaveBeenCalledWith('Marina')
  })

  it('resets debounce on each keystroke — fires only once', async () => {
    api.searchPlaces.mockResolvedValue([])
    render(<PlaceSearch onAdd={vi.fn()} />)
    const input = screen.getByPlaceholderText(PLACEHOLDER)

    fireEvent.change(input, { target: { value: 'M' } })
    await act(async () => { vi.advanceTimersByTime(200) })
    fireEvent.change(input, { target: { value: 'Ma' } })
    await act(async () => { vi.advanceTimersByTime(200) })
    fireEvent.change(input, { target: { value: 'Mar' } })
    await flush()

    expect(api.searchPlaces).toHaveBeenCalledTimes(1)
    expect(api.searchPlaces).toHaveBeenCalledWith('Mar')
  })

  it('clears results when input is emptied', async () => {
    api.searchPlaces.mockResolvedValue([
      { id: '1', name: 'Marina Bay Sands', in_curated_dataset: true },
    ])
    render(<PlaceSearch onAdd={vi.fn()} />)
    const input = screen.getByPlaceholderText(PLACEHOLDER)

    fireEvent.change(input, { target: { value: 'Marina' } })
    await flush()
    expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: '' } })
    await flush()
    expect(screen.queryByText('Marina Bay Sands')).not.toBeInTheDocument()
  })

  it('shows "Thiếu dữ liệu" badge for non-curated place', async () => {
    api.searchPlaces.mockResolvedValue([
      { id: '1', name: 'Unknown Spot', in_curated_dataset: false },
    ])
    render(<PlaceSearch onAdd={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'Unknown' } })
    await flush()

    expect(screen.getByText('Thiếu dữ liệu')).toBeInTheDocument()
  })

  it('does not show badge for curated place', async () => {
    api.searchPlaces.mockResolvedValue([
      { id: '1', name: 'Marina Bay Sands', in_curated_dataset: true },
    ])
    render(<PlaceSearch onAdd={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'Marina' } })
    await flush()

    expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument()
    expect(screen.queryByText('Thiếu dữ liệu')).not.toBeInTheDocument()
  })

  it('Add button is disabled for non-curated place', async () => {
    api.searchPlaces.mockResolvedValue([
      { id: '1', name: 'Unknown Spot', in_curated_dataset: false },
    ])
    render(<PlaceSearch onAdd={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'Unknown' } })
    await flush()

    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled()
  })

  it('Add button is enabled for curated place', async () => {
    api.searchPlaces.mockResolvedValue([
      { id: '1', name: 'Marina Bay Sands', in_curated_dataset: true },
    ])
    render(<PlaceSearch onAdd={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'Marina' } })
    await flush()

    expect(screen.getByRole('button', { name: /add/i })).not.toBeDisabled()
  })

  it('calls onAdd with place data when Add is clicked', async () => {
    const place = { id: '1', name: 'Marina Bay Sands', in_curated_dataset: true }
    api.searchPlaces.mockResolvedValue([place])
    const onAdd = vi.fn()
    render(<PlaceSearch onAdd={onAdd} />)

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'Marina' } })
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    expect(onAdd).toHaveBeenCalledWith(place)
  })

  it('shows error message when API fails', async () => {
    api.searchPlaces.mockRejectedValue(new Error('Network error'))
    render(<PlaceSearch onAdd={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'fail' } })
    await flush()

    expect(screen.getByRole('alert')).toHaveTextContent('Network error')
  })
})
