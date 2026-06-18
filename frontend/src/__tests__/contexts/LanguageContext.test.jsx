import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { LanguageProvider, useLang, useT } from '../../contexts/LanguageContext'

const wrapper = ({ children }) => <LanguageProvider>{children}</LanguageProvider>

// Merges both hooks in the same provider instance
const useAll = () => ({ ...useLang(), ...useT() })

describe('LanguageContext', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to EN', () => {
    const { result } = renderHook(useAll, { wrapper })
    expect(result.current.lang).toBe('en')
    expect(result.current.t('signIn')).toBe('Sign In')
    expect(result.current.t('newTrip')).toBe('New Trip')
  })

  it('switches to VI on toggle', () => {
    const { result } = renderHook(useAll, { wrapper })
    act(() => result.current.toggleLang())
    expect(result.current.lang).toBe('vi')
    expect(result.current.t('signIn')).toBe('Đăng nhập')
    expect(result.current.t('newTrip')).toBe('Chuyến mới')
  })

  it('toggles back to EN', () => {
    const { result } = renderHook(useAll, { wrapper })
    act(() => result.current.toggleLang())
    act(() => result.current.toggleLang())
    expect(result.current.lang).toBe('en')
    expect(result.current.t('signIn')).toBe('Sign In')
  })

  it('handles function translations with args', () => {
    const { result } = renderHook(useT, { wrapper })
    expect(result.current.t('welcomeUser', 'Khoa')).toBe('Welcome back, Khoa!')
    expect(result.current.t('tripsCount', 1)).toBe('1 trip saved')
    expect(result.current.t('tripsCount', 3)).toBe('3 trips saved')
    expect(result.current.t('noResults', 'café')).toBe('No places found for "café"')
    expect(result.current.t('checkEmailDesc', 'u@x.com')).toContain('u@x.com')
  })

  it('returns key for unknown translation', () => {
    const { result } = renderHook(useT, { wrapper })
    expect(result.current.t('nonexistent_key_xyz')).toBe('nonexistent_key_xyz')
  })

  it('persists lang choice in localStorage', () => {
    const { result } = renderHook(useLang, { wrapper })
    act(() => result.current.toggleLang())
    expect(localStorage.getItem('imove_lang')).toBe('vi')
    act(() => result.current.toggleLang())
    expect(localStorage.getItem('imove_lang')).toBe('en')
  })

  it('reads initial lang from localStorage', () => {
    localStorage.setItem('imove_lang', 'vi')
    const { result } = renderHook(useT, { wrapper })
    expect(result.current.t('signIn')).toBe('Đăng nhập')
    expect(result.current.t('addBtn')).toBe('Thêm')
  })

  it('transport labels translate correctly', () => {
    const { result } = renderHook(useAll, { wrapper })
    expect(result.current.t('transport_walk')).toBe('Walk')
    expect(result.current.t('transport_bus')).toBe('Bus')
    expect(result.current.t('transport_mrt')).toBe('MRT')
    act(() => result.current.toggleLang())
    expect(result.current.t('transport_walk')).toBe('Đi bộ')
    expect(result.current.t('transport_bus')).toBe('Xe buýt')
  })

  it('newly added keys exist (statusToday, or, flexibleDates)', () => {
    const { result } = renderHook(useAll, { wrapper })
    expect(result.current.t('statusToday')).toBe('Happening Today')
    expect(result.current.t('or')).toBe('or')
    expect(result.current.t('flexibleDates')).toBe('Flexible dates')
    act(() => result.current.toggleLang())
    expect(result.current.t('statusToday')).toBe('Đang diễn ra')
    expect(result.current.t('or')).toBe('hoặc')
    expect(result.current.t('flexibleDates')).toBe('Ngày linh hoạt')
  })
})
