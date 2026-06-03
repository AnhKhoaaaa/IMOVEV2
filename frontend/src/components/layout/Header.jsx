import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Navigation2, User, LogOut, Globe, Settings } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useLang, useT } from '../../contexts/LanguageContext'
import AuthModal from '../auth/AuthModal'

export default function Header() {
  const [showAuth, setShowAuth] = useState(false)
  const [user, setUser] = useState(null)
  const { lang, toggleLang } = useLang()
  const { t } = useT()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => { await supabase.auth.signOut() }
  const displayName = user?.user_metadata?.username || user?.email?.split('@')[0]

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-slate-100 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-500 shadow-card">
              <Navigation2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-display font-extrabold text-lg tracking-tight text-slate-900">
              IMOVE
            </span>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <Link
              to="/plan"
              className="hidden sm:inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
            >
              {t('newTrip')}
            </Link>
            <Link
              to="/settings"
              className="hidden sm:grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </Link>

            {/* Language toggle */}
            <button
              onClick={toggleLang}
              title={lang === 'en' ? 'Switch to Vietnamese' : 'Chuyển sang tiếng Anh'}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-slate-200 text-[12px] font-semibold text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors select-none"
            >
              <Globe className="h-3 w-3" />
              <span className={lang === 'en' ? 'text-indigo-600' : 'text-slate-400'}>EN</span>
              <span className="text-slate-300">/</span>
              <span className={lang === 'vi' ? 'text-indigo-600' : 'text-slate-400'}>VI</span>
            </button>

            {user ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:block text-[13px] font-medium text-slate-700 max-w-[120px] truncate">
                  {displayName}
                </span>
                <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white text-[13px] font-bold select-none">
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
                aria-label={t('signIn')}
                className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
              >
                <User className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  )
}
