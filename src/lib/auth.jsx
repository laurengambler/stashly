// lib/auth.jsx
// Auth context: subscribes to Supabase auth state and exposes the
// current user/session plus signUp / signIn / signOut helpers. Wraps
// PostHog identify/reset so analytics and auth stay in sync.
//
// Sessions are persisted by supabase-js in localStorage — when the
// user reloads the tab they stay logged in until the token expires
// or signOut() is called.

import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { identifyUser, resetUser, track } from './posthog.js'

const AuthContext = createContext(null)

// Person properties we send to PostHog so users are segmentable.
// Email always exists on the Supabase auth user; name is only present
// if it was set in user_metadata (we omit it otherwise rather than
// sending an empty value).
const personProps = (user) => {
  const props = { email: user.email }
  const name = user.user_metadata?.name || user.user_metadata?.full_name
  if (name) props.name = name
  return props
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session ?? null)
      setLoading(false)
      if (data.session?.user) {
        identifyUser(data.session.user.id, personProps(data.session.user))
      }
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession ?? null)
      if (newSession?.user) {
        identifyUser(newSession.user.id, personProps(newSession.user))
      } else {
        resetUser()
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    // NOTE: user_signed_up is intentionally NOT fired here. This is the
    // signup *attempt*, not a completed signup:
    //   • With email confirmation on, supabase.auth.signUp() returns a
    //     populated data.user before the email is confirmed, and it also
    //     returns a look-alike success for an ALREADY-registered email
    //     (enumeration protection) — so firing here over-counts retries
    //     and returning users (~3x).
    //   • There is no session yet, so identify() has not run and the event
    //     would attach to an anonymous per-browser person.
    // The event now fires exactly once from App.jsx on the first
    // authenticated load — after the profile row is created and identify()
    // has tied the session to the real auth uid. See App.jsx load effect.
    return { data, error }
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (!error && data.user) {
      // method distinguishes auth paths in the funnel. A biometric unlock
      // of an existing session is NOT a login — that emits app_unlocked.
      track('user_logged_in', { user_id: data.user.id, method: 'email' })
    }
    return { data, error }
  }

  // Send a password-reset email. The link returns the user to the app in
  // a PASSWORD_RECOVERY state where they can set a new password.
  // NOTE: on the native iOS build the reset link needs a Universal Link /
  // custom-scheme deep link to reopen the app — flagged as a native step.
  const resetPassword = async (email) => {
    const redirectTo =
      typeof window !== 'undefined' ? window.location.origin : undefined
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    })
    return { error }
  }

  // Sign in with Apple. Fully implemented against the native
  // @capacitor-community/apple-sign-in plugin + supabase.signInWithIdToken
  // in the next phase (needs the Apple Developer capability + Supabase
  // provider config). Until then it degrades to a friendly message rather
  // than a dead button.
  const signInWithApple = async () => {
    return { error: { code: 'apple_unavailable', message: 'Apple sign-in not yet available on this platform' } }
  }

  const signOut = async () => {
    const userId = session?.user?.id
    track('user_logged_out', { user_id: userId })
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const value = {
    session,
    user: session?.user ?? null,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword,
    signInWithApple,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
