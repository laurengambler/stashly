// components/AuthScreen.jsx
// The signed-out gate, redesigned to the Stashly brand.
//   • Sign in with Apple is the prominent primary path (no password, no
//     confirmation email). Native flow is wired in the Apple phase; until
//     then it degrades to a friendly message.
//   • Email + password is the secondary path, kept for existing users,
//     with warm error copy, iOS keychain autofill, and a reset flow.
// All error copy runs through friendlyAuthError — the UI never shows a
// raw code or a Supabase message.

import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { track } from '../lib/posthog.js'
import { friendlyAuthError } from '../lib/authErrors.js'

// Supabase returns one generic "invalid credentials" for both an unknown
// email and a wrong password (anti-enumeration), so login_failed still
// can't split those two — we tag what we can for the funnel.
const loginFailureReason = (error) => {
  const code = error?.code
  const msg = (error?.message || '').toLowerCase()
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'email_not_confirmed'
  if (error?.status === 429 || code === 'over_request_rate_limit' || msg.includes('rate limit')) return 'rate_limited'
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'invalid_credentials'
  return 'unknown'
}

function AppleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16.365 1.43c0 1.14-.417 2.2-1.24 3.02-.99.98-2.18 1.55-3.36 1.46-.03-1.12.41-2.2 1.19-3.01.85-.86 2.15-1.5 3.29-1.55.02.03.12.06.12.08zM20.9 17.02c-.58 1.34-.86 1.93-1.6 3.11-1.04 1.64-2.5 3.68-4.32 3.7-1.61.02-2.03-1.05-4.22-1.04-2.19.01-2.65 1.06-4.27 1.05-1.81-.02-3.2-1.86-4.24-3.5-2.9-4.6-3.2-9.99-1.41-12.86 1.27-2.04 3.27-3.23 5.15-3.23 1.92 0 3.13 1.05 4.72 1.05 1.54 0 2.48-1.05 4.7-1.05 1.68 0 3.46.92 4.72 2.5-4.15 2.27-3.47 8.2.97 10.22z" />
    </svg>
  )
}

export default function AuthScreen() {
  const { signIn, signUp, resetPassword, signInWithApple } = useAuth()
  const [view, setView] = useState('main') // 'main' | 'reset'
  const [mode, setMode] = useState('signin') // email section: 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [resetSent, setResetSent] = useState(false)

  const clearMsgs = () => { setError(null); setInfo(null) }

  const handleApple = async () => {
    setBusy(true); clearMsgs()
    try {
      const { error } = await signInWithApple()
      if (error) {
        const friendly = friendlyAuthError(error, mode)
        if (friendly) setError(friendly) // null = user cancelled, stay quiet
      }
      // Success navigates automatically via the auth state listener.
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setBusy(true); clearMsgs()
    try {
      if (mode === 'signup') {
        const { data, error } = await signUp(email.trim(), password)
        if (error) {
          setError(friendlyAuthError(error, 'signup'))
          track('signup_failed', { error_message: error.message })
        } else if (data?.user && !data.session) {
          setInfo('Almost there — tap the link in the email we just sent to finish setting up.')
          setMode('signin')
          track('signup_confirmation_sent', { user_id: data.user.id })
        }
      } else {
        const { error } = await signIn(email.trim(), password)
        if (error) {
          setError(friendlyAuthError(error, 'signin'))
          track('login_failed', { error_message: error.message, reason: loginFailureReason(error) })
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const sendReset = async (e) => {
    e.preventDefault()
    if (!email.trim()) { setError('Enter your email above first.'); return }
    setBusy(true); setError(null)
    try {
      const { error } = await resetPassword(email.trim())
      if (error) {
        setError(friendlyAuthError(error, 'signin'))
      } else {
        setResetSent(true)
        track('password_reset_requested')
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
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="14" rx="3" />
              <path d="M2 11h20" />
              <path d="M7 16h3" />
            </svg>
          </div>
          <h1 className="pw-auth-headline">
            Never lose a gift card <em>again</em>.
          </h1>
          <p className="pw-auth-sub">Your premium, private gift-card wallet.</p>
        </div>

        {view === 'reset' ? (
          <form className="pw-auth-form" onSubmit={sendReset}>
            {resetSent ? (
              <>
                <p className="pw-auth-info">
                  Check your inbox — if an account exists for{' '}
                  <strong>{email.trim()}</strong>, a reset link is on its way.
                </p>
                <button
                  type="button"
                  className="pw-auth-cta pw-auth-cta-secondary"
                  onClick={() => { setView('main'); setResetSent(false); clearMsgs() }}
                >
                  Back to sign in
                </button>
              </>
            ) : (
              <>
                <p className="pw-auth-reset-lead">
                  Enter your email and we'll send you a link to set a new password.
                </p>
                <div className="pw-field pw-auth-field">
                  <label htmlFor="reset-email">Email</label>
                  <input
                    id="reset-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </div>
                {error && <p className="pw-auth-error">{error}</p>}
                <button type="submit" className="pw-auth-cta pw-auth-cta-primary" disabled={busy}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
                <button
                  type="button"
                  className="pw-auth-textlink"
                  onClick={() => { setView('main'); clearMsgs() }}
                >
                  Back to sign in
                </button>
              </>
            )}
          </form>
        ) : (
          <>
            {/* Primary path — Sign in with Apple. */}
            <button
              type="button"
              className="pw-apple-btn"
              onClick={handleApple}
              disabled={busy}
            >
              <AppleMark />
              <span>Continue with Apple</span>
            </button>

            <div className="pw-auth-divider"><span>or use email</span></div>

            <form className="pw-auth-form" onSubmit={submit}>
              <div className="pw-field pw-auth-field">
                <label htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="pw-field pw-auth-field">
                <label htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  name="password"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                  minLength={6}
                  required
                />
              </div>

              {error && <p className="pw-auth-error">{error}</p>}
              {info && <p className="pw-auth-info">{info}</p>}

              <button type="submit" className="pw-auth-cta pw-auth-cta-primary" disabled={busy}>
                {busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>

              {mode === 'signin' && (
                <button
                  type="button"
                  className="pw-auth-textlink"
                  onClick={() => { setView('reset'); setResetSent(false); clearMsgs() }}
                >
                  Forgot password?
                </button>
              )}

              <p className="pw-auth-switch">
                {mode === 'signup' ? (
                  <>
                    Already have an account?{' '}
                    <button type="button" onClick={() => { setMode('signin'); clearMsgs() }}>Sign in</button>
                  </>
                ) : (
                  <>
                    New to Stashly?{' '}
                    <button type="button" onClick={() => { setMode('signup'); clearMsgs() }}>Create account</button>
                  </>
                )}
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
