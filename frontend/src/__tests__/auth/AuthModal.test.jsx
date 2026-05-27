import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AuthModal from '../../components/auth/AuthModal'

vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
    },
  },
}))

import { supabase } from '../../lib/supabase'

describe('AuthModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders Đăng nhập form by default', () => {
    render(<AuthModal onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /đăng nhập/i })).toBeInTheDocument()
  })

  it('renders email and password inputs', () => {
    render(<AuthModal onClose={vi.fn()} />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Mật khẩu')).toBeInTheDocument()
  })

  it('calls onClose when Close button (×) is clicked', () => {
    const onClose = vi.fn()
    render(<AuthModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when "Tiếp tục không đăng nhập" is clicked', () => {
    const onClose = vi.fn()
    render(<AuthModal onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /tiếp tục không đăng nhập/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('toggles to Tạo tài khoản mode', () => {
    render(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByText(/chưa có tài khoản/i))
    expect(screen.getByRole('heading', { name: /tạo tài khoản/i })).toBeInTheDocument()
  })

  it('toggles back to Đăng nhập from Tạo tài khoản', () => {
    render(<AuthModal onClose={vi.fn()} />)
    fireEvent.click(screen.getByText(/chưa có tài khoản/i))
    fireEvent.click(screen.getByText(/đã có tài khoản/i))
    expect(screen.getByRole('heading', { name: /đăng nhập/i })).toBeInTheDocument()
  })

  it('shows error message when sign in fails', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid credentials' } })
    render(<AuthModal onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@test.com' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials')
    )
  })

  it('does not call onClose when sign in fails', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid credentials' } })
    const onClose = vi.fn()
    render(<AuthModal onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@test.com' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))

    await waitFor(() => screen.getByRole('alert'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on successful sign in', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: null })
    const onClose = vi.fn()
    render(<AuthModal onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@test.com' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'secret123' } })
    fireEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('shows error when sign up fails', async () => {
    supabase.auth.signUp.mockResolvedValue({ error: { message: 'Email already in use' } })
    render(<AuthModal onClose={vi.fn()} />)

    fireEvent.click(screen.getByText(/chưa có tài khoản/i))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'existing@test.com' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'pass123' } })
    fireEvent.click(screen.getByRole('button', { name: /^tạo tài khoản$/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Email already in use')
    )
  })

  it('clears previous error when retrying successfully', async () => {
    supabase.auth.signInWithPassword
      .mockResolvedValueOnce({ error: { message: 'Invalid credentials' } })
      .mockResolvedValueOnce({ error: null })
    const onClose = vi.fn()
    render(<AuthModal onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u@test.com' } })
    fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))
    await waitFor(() => screen.getByRole('alert'))

    fireEvent.click(screen.getByRole('button', { name: /^đăng nhập$/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
