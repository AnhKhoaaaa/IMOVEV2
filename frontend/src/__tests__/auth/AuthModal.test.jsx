import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LanguageProvider } from '../../contexts/LanguageContext'
import AuthModal from '../../components/auth/AuthModal'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signInWithOtp: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  },
}))

import { supabase } from '../../lib/supabase'

const wrap = (ui) => render(ui, { wrapper: LanguageProvider })

describe('AuthModal', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })

  it('renders sign-in form in English by default', () => {
    wrap(<AuthModal onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('renders sign-in form in Vietnamese when lang=vi', () => {
    localStorage.setItem('imove_lang', 'vi')
    wrap(<AuthModal onClose={vi.fn()} />)
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument()
  })

  it('closes on "Continue without signing in"', () => {
    const onClose = vi.fn()
    wrap(<AuthModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /continue without signing in/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('switches to sign-up mode with username field', () => {
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /don't have an account/i }))
    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Display name')).toBeInTheDocument()
  })

  it('switches back from sign-up to sign-in', () => {
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /don't have an account/i }))
    fireEvent.click(screen.getByRole('button', { name: /already have an account/i }))
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows error when sign in fails', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid credentials' } })
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@x.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials'))
  })

  it('calls onClose on successful sign in', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null })
    const onClose = vi.fn()
    wrap(<AuthModal onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u@x.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass' } })
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('shows email confirmation screen when signup needs email confirm', async () => {
    supabase.auth.signUp.mockResolvedValue({ data: { session: null }, error: null })
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /don't have an account/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@x.com' } })
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())
    expect(screen.getByText(/new@x\.com/)).toBeInTheDocument()
  })

  it('calls onClose when signup returns a session immediately', async () => {
    supabase.auth.signUp.mockResolvedValue({ data: { session: { user: {} } }, error: null })
    const onClose = vi.fn()
    wrap(<AuthModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /don't have an account/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u@x.com' } })
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('shows sign-up error message', async () => {
    supabase.auth.signUp.mockResolvedValue({ error: { message: 'Email already in use' } })
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /don't have an account/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dup@x.com' } })
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'pass' } })
    fireEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Email already in use'))
  })

  // ── Magic Link tab ──────────────────────────────────────────────────────────

  it('renders Password and Magic Link tab buttons', () => {
    wrap(<AuthModal onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^password$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^magic link$/i })).toBeInTheDocument()
  })

  it('switching to Magic Link tab hides password field and shows Send magic link button', () => {
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^magic link$/i }))
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send magic link/i })).toBeInTheDocument()
  })

  it('sends OTP on magic link submit and shows email-sent screen', async () => {
    supabase.auth.signInWithOtp.mockResolvedValue({ error: null })
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^magic link$/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ml@x.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }))
    await waitFor(() => expect(screen.getByText('Check your email')).toBeInTheDocument())
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'ml@x.com' })
  })

  it('shows error on magic link failure', async () => {
    supabase.auth.signInWithOtp.mockResolvedValue({ error: { message: 'Rate limit exceeded' } })
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^magic link$/i }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ml@x.com' } })
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Rate limit exceeded'))
  })

  // ── Google OAuth ────────────────────────────────────────────────────────────

  it('renders Google OAuth button', () => {
    wrap(<AuthModal onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('Google OAuth button calls signInWithOAuth', () => {
    supabase.auth.signInWithOAuth.mockResolvedValue({})
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }))
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  })

  it('Google OAuth button visible in sign-up mode too', () => {
    wrap(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /don't have an account/i }))
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })
})
