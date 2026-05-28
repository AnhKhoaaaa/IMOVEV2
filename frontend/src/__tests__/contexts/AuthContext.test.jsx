import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../../contexts/AuthContext'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  },
}))

import { supabase } from '../../lib/supabase'

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>

describe('AuthContext', () => {
  const unsub = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    supabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: unsub } },
    })
  })

  it('user is null before session resolves', () => {
    supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(useAuth, { wrapper })
    expect(result.current.user).toBeNull()
  })

  it('sets user from resolved session', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 'a@b.com' } } },
    })
    const { result } = renderHook(useAuth, { wrapper })
    await waitFor(() => expect(result.current.user?.id).toBe('user-1'))
  })

  it('user is null when session is empty', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    const { result } = renderHook(useAuth, { wrapper })
    await waitFor(() => {
      expect(supabase.auth.getSession).toHaveBeenCalled()
    })
    expect(result.current.user).toBeNull()
  })

  it('updates user on SIGNED_IN auth state change', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })
    let authCallback
    supabase.auth.onAuthStateChange.mockImplementation((cb) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: unsub } } }
    })
    const { result } = renderHook(useAuth, { wrapper })
    act(() => authCallback('SIGNED_IN', { user: { id: 'user-2', email: 'b@c.com' } }))
    await waitFor(() => expect(result.current.user?.id).toBe('user-2'))
  })

  it('sets user to null on SIGNED_OUT', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
    })
    let authCallback
    supabase.auth.onAuthStateChange.mockImplementation((cb) => {
      authCallback = cb
      return { data: { subscription: { unsubscribe: unsub } } }
    })
    const { result } = renderHook(useAuth, { wrapper })
    await waitFor(() => expect(result.current.user?.id).toBe('user-1'))
    act(() => authCallback('SIGNED_OUT', null))
    await waitFor(() => expect(result.current.user).toBeNull())
  })

  it('unsubscribes on unmount', () => {
    supabase.auth.getSession.mockReturnValue(new Promise(() => {}))
    const { unmount } = renderHook(useAuth, { wrapper })
    unmount()
    expect(unsub).toHaveBeenCalled()
  })
})
