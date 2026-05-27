import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Header from '../../components/layout/Header'

vi.mock('../../components/auth/AuthModal', () => ({
  default: ({ onClose }) => (
    <div data-testid="auth-modal">
      <button onClick={onClose}>Close modal</button>
    </div>
  ),
}))

const renderHeader = () => render(<BrowserRouter><Header /></BrowserRouter>)

describe('Header', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders IMOVE logo and New Trip link', () => {
    renderHeader()
    expect(screen.getByRole('link', { name: /IMOVE/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /New Trip/i })).toHaveAttribute('href', '/plan')
  })

  it('renders Account button', () => {
    renderHeader()
    expect(screen.getByRole('button', { name: /Account/i })).toBeInTheDocument()
  })

  it('AuthModal is not shown by default', () => {
    renderHeader()
    expect(screen.queryByTestId('auth-modal')).not.toBeInTheDocument()
  })

  it('clicking Account opens AuthModal', () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /Account/i }))
    expect(screen.getByTestId('auth-modal')).toBeInTheDocument()
  })

  it('closing AuthModal hides it without navigating away', () => {
    renderHeader()
    fireEvent.click(screen.getByRole('button', { name: /Account/i }))
    expect(screen.getByTestId('auth-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close modal/i }))
    expect(screen.queryByTestId('auth-modal')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /IMOVE/i })).toBeInTheDocument()
  })
})
