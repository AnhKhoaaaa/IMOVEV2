import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { User, LogOut } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useLang, useT } from '../../contexts/LanguageContext'
import AuthModal from '../auth/AuthModal'
import NavHeader from '../ui/nav-header'

export default function Header() {
  const navigate = useNavigate()
  const [showAuth, setShowAuth] = useState(false)
  const [user, setUser] = useState(null)
  const { lang, toggleLang } = useLang()
  const { t } = useT()
  const { pathname } = useLocation()
  const isHome = pathname === '/'
  const [navHidden, setNavHidden] = useState(false)
  const headerHidden = !isHome && navHidden

  // Trang chủ luôn hiện header (và không có nút toggle) — reset khi quay về '/'
  useEffect(() => { if (isHome) setNavHidden(false) }, [isHome])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }
  const displayName = user?.user_metadata?.username || user?.email?.split('@')[0]
  const handleLanguageSelect = (nextLang) => {
    if (lang !== nextLang) toggleLang()
  }
  const navItems = [
    { key: 'home', label: t('home'), to: '/' },
    ...(!user ? [{ key: 'sign-in', label: t('signIn'), onClick: () => setShowAuth(true) }] : []),
    { key: 'new-trip', label: t('newTrip'), to: '/plan' },
    { key: 'setting', label: t('setting'), to: '/settings' },
    {
      key: 'language',
      label: t('language'),
      menu: {
        options: [
          {
            label: 'English',
            value: 'en',
            selected: lang === 'en',
            onSelect: () => handleLanguageSelect('en'),
          },
          {
            label: 'Tiếng Việt',
            value: 'vi',
            selected: lang === 'vi',
            onSelect: () => handleLanguageSelect('vi'),
          },
        ],
      },
    },
  ]

  return (
    <>
      <header
        id="app-header"
        aria-hidden={headerHidden}
        inert={headerHidden ? '' : undefined}
        className={`sticky top-0 z-40 w-full transition-[transform,margin-bottom,opacity] duration-[420ms] ease-[cubic-bezier(.2,.7,.2,1)] motion-reduce:transition-none ${
          headerHidden ? '-translate-y-full -mb-14 opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <div className="relative mx-auto flex h-14 max-w-7xl items-center justify-center px-4 sm:px-6">

          {/* Logo */}
          <Link to="/" className="absolute left-4 flex items-center sm:left-6" aria-label="IMOVE home">
            <img
              src="/imove-logo-transparent.png"
              alt=""
              className="h-10 w-auto max-w-[190px] object-contain"
            />
            <span className="sr-only">IMOVE</span>
          </Link>

          <NavHeader items={navItems} className="hidden sm:block" />

          {/* Right side */}
          <div className="absolute right-4 flex items-center gap-2 sm:right-6">
            {user ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:block text-[13px] font-medium text-slate-700 max-w-[120px] truncate">
                  {displayName}
                </span>
                <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white text-[13px] font-bold select-none">
                  {displayName?.[0]?.toUpperCase() ?? <User className="h-4 w-4" />}
                </div>
                <button
                  onClick={handleLogout}
                  aria-label={t('signOut')}
                  className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                aria-label="Open account"
                title={t('signIn')}
                className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors sm:hidden"
              >
                <User className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Nút bật/tắt header — hiện ở mọi trang trừ trang chủ.
          Đang hiện → ↑ (nhấn để ẩn, header trượt lên); đang ẩn → ↓ (nhấn để hiện lại). */}
      {!isHome && (
        <button
          type="button"
          onClick={() => setNavHidden((v) => !v)}
          aria-controls="app-header"
          aria-expanded={!headerHidden}
          aria-label={headerHidden ? t('showNav') : t('hideNav')}
          title={headerHidden ? t('showNav') : t('hideNav')}
          className={`nav-toggle fixed right-4 z-30 grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-[0_12px_28px_rgba(15,23,42,0.12)] hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 sm:right-6 ${
            headerHidden ? 'top-3' : 'top-[66px]'
          }`}
        >
          <span aria-hidden="true" className="font-display text-[18px] font-bold leading-none">
            {headerHidden ? '↓' : '↑'}
          </span>
        </button>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  )
}
