import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function AuthModal({ onClose }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('signin')

  const submit = async () => {
    if (mode === 'signin') {
      await supabase.auth.signInWithPassword({ email, password })
    } else {
      await supabase.auth.signUp({ email, password })
    }
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', padding: 32, borderRadius: 12, minWidth: 320 }}>
        <h2>{mode === 'signin' ? 'Sign In' : 'Sign Up'}</h2>
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 8 }} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 16 }} />
        <button onClick={submit} style={{ width: '100%' }}>{mode === 'signin' ? 'Sign In' : 'Sign Up'}</button>
        <button onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer' }}>
          {mode === 'signin' ? 'No account? Sign up' : 'Have an account? Sign in'}
        </button>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer' }}>x</button>
      </div>
    </div>
  )
}
