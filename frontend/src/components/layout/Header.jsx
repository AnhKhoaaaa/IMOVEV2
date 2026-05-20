import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { MapPin, Menu, X } from 'lucide-react'
import { Button } from '../ui/button'
import AuthModal from '../auth/AuthModal'

export default function Header() {
  const [showAuth, setShowAuth] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 font-bold text-xl text-slate-900 hover:text-sky-600 transition-colors">
            <MapPin className="h-5 w-5 text-sky-500" />
            IMOVE
          </Link>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-4">
            <Link
              to="/plan"
              className={`text-sm font-medium transition-colors hover:text-sky-600 ${location.pathname === '/plan' ? 'text-sky-600' : 'text-slate-600'}`}
            >
              Lập kế hoạch
            </Link>
            <Button variant="outline" size="sm" onClick={() => setShowAuth(true)}>
              Đăng nhập
            </Button>
          </nav>

          {/* Mobile menu button */}
          <button
            className="sm:hidden p-2 text-slate-500 hover:text-slate-900"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? 'Đóng menu' : 'Mở menu'}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <div className="sm:hidden border-t border-slate-100 bg-white px-4 pb-4 pt-2 space-y-2">
            <Link
              to="/plan"
              className="block py-2 text-sm font-medium text-slate-700 hover:text-sky-600"
              onClick={() => setMobileOpen(false)}
            >
              Lập kế hoạch
            </Link>
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setShowAuth(true); setMobileOpen(false) }}>
              Đăng nhập
            </Button>
          </div>
        )}
      </header>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  )
}
