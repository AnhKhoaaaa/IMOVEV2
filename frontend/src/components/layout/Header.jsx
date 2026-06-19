import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { User, LogOut } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useLang, useT, tFor } from '../../contexts/LanguageContext'
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
  const [peek, setPeek] = useState(false) // nút toggle ẩn mặc định, chỉ hiện khi con trỏ lại gần đỉnh
  const headerHidden = !isHome && navHidden

  // Trang chủ luôn hiện header (và không có nút toggle) — reset khi quay về '/'
  useEffect(() => { if (isHome) setNavHidden(false) }, [isHome])

  // Hiện tab toggle khi con trỏ lại gần đỉnh trang (gần header); ẩn khi rời xa.
  useEffect(() => {
    if (isHome) { setPeek(false); return }
    const onMove = (e) => setPeek(e.clientY < 96)
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [isHome])

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
  // Giữ bề rộng mỗi tab theo bản dài hơn giữa EN/VI để thanh nav không co giãn khi đổi ngôn ngữ.
  const altLang = lang === 'vi' ? 'en' : 'vi'
  const navItems = [
    { key: 'home', label: t('home'), labelAlt: tFor(altLang, 'home'), to: '/' },
    { key: 'new-trip', label: t('newTrip'), labelAlt: tFor(altLang, 'newTrip'), to: '/plan' },
    { key: 'setting', label: t('setting'), labelAlt: tFor(altLang, 'setting'), to: '/settings' },
    {
      key: 'language',
      label: t('language'),
      labelAlt: tFor(altLang, 'language'),
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
              /* Sign In — pill ở góc phải ngoài cùng, đồng bộ vị trí với tên/avatar khi đã đăng nhập.
                 Dùng đúng class của nav tab (NavHeader) để khớp kích thước & kiểu dáng thanh giữa. */
              <button
                type="button"
                onClick={() => setShowAuth(true)}
                aria-label={t('signIn')}
                className="group rounded-full bg-white p-1 shadow-[0_12px_28px_rgba(15,23,42,0.12)]"
              >
                <span className="relative block rounded-full px-3 py-1.5 text-xs font-semibold md:px-5 md:py-3 md:text-sm">
                  {/* Nền pill xanh da trời — tái hiện cursor bg-blue-400 của NavHeader,
                      hiện mượt (fade + scale) khi hover / focus bàn phím / nhấp. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 z-0 origin-center scale-95 rounded-full bg-blue-400 opacity-0 transition-all duration-300 ease-[cubic-bezier(.2,.7,.2,1)] group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100 group-active:scale-100 group-active:opacity-100"
                  />
                  <span className="relative z-10 text-slate-900 transition-colors duration-200 group-hover:text-white group-focus-visible:text-white group-active:text-white">
                    {t('signIn')}
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Nút bật/tắt header — "tab" giữa đỉnh, ẩn mặc định, chỉ hiện khi con trỏ lại gần header.
          Đặt ở giữa để KHÔNG che cụm nút góc phải (gear "Edit setup") của Trip/Planner.
          Đang hiện → ↑ (nhấn để ẩn header); đang ẩn → ↓ (nhấn để hiện lại). */}
      {!isHome && (
        <div
          className={`fixed left-1/2 z-30 -translate-x-1/2 transition-[top,opacity] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] focus-within:pointer-events-auto focus-within:opacity-100 ${
            peek ? 'opacity-100' : 'pointer-events-none opacity-0'
          } ${headerHidden ? 'top-2' : 'top-[58px]'}`}
        >
          <button
            type="button"
            onClick={() => setNavHidden((v) => !v)}
            aria-controls="app-header"
            aria-expanded={!headerHidden}
            aria-label={headerHidden ? t('showNav') : t('hideNav')}
            title={headerHidden ? t('showNav') : t('hideNav')}
            className="nav-toggle grid h-7 w-16 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-[0_12px_28px_rgba(15,23,42,0.12)] hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
          >
            <span aria-hidden="true" className="font-display text-[16px] font-bold leading-none">
              {headerHidden ? '↓' : '↑'}
            </span>
          </button>
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  )
}
