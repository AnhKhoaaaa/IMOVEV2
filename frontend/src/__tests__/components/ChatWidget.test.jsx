import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChatWidget from '../../components/chat/ChatWidget'

// useLocation drives the active trip id from the path (/trip/:id).
let mockPath = '/trip/trip-1'
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useLocation: () => ({ pathname: mockPath }) }
})

vi.mock('../../contexts/LanguageContext', () => ({
  useT: () => ({ t: (k, ...a) => (a.length ? `${k}:${a.join(',')}` : k), lang: 'en' }),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ user: { id: 'u1' } })) }))
vi.mock('../../hooks/useGeolocation', () => ({ useGeolocation: () => ({ position: null }) }))
vi.mock('../../hooks/useAlerts', () => ({ useAlerts: vi.fn(() => ({ alerts: [] })) }))
vi.mock('../../services/api', () => ({
  api: { phraseAlert: vi.fn(), sendChat: vi.fn(), confirmChatAction: vi.fn() },
}))

import { useAuth } from '../../contexts/AuthContext'
import { useAlerts } from '../../hooks/useAlerts'
import { api } from '../../services/api'

const alert1 = { id: 'al-1', alert_type: 'weather_warning', message: '70% rain', day_number: 2 }

beforeEach(() => {
  vi.clearAllMocks()
  mockPath = '/trip/trip-1'
  useAuth.mockReturnValue({ user: { id: 'u1' } })
  useAlerts.mockReturnValue({ alerts: [] })
  localStorage.clear()
})

describe('ChatWidget proactive alerts (dev25 P1)', () => {
  it('phrases a new alert and posts it as an assistant bubble with an unread badge', async () => {
    api.phraseAlert.mockResolvedValue({ text: 'Heads up — rain near your Day 2 stop!', alert_id: 'al-1' })
    useAlerts.mockReturnValue({ alerts: [alert1] })

    render(<ChatWidget />)

    // The backend phrasing is called with the alert fields + language.
    await waitFor(() => expect(api.phraseAlert).toHaveBeenCalledTimes(1))
    expect(api.phraseAlert).toHaveBeenCalledWith({
      alert: { id: 'al-1', alert_type: 'weather_warning', message: '70% rain', day_number: 2 },
      lang: 'en',
    })

    // Closed FAB shows an unread badge.
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())

    // Opening the widget reveals the phrased message.
    fireEvent.click(screen.getByLabelText('chatOpen'))
    expect(screen.getByText('Heads up — rain near your Day 2 stop!')).toBeInTheDocument()
  })

  it('does not re-post the same alert across re-renders', async () => {
    api.phraseAlert.mockResolvedValue({ text: 'msg', alert_id: 'al-1' })
    useAlerts.mockReturnValue({ alerts: [alert1] })

    const { rerender } = render(<ChatWidget />)
    await waitFor(() => expect(api.phraseAlert).toHaveBeenCalledTimes(1))

    rerender(<ChatWidget />)
    rerender(<ChatWidget />)
    expect(api.phraseAlert).toHaveBeenCalledTimes(1)
  })

  it('guests see the locked FAB and never subscribe or phrase alerts', () => {
    useAuth.mockReturnValue({ user: null })
    render(<ChatWidget />)

    expect(screen.getByLabelText('chatOpen')).toBeInTheDocument()
    // useAlerts is called with a null trip id (no subscription) for guests.
    expect(useAlerts).toHaveBeenCalledWith(null, 'chat')
    expect(api.phraseAlert).not.toHaveBeenCalled()
  })
})
