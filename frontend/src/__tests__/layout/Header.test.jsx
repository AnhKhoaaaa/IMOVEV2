import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { LanguageProvider } from '../../contexts/LanguageContext'
import Header from '../../components/layout/Header'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('../../components/auth/AuthModal', () => ({
  default: ({ onClose }) => (
    <div data-testid="auth-modal">
      <button onClick={onClose}>Close modal</button>
    </div>
  ),
}))

const wrap = () => render(
  <BrowserRouter><LanguageProvider><Header /></LanguageProvider></BrowserRouter>
)

describe('Header', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })

  it('renders IMOVE logo', () => {
    wrap()
    expect(screen.getByText('IMOVE')).toBeInTheDocument()
  })

  it('renders language toggle with EN and VI', () => {
    wrap()
    expect(screen.getByText('EN')).toBeInTheDocument()
    expect(screen.getByText('VI')).toBeInTheDocument()
  })

  it('renders New Trip link', () => {
    wrap()
    expect(screen.getByText('New Trip')).toBeInTheDocument()
  })

  it('renders New Trip link in VI after toggle', () => {
    wrap()
    fireEvent.click(screen.getByTitle(/switch to vietnamese/i))
    expect(screen.getByText('Chuyến mới')).toBeInTheDocument()
  })

  it('AuthModal hidden by default', () => {
    wrap()
    expect(screen.queryByTestId('auth-modal')).not.toBeInTheDocument()
  })

  it('sign-in button opens AuthModal', () => {
    wrap()
    const signInBtn = screen.getByRole('button', { name: /sign in/i })
    fireEvent.click(signInBtn)
    expect(screen.getByTestId('auth-modal')).toBeInTheDocument()
  })

  it('closing AuthModal hides it', () => {
    wrap()
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    fireEvent.click(screen.getByRole('button', { name: /close modal/i }))
    expect(screen.queryByTestId('auth-modal')).not.toBeInTheDocument()
    expect(screen.getByText('IMOVE')).toBeInTheDocument()
  })
})
