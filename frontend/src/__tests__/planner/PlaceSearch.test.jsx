import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { LanguageProvider } from '../../contexts/LanguageContext'
import PlaceSearch from '../../components/planner/PlaceSearch'

vi.mock('../../services/api', () => ({
  api: {
    getCuratedPlaces: vi.fn(),
    searchPlaces: vi.fn(),
  },
}))

import { api } from '../../services/api'

const CURATED = [
  { id: 'c1', name: 'Gardens by the Bay', category: 'nature', in_curated_dataset: true, lat: 1.28, lng: 103.86 },
  { id: 'c2', name: 'Marina Bay Sands',   category: 'landmark', in_curated_dataset: true, lat: 1.28, lng: 103.86 },
]

const flush = () => act(async () => { await vi.runAllTimersAsync() })
const wrap = (ui) => render(ui, { wrapper: LanguageProvider })

describe('PlaceSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    api.getCuratedPlaces.mockResolvedValue(CURATED)
    api.searchPlaces.mockResolvedValue([])
  })
  afterEach(() => vi.useRealTimers())

  /* ── Featured (no query) ─────────────────────────────── */
  it('shows popular heading and loads curated places on mount', async () => {
    wrap(<PlaceSearch onAdd={vi.fn()} />)
    expect(screen.getByText('Popular places in Singapore')).toBeInTheDocument()
    await flush()
    expect(screen.getByText('Gardens by the Bay')).toBeInTheDocument()
    expect(screen.getByText('Marina Bay Sands')).toBeInTheDocument()
  })

  it('marks places in addedIds as Added (disabled)', async () => {
    wrap(<PlaceSearch onAdd={vi.fn()} addedIds={new Set(['c1'])} />)
    await flush()
    const btns = screen.getAllByRole('button')
    const addedBtn = btns.find(b => b.textContent.includes('Added'))
    expect(addedBtn).toBeDisabled()
  })

  it('shows Add button (enabled) for places not in addedIds', async () => {
    wrap(<PlaceSearch onAdd={vi.fn()} addedIds={new Set()} />)
    await flush()
    const addBtns = screen.getAllByRole('button').filter(b => b.textContent.trim() === 'Add')
    expect(addBtns.length).toBeGreaterThan(0)
    addBtns.forEach(b => expect(b).not.toBeDisabled())
  })

  it('calls onAdd with place data and panel stays visible', async () => {
    const onAdd = vi.fn()
    wrap(<PlaceSearch onAdd={onAdd} addedIds={new Set()} />)
    await flush()
    const addBtn = screen.getAllByRole('button').find(b => b.textContent.trim() === 'Add')
    fireEvent.click(addBtn)
    expect(onAdd).toHaveBeenCalledWith(CURATED[0])
    expect(screen.getByText('Popular places in Singapore')).toBeInTheDocument()
  })

  /* ── Search debounce ─────────────────────────────────── */
  it('does not call searchPlaces before 400ms', async () => {
    wrap(<PlaceSearch onAdd={vi.fn()} />)
    await flush() // let getCuratedPlaces settle
    fireEvent.change(screen.getByPlaceholderText('Search places in Singapore…'), { target: { value: 'Marina' } })
    await act(async () => { vi.advanceTimersByTime(399) })
    expect(api.searchPlaces).not.toHaveBeenCalled()
  })

  it('calls searchPlaces after 400ms debounce', async () => {
    wrap(<PlaceSearch onAdd={vi.fn()} />)
    await flush()
    fireEvent.change(screen.getByPlaceholderText('Search places in Singapore…'), { target: { value: 'Marina' } })
    await flush()
    expect(api.searchPlaces).toHaveBeenCalledWith('Marina')
  })

  it('resets debounce on each keystroke — fires once', async () => {
    wrap(<PlaceSearch onAdd={vi.fn()} />)
    await flush()
    const input = screen.getByPlaceholderText('Search places in Singapore…')
    fireEvent.change(input, { target: { value: 'M' } })
    await act(async () => { vi.advanceTimersByTime(200) })
    fireEvent.change(input, { target: { value: 'Ma' } })
    await act(async () => { vi.advanceTimersByTime(200) })
    fireEvent.change(input, { target: { value: 'Mar' } })
    await flush()
    expect(api.searchPlaces).toHaveBeenCalledTimes(1)
    expect(api.searchPlaces).toHaveBeenCalledWith('Mar')
  })

  it('shows result count when results return', async () => {
    api.searchPlaces.mockResolvedValue([CURATED[0]])
    wrap(<PlaceSearch onAdd={vi.fn()} />)
    await flush()
    fireEvent.change(screen.getByPlaceholderText('Search places in Singapore…'), { target: { value: 'garden' } })
    await flush()
    expect(screen.getByText(/1 result/)).toBeInTheDocument()
  })

  it('clears results when input is emptied', async () => {
    api.searchPlaces.mockResolvedValue([CURATED[0]])
    wrap(<PlaceSearch onAdd={vi.fn()} />)
    await flush()
    const input = screen.getByPlaceholderText('Search places in Singapore…')
    fireEvent.change(input, { target: { value: 'garden' } })
    await flush()
    expect(screen.getByText('Gardens by the Bay')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '' } })
    await flush()
    // back to featured list — still visible from curated
    expect(screen.getByText('Popular places in Singapore')).toBeInTheDocument()
  })

  /* ── Curated vs limited data ─────────────────────────── */
  it('shows "Limited data" badge for non-curated place', async () => {
    api.searchPlaces.mockResolvedValue([{ id: 'x', name: 'Unknown Spot', in_curated_dataset: false }])
    wrap(<PlaceSearch onAdd={vi.fn()} />)
    await flush()
    fireEvent.change(screen.getByPlaceholderText('Search places in Singapore…'), { target: { value: 'Unknown' } })
    await flush()
    expect(screen.getByText('Limited data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add/i })).toBeDisabled()
  })

  it('shows error message when API fails', async () => {
    api.searchPlaces.mockRejectedValue(new Error('Network error'))
    wrap(<PlaceSearch onAdd={vi.fn()} />)
    await flush()
    fireEvent.change(screen.getByPlaceholderText('Search places in Singapore…'), { target: { value: 'fail' } })
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('Network error')
  })
})
