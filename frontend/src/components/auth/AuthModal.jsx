import { useState } from 'react'
import { AlertCircle, CheckCircle2, UserCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useT } from '../../contexts/LanguageContext'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'
import { Alert, AlertDescription } from '../ui/alert'

export default function AuthModal({ onClose }) {
  const { t } = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [mode, setMode] = useState('signin')
  const [signinTab, setSigninTab] = useState('password')
  const [authError, setAuthError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const redirectTo = window.location.origin

  const submit = async () => {
    setAuthError(null)
    setLoading(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username: username.trim() || email.split('@')[0] },
            emailRedirectTo: redirectTo,
          },
        })
        if (error) { setAuthError(String(error.message)); return }
        if (!data.session) { setEmailSent(true) } else { onClose() }
      } else if (signinTab === 'magic_link') {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: redirectTo },
        })
        if (error) { setAuthError(String(error.message)); return }
        setEmailSent(true)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) { setAuthError(String(error.message)); return }
        onClose()
      }
    } finally {
      setLoading(false)
    }
  }

  const signInWithGoogle = async () => {
    setAuthError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    // Surface config errors (e.g. provider not enabled) instead of failing silently.
    if (error) setAuthError(String(error.message))
  }

  const switchMode = () => {
    setMode(mode === 'signin' ? 'signup' : 'signin')
    setAuthError(null)
    setEmailSent(false)
    setEmail('')
    setPassword('')
    setUsername('')
  }

  const switchSigninTab = (tab) => {
    setSigninTab(tab)
    setAuthError(null)
  }

  if (emailSent) {
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="sm:max-w-sm">
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 border border-emerald-200">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-display font-bold text-[18px] text-slate-900">{t('checkEmailTitle')}</h3>
              <p className="text-[13.5px] text-slate-500 leading-relaxed">{t('checkEmailDesc', email)}</p>
            </div>
            <Button className="w-full" onClick={onClose}>{t('closeBtn')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const isSignup = mode === 'signup'
  const isMagicLink = !isSignup && signinTab === 'magic_link'

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          {isSignup && (
            <div className="flex justify-center mb-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-600 text-white shadow-card">
                <UserCircle2 size={22} />
              </div>
            </div>
          )}
          <DialogTitle className={cn(isSignup && 'text-center')}>
            {isSignup ? t('signUpTitle') : t('signInTitle')}
          </DialogTitle>
          <DialogDescription className={cn(isSignup && 'text-center')}>
            {isSignup ? t('signUpDesc') : t('signInDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {authError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          )}

          {/* Sign-in tab switcher */}
          {!isSignup && (
            <div className="flex rounded-lg bg-slate-100 p-1">
              <button
                onClick={() => switchSigninTab('password')}
                className={cn(
                  'flex-1 py-1.5 text-sm font-medium rounded-md transition-all',
                  signinTab === 'password'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {t('passwordTab')}
              </button>
              <button
                onClick={() => switchSigninTab('magic_link')}
                className={cn(
                  'flex-1 py-1.5 text-sm font-medium rounded-md transition-all',
                  signinTab === 'magic_link'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {t('magicLinkTab')}
              </button>
            </div>
          )}

          {/* Display name — signup only */}
          {isSignup && (
            <div className="space-y-1.5">
              <Label htmlFor="username">{t('displayNameLabel')}</Label>
              <Input
                id="username"
                type="text"
                placeholder={t('displayNamePlaceholder')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}

          {/* Email field */}
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('emailLabel')}</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isMagicLink && submit()}
            />
          </div>

          {/* Password field — hidden in magic link tab */}
          {!isMagicLink && (
            <div className="space-y-1.5">
              <Label htmlFor="password">
                {t('passwordLabel')}
                {isSignup && <span className="ml-1 text-[11px] text-slate-400 font-normal">{t('passwordHint')}</span>}
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            </div>
          )}

          <Button
            className={cn(
              'w-full',
              isSignup && 'bg-blue-600 hover:bg-blue-700 border-0 text-white'
            )}
            onClick={submit}
            disabled={loading}
          >
            {loading
              ? t('processingBtn')
              : isSignup
              ? t('createAccountBtn')
              : isMagicLink
              ? t('sendMagicLinkBtn')
              : t('signInBtn')}
          </Button>

          <div className="text-center">
            <button
              onClick={switchMode}
              className="text-sm text-sky-600 hover:text-sky-700 hover:underline transition-colors"
            >
              {isSignup ? t('alreadyAccount') : t('noAccount')}
            </button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-slate-400">{t('or')}</span>
            </div>
          </div>

          <Button variant="outline" className="w-full" onClick={signInWithGoogle}>
            {t('signInWithGoogle')}
          </Button>

          <Button variant="ghost" className="w-full text-slate-500" onClick={onClose}>
            {t('continueWithout')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
