// components/AuthScreen.jsx
// The signed-out gate. One screen, two modes (Sign in / Create account)
// toggled by a tab. On signup we surface Supabase's "check your email"
// message inline rather than redirecting anywhere.

import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { track } from '../lib/posthog.js'

// Supabase deliberately returns one generic "Invalid login credentials"
// error for both an unregistered email and a wrong password (this is
// anti-enumeration behaviour), so we can't split no_account from
// wrong_password here — they share the 'invalid_credentials' reason.
// We still tag the cases we *can* tell apart so login_failed stays
// segmentable in PostHog.
const loginFailureReason = (error) => {
  const code = error?.code
  const msg = (error?.message || '').toLowerCase()
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) {
    return 'email_not_confirmed'
  }
  if (
    error?.status === 429 ||
    code === 'over_request_rate_limit' ||
    msg.includes('rate limit')
  ) {
    return 'rate_limited'
  }
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'invalid_credentials'
  }
  return 'unknown'
}

export default function AuthScreen() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('signup') // 'signin' | 'signup'
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
          track('signup_failed', { error_message: error.message })
        } else if (data?.user && !data.session) {
          // Supabase requires email confirmation by default.
          setInfo('Check your email to confirm your account, then sign in.')
          setMode('signin')
          track('signup_confirmation_sent', { user_id: data.user.id })
        }
      } else {
        const { error } = await signIn(email.trim(), password)
        if (error) {
          setError(error.message)
          track('login_failed', {
            error_message: error.message,
            reason: loginFailureReason(error),
          })
        }
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

          <p className="pw-auth-switch">
            {mode === 'signup' ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin')
                    setError(null)
                    setInfo(null)
                  }}
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                New to Stashly?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup')
                    setError(null)
                    setInfo(null)
                  }}
                >
                  Create account
                </button>
              </>
            )}
          </p>

          <p className="pw-hint pw-auth-hint">
            By continuing you agree to keep your gift card data in your private
            Stashly account. We never sell your data.
          </p>
        </form>
      </div>
    </div>
  )
}
