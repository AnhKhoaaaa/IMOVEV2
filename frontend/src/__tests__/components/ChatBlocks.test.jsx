import { describe, it, expect } from 'vitest'
import { render as tlRender, screen } from '@testing-library/react'
import ChatBlocks from '../../components/chat/ChatBlocks'
import { LanguageProvider } from '../../contexts/LanguageContext'

// dev25 P3 — rich multi-block chat answers. Card data is real (from backend/dataset); these
// tests pin per-type rendering, markdown, and the unknown-type guard.

const render = (ui) => tlRender(ui, { wrapper: LanguageProvider })

describe('ChatBlocks', () => {
  it('renders a place_card with a real image and details', () => {
    render(<ChatBlocks blocks={[{
      type: 'place_card', id: 'p1', name: 'Gardens by the Bay',
      category: 'NATURE_PARK', image_url: 'https://img/g.jpg', suggested_duration_minutes: 90,
    }]} />)
    const img = screen.getByRole('img', { name: 'Gardens by the Bay' })
    expect(img).toHaveAttribute('src', 'https://img/g.jpg')
    expect(screen.getByText('Gardens by the Bay')).toBeInTheDocument()
    expect(screen.getByText('90 min')).toBeInTheDocument()
  })

  it('renders markdown bold + list in a text block', () => {
    render(<ChatBlocks blocks={[{ type: 'text', markdown: '**Tip** here\n\n- one\n- two' }]} />)
    expect(screen.getByText('Tip')).toBeInTheDocument()
    expect(screen.getByText('one')).toBeInTheDocument()
    expect(screen.getByText('two')).toBeInTheDocument()
  })

  it('does not render raw HTML (no rehype-raw)', () => {
    render(<ChatBlocks blocks={[{ type: 'text', markdown: 'safe <script>alert(1)</script> text' }]} />)
    // The script tag is escaped/stripped — no <script> element is injected.
    expect(document.querySelector('script')).toBeNull()
  })

  it('renders a route_compare block with modes and fares', () => {
    render(<ChatBlocks blocks={[{
      type: 'route_compare',
      options: [
        { mode: 'TRANSIT', duration_minutes: 22, fare_sgd: 1.5 },
        { mode: 'CYCLE', duration_minutes: 18, fare_sgd: 0 },
      ],
    }]} />)
    expect(screen.getByText('Transit')).toBeInTheDocument()
    expect(screen.getByText('S$1.50')).toBeInTheDocument()
    expect(screen.getByText('Cycle')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
  })

  it('renders a bus_arrivals block with ETAs', () => {
    render(<ChatBlocks blocks={[{
      type: 'bus_arrivals', stop_code: '83139',
      services: [{ service_no: '14', eta_min: 3 }, { service_no: '16', eta_min: 1 }],
    }]} />)
    expect(screen.getByText('Bus stop 83139')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('3 min')).toBeInTheDocument()
    // eta <= 1 shows the "Arriving" label.
    expect(screen.getByText('Arriving')).toBeInTheDocument()
  })

  it('ignores unknown block types', () => {
    const { container } = render(<ChatBlocks blocks={[{ type: 'mystery', foo: 1 }]} />)
    expect(container.textContent).toBe('')
  })
})
