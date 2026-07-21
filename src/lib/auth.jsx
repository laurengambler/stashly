// lib/auth.jsx
// Auth context: subscribes to Supabase auth state and exposes the
// current user/session plus signUp / signIn / signOut helpers. Wraps
// PostHog identify/reset so analytics and auth stay in sync.
//
// Sessions are persisted by supabase-js in localStorage — when the
// user reloads the tab they stay logged in until the token expires
// or signOut() is called.

import { createContext, useContext, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase.js'
import { identifyUser, resetUser, track } from './posthog.js'

const AuthContext = createContext(null)

// Supabase's Apple callback for this project (native id-token flow verifies
// the audience against the Client IDs configured in the dashboard).
const SUPABASE_APPLE_REDIRECT =
  'https://djwmohvbyizryfxpmlzm.supabase.co/auth/v1/callback'
// Bundle ID — the `aud` of the native Apple identity token.
const APPLE_NATIVE_CLIENT_ID = 'com.getstashly.app'
// Deep link Supabase redirects back to after the "Connect Apple" OAuth
// link flow. Must be registered in Info.plist (CFBundleURLSchemes) AND in
// Supabase → Authentication → URL Configuration → Redirect URLs.
const APPLE_LINK_REDIRECT = 'com.getstashly.app://login-callback'

// Apple wants the SHA-256 of a random nonce in the auth request; Supabase
// gets the raw nonce and re-hashes it to verify the token — blocks replay.
async function sha256Hex(input) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  )
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
function randomNonce(len = 32) {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('')
}

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

  // Complete the "Connect Apple" OAuth link when Supabase deep-links back
  // into the app (com.getstashly.app://login-callback?code=...).
  useEffect(() => {
    let listener
    ;(async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app')
        listener = await CapApp.addListener('appUrlOpen', async ({ url }) => {
          if (!url || !url.includes('login-callback')) return
          try {
            const { error } = await supabase.auth.exchangeCodeForSession(url)
            if (!error) track('apple_linked', {})
          } catch {
            /* non-fatal — user can retry from Settings */
          }
          try {
            const { Browser } = await import('@capacitor/browser')
            await Browser.close()
          } catch {}
        })
      } catch {
        /* @capacitor/app unavailable (web) — nothing to listen for */
      }
    })()
    return () => {
      listener?.remove?.()
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

  // Sign in with Apple — native, one tap, no password, no confirmation
  // email. Uses the @capacitor-community/apple-sign-in native sheet to get
  // an identity token, then supabase.signInWithIdToken. On the web build
  // (no native sheet) it degrades to a friendly message.
  //
  // Account linking: Supabase automatically links this Apple identity into
  // an EXISTING account when Apple returns a verified email that matches
  // (the common case — user didn't hide their email). Apple Private Relay
  // returns a non-matching address, so those create a new account; the
  // proactive "Connect Apple" link flow (needs the web OAuth secret) is the
  // deterministic fix and is deferred until that secret is added.
  const signInWithApple = async () => {
    if (!Capacitor.isNativePlatform?.()) {
      return {
        error: {
          code: 'apple_unavailable',
          message: 'Apple sign-in is only available in the Stashly app.',
        },
      }
    }
    try {
      const { SignInWithApple } = await import(
        '@capacitor-community/apple-sign-in'
      )
      const rawNonce = randomNonce()
      const hashedNonce = await sha256Hex(rawNonce)

      const result = await SignInWithApple.authorize({
        clientId: APPLE_NATIVE_CLIENT_ID,
        redirectURI: SUPABASE_APPLE_REDIRECT,
        scopes: 'email name',
        nonce: hashedNonce,
      })

      const idToken = result?.response?.identityToken
      if (!idToken) {
        return { error: { code: 'apple_no_token', message: 'No identity token from Apple' } }
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: idToken,
        nonce: rawNonce,
      })
      if (error) return { data, error }

      if (data?.user) {
        // Apple only returns the name on the FIRST authorization — persist
        // it so PostHog person props / greetings have it.
        const name = [result?.response?.givenName, result?.response?.familyName]
          .filter(Boolean)
          .join(' ')
          .trim()
        if (name && !data.user.user_metadata?.name) {
          try {
            await supabase.auth.updateUser({ data: { name } })
          } catch {
            /* non-fatal */
          }
        }
        // An Apple authentication IS a login (new or returning); the
        // once-per-signup user_signed_up still fires from App on profile
        // creation with method 'apple'.
        track('user_logged_in', { user_id: data.user.id, method: 'apple' })
      }
      return { data, error: null }
    } catch (err) {
      const msg = (err?.message || '').toLowerCase()
      if (
        msg.includes('cancel') ||
        err?.code === '1001' ||
        err?.code === 'ASAuthorizationErrorCanceled'
      ) {
        return { error: { code: 'apple_canceled', message: 'cancelled' } }
      }
      return { error: { code: 'apple_failed', message: err?.message || 'Apple sign-in failed' } }
    }
  }

  const signOut = async () => {
    const userId = session?.user?.id
    track('user_logged_out', { user_id: userId })
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  // Proactively link Apple to the CURRENTLY signed-in account (the
  // duplicate-proof path: an existing email user attaches Apple before
  // ever doing a standalone Apple sign-in). Uses Supabase's OAuth link
  // flow in the system browser; the deep-link callback is completed by the
  // appUrlOpen listener below.
  // Requires: the Apple web OAuth secret in Supabase, and
  // APPLE_LINK_REDIRECT registered in Supabase's redirect allow-list.
  const linkAppleIdentity = async () => {
    try {
      const { data, error } = await supabase.auth.linkIdentity({
        provider: 'apple',
        options: { skipBrowserRedirect: true, redirectTo: APPLE_LINK_REDIRECT },
      })
      if (error) return { error }
      if (Capacitor.isNativePlatform?.()) {
        const { Browser } = await import('@capacitor/browser')
        await Browser.open({ url: data.url })
      } else if (data?.url) {
        window.location.href = data.url
      }
      return { ok: true }
    } catch (err) {
      return { error: { code: 'apple_link_failed', message: err?.message || 'Could not connect Apple' } }
    }
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
    linkAppleIdentity,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
