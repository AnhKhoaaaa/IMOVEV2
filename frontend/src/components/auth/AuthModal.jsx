import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog'
import { Alert, AlertDescription } from '../ui/alert'

export default function AuthModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin')
  const [authError, setAuthError] = useState(null)
  const [loading, setLoading] = useState(false)
  const authUnavailable = !isSupabaseConfigured || !supabase
  const unavailableMessage = 'Sign-in is disabled because Supabase Auth is not configured for this environment.'

  const submit = async () => {
    setAuthError(null)
    if (authUnavailable) {
      setAuthError(unavailableMessage)
      return
    }
    setLoading(true)
    try {
      const { error } = mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
      if (error) { setAuthError(String(error.message)); return }
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'}</DialogTitle>
          <DialogDescription>
            {mode === 'signin'
              ? 'Lưu hành trình của bạn và truy cập mọi lúc'
              : 'Tạo tài khoản miễn phí để lưu hành trình'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {(authError || authUnavailable) && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{authError || unavailableMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Mật khẩu</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>

          <Button className="w-full" onClick={submit} disabled={loading || authUnavailable}>
            {loading ? 'Đang xử lý...' : mode === 'signin' ? 'Đăng nhập' : 'Tạo tài khoản'}
          </Button>

          <div className="text-center">
            <button
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setAuthError(null) }}
              className="text-sm text-sky-600 hover:text-sky-700 hover:underline transition-colors"
            >
              {mode === 'signin' ? 'Chưa có tài khoản? Tạo ngay' : 'Đã có tài khoản? Đăng nhập'}
            </button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-slate-400">hoặc</span>
            </div>
          </div>

          <Button variant="ghost" className="w-full text-slate-500" onClick={onClose}>
            Tiếp tục không đăng nhập
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
