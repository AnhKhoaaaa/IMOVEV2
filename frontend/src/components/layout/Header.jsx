import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Navigation2, User } from 'lucide-react'
import AuthModal from '../auth/AuthModal'

export default function Header() {
  const [showAuth, setShowAuth] = useState(false)

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
              New Trip
            </Link>
            <button
              onClick={() => setShowAuth(true)}
              aria-label="Account"
              className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors"
            >
              <User className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </>
  )
}
