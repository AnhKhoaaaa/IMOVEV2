import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as tlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import PlaceBrowser from '../../components/planner/PlaceBrowser'
import { api } from '../../services/api'
import { LanguageProvider } from '../../contexts/LanguageContext'

const render = (ui, options) => tlRender(ui, { wrapper: LanguageProvider, ...options })

vi.mock('../../services/api', () => ({
  api: { getCuratedPlaces: vi.fn() },
}))

const PLACES = [
  { id: 'gardens', name: 'Gardens by the Bay', category: 'nature',       dwell_minutes: 180, in_curated_dataset: true, rating: 4.8, description: 'A waterfront garden.', image_url: 'https://img.test/gardens.jpg' },
  { id: 'museum',  name: 'National Museum',    category: 'museum',       dwell_minutes: 120, in_curated_dataset: true },
  { id: 'marina',  name: 'Marina Bay Sands',   category: 'landmark',     dwell_minutes: 90,  in_curated_dataset: true },
  { id: 'uss',     name: 'Universal Studios',  category: 'entertainment',dwell_minutes: 480, in_curated_dataset: true },
  { id: 'jumbo',   name: 'Jumbo Seafood',      category: 'food',         dwell_minutes: 60,  in_curated_dataset: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  api.getCuratedPlaces.mockResolvedValue(PLACES)
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key) => {
      if (key === 'imove_lang') return 'vi'
      return null
    }),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })
})

describe('PlaceBrowser', () => {
  it('shows skeleton while loading', () => {
    api.getCuratedPlaces.mockReturnValue(new Promise(() => {}))
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    expect(screen.getByLabelText('Đang tải địa điểm')).toBeInTheDocument()
  })

  it('renders all places after loading', async () => {
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('Gardens by the Bay')).toBeInTheDocument())
    expect(screen.getByLabelText('National Museum')).toBeInTheDocument()
    expect(screen.getByLabelText('Marina Bay Sands')).toBeInTheDocument()
  })

  it('shows dwell_minutes for each place', async () => {
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('~180 phút')).toBeInTheDocument())
    expect(screen.getByText('~120 phút')).toBeInTheDocument()
  })

  it('renders available image, rating, and description', async () => {
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => expect(screen.getByAltText('')).toHaveAttribute('src', 'https://img.test/gardens.jpg'))
    expect(screen.getByText('4.8')).toBeInTheDocument()
    expect(screen.getByText('A waterfront garden.')).toBeInTheDocument()
  })

  it('shows selected place count', async () => {
    render(<PlaceBrowser selectedIds={['gardens']} onToggle={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('1 địa điểm đã chọn')).toBeInTheDocument())
  })

  it('filters by category group', async () => {
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => screen.getByLabelText('Gardens by the Bay'))

    fireEvent.click(screen.getByRole('button', { name: /thiên nhiên/i }))

    expect(screen.getByLabelText('Gardens by the Bay')).toBeInTheDocument()
    expect(screen.queryByLabelText('National Museum')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Marina Bay Sands')).not.toBeInTheDocument()
  })

  it('filters by culture group (museum + heritage)', async () => {
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => screen.getByLabelText('National Museum'))

    fireEvent.click(screen.getByRole('button', { name: /văn hoá/i }))

    expect(screen.getByLabelText('National Museum')).toBeInTheDocument()
    expect(screen.queryByLabelText('Gardens by the Bay')).not.toBeInTheDocument()
  })

  it('filters by search text (case-insensitive)', async () => {
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => screen.getByLabelText('Gardens by the Bay'))

    fireEvent.change(screen.getByLabelText('Tìm địa điểm'), { target: { value: 'marina' } })

    expect(screen.getByLabelText('Marina Bay Sands')).toBeInTheDocument()
    expect(screen.queryByLabelText('Gardens by the Bay')).not.toBeInTheDocument()
  })

  it('shows empty message when search matches nothing', async () => {
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => screen.getByLabelText('Gardens by the Bay'))

    fireEvent.change(screen.getByLabelText('Tìm địa điểm'), { target: { value: 'xyznotexist' } })

    expect(screen.getByText('Không có địa điểm nào')).toBeInTheDocument()
  })

  it('calls onToggle when a place card is clicked', async () => {
    const onToggle = vi.fn()
    render(<PlaceBrowser selectedIds={[]} onToggle={onToggle} />)
    await waitFor(() => screen.getByLabelText('Gardens by the Bay'))

    fireEvent.click(screen.getByLabelText('Gardens by the Bay'))

    expect(onToggle).toHaveBeenCalledWith(PLACES[0])
  })

  it('shows selected state when place is in selectedIds', async () => {
    render(<PlaceBrowser selectedIds={['gardens']} onToggle={vi.fn()} />)
    await waitFor(() => screen.getByLabelText('Gardens by the Bay'))

    const card = screen.getByLabelText('Gardens by the Bay')
    expect(card).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows unselected state for places not in selectedIds', async () => {
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => screen.getByLabelText('National Museum'))

    const card = screen.getByLabelText('National Museum')
    expect(card).toHaveAttribute('aria-pressed', 'false')
  })

  it('"Tất cả" chip shows all places', async () => {
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => screen.getByLabelText('Gardens by the Bay'))

    fireEvent.click(screen.getByRole('button', { name: /thiên nhiên/i }))
    fireEvent.click(screen.getByRole('button', { name: /tất cả/i }))

    expect(screen.getByLabelText('Gardens by the Bay')).toBeInTheDocument()
    expect(screen.getByLabelText('National Museum')).toBeInTheDocument()
    expect(screen.getByLabelText('Marina Bay Sands')).toBeInTheDocument()
  })

  it('shows empty fallback when API fails', async () => {
    api.getCuratedPlaces.mockRejectedValue(new Error('Network error'))
    render(<PlaceBrowser selectedIds={[]} onToggle={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Không có địa điểm nào')).toBeInTheDocument())
  })
})
