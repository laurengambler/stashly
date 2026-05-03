// components/AuthScreen.jsx
// The signed-out gate. One screen, two modes (Sign in / Create account)
// toggled by a tab. On signup we surface Supabase's "check your email"
// message inline rather than redirecting anywhere.

import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'

export default function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'signup') {
        const { data, error } = await signUp(email.trim(), password)
        if (error) {
          setError(error.message)
        } else if (data?.user && !data.session) {
          // Supabase requires email confirmation by default.
          setInfo('Check your email to confirm your account, then sign in.')
          setMode('signin')
        }
      } else {
        const { error } = await signIn(email.trim(), password)
        if (error) setError(error.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pw-auth-screen">
      <div className="pw-auth-shell">
        <div className="pw-auth-brand">
          <div className="pw-auth-logo" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="14" rx="3" />
              <path d="M2 11h20" />
              <path d="M7 16h3" />
            </svg>
          </div>
          <h1 className="pw-auth-title">Stashly</h1>
          <p className="pw-auth-tagline">
            Save every gift card in one premium, private wallet.
          </p>
        </div>

        <div className="pw-auth-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'signin'}
            className={'pw-auth-tab' + (mode === 'signin' ? ' active' : '')}
            onClick={() => {
              setMode('signin')
              setError(null)
              setInfo(null)
            }}
            type="button"
          >
            Sign in
          </button>
          <button
            role="tab"
            aria-selected={mode === 'signup'}
            className={'pw-auth-tab' + (mode === 'signup' ? ' active' : '')}
            onClick={() => {
              setMode('signup')
              setError(null)
              setInfo(null)
            }}
            type="button"
          >
            Create account
          </button>
        </div>

        <form className="pw-auth-form" onSubmit={submit}>
          <div className="pw-group">
            <div className="pw-field">
              <label>Email</label>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="pw-field">
              <label>Password</label>
              <input
                type="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                minLength={6}
                required
              />
            </div>
          </div>

          {error && <p className="pw-error">{error}</p>}
          {info && <p className="pw-auth-info">{info}</p>}

          <button type="submit" className="pw-empty-cta pw-auth-cta" disabled={busy}>
            {busy
              ? 'Just a moment…'
              : mode === 'signup'
              ? 'Create account'
              : 'Sign in'}
          </button>

          <p className="pw-hint pw-auth-hint">
            By continuing you agree to keep your gift card data in your private
            Stashly account. We never sell your data.
          </p>
        </form>
      </div>
    </div>
  )
}
