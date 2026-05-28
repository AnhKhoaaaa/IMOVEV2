import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CitymapperTransitCard from '../../components/planner/CitymapperTransitCard'

const baseLeg = {
  id: 'leg-1',
  transport_mode: 'MRT',
  duration_minutes: 10,
  cost_sgd: 1.50,
  is_estimated: false,
  from_place_id: 'place-a',
  to_place_id: 'place-b',
  instructions: [],
  geometry: null,
}

describe('CitymapperTransitCard', () => {
  it('renders mode label and duration in header', () => {
    render(<CitymapperTransitCard leg={baseLeg} />)
    expect(screen.getByText(/MRT/)).toBeInTheDocument()
    expect(screen.getByText(/10 min/)).toBeInTheDocument()
  })

  it('renders cost when provided', () => {
    render(<CitymapperTransitCard leg={baseLeg} />)
    expect(screen.getByText(/S\$1\.50/)).toBeInTheDocument()
  })

  // Phase 0: instructions is [] → step section hidden, no expand chevron
  it('hides step section when instructions is empty', () => {
    render(<CitymapperTransitCard leg={{ ...baseLeg, instructions: [] }} />)
    expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument()
    // Step content should not be visible
    expect(screen.queryByText(/Walk to MRT/i)).not.toBeInTheDocument()
  })

  it('hides step section when instructions is undefined', () => {
    const { instructions: _, ...legNoInstructions } = baseLeg
    render(<CitymapperTransitCard leg={legNoInstructions} />)
    expect(screen.queryByText(/Walk to MRT/i)).not.toBeInTheDocument()
  })

  // Phase 2: instructions has items → step section visible
  it('shows step-by-step section when instructions has items', () => {
    const leg = {
      ...baseLeg,
      instructions: [
        'Walk 3 min to City Hall MRT',
        'Board EW Line towards Pasir Ris',
        'Alight at Raffles Place · Exit C',
      ],
    }
    render(<CitymapperTransitCard leg={leg} />)
    // Click the header to expand
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('Walk 3 min to City Hall MRT')).toBeInTheDocument()
    expect(screen.getByText('Board EW Line towards Pasir Ris')).toBeInTheDocument()
    expect(screen.getByText('Alight at Raffles Place · Exit C')).toBeInTheDocument()
  })

  it('shows estimated badge when is_estimated is true', () => {
    const leg = {
      ...baseLeg,
      is_estimated: true,
      instructions: ['Step 1'],
    }
    render(<CitymapperTransitCard leg={leg} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/estimated/i)).toBeInTheDocument()
  })
})
