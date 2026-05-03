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

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session ?? null)
      setLoading(false)
      if (data.session?.user) identifyUser(data.session.user.id)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession ?? null)
      if (newSession?.user) {
        identifyUser(newSession.user.id)
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
    if (!error && data.user) {
      track('user_signed_up', { user_id: data.user.id })
    }
    return { data, error }
  }

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (!error && data.user) {
      track('user_logged_in', { user_id: data.user.id })
    }
    return { data, error }
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
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
