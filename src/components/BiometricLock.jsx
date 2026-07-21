// components/BiometricLock.jsx
// Wraps the signed-in app. When the biometric lock is enabled and the
// device supports it, the wallet is hidden behind a Face ID / Touch ID
// prompt (with device-passcode fallback) on app open, and again when the
// app returns from the background after a grace period. A successful
// unlock is NOT a login — it emits app_unlocked, never user_logged_in.
//
// On web / any device without biometrics this is a transparent
// passthrough, so the browser build is never blocked.

import { useCallback, useEffect, useRef, useState } from 'react'
import { App as CapApp } from '@capacitor/app'
import { biometricsAvailable, runBiometricUnlock } from '../lib/biometrics.js'
import { track } from '../lib/posthog.js'

const GRACE_MS = 60_000 // return-from-background window before we re-lock

export default function BiometricLock({ enabled, children }) {
  const [available, setAvailable] = useState(false)
  const [locked, setLocked] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [failed, setFailed] = useState(false)
  const backgroundedAt = useRef(null)

  // Check device support once; lock immediately if enabled + supported.
  useEffect(() => {
    let cancelled = false
    if (!enabled) {
      setAvailable(false)
      setLocked(false)
      return
    }
    biometricsAvailable().then((a) => {
      if (cancelled) return
      setAvailable(a)
      if (a) setLocked(true)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const unlock = useCallback(async () => {
    setUnlocking(true)
    setFailed(false)
    const ok = await runBiometricUnlock('Unlock your Stashly wallet')
    setUnlocking(false)
    if (ok) {
      setLocked(false)
      track('app_unlocked', { method: 'biometric' })
    } else {
      setFailed(true)
    }
  }, [])

  // Auto-prompt as soon as we enter the locked state.
  useEffect(() => {
    if (locked && !unlocking && !failed) unlock()
  }, [locked, unlocking, failed, unlock])

  // Re-lock when the app comes back from the background after the grace
  // period. Uses the native app lifecycle when present, with a
  // visibilitychange fallback for the browser/PWA.
  useEffect(() => {
    if (!enabled || !available) return

    const wentBackground = () => {
      backgroundedAt.current = Date.now()
    }
    const cameForeground = () => {
      const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0
      backgroundedAt.current = null
      if (away > GRACE_MS) {
        setFailed(false)
        setLocked(true)
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') wentBackground()
      else cameForeground()
    }
    document.addEventListener('visibilitychange', onVisibility)

    let sub
    try {
      sub = CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) cameForeground()
        else wentBackground()
      })
    } catch {
      /* @capacitor/app not available (web) — visibilitychange covers it */
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      sub?.remove?.()
    }
  }, [enabled, available])

  if (enabled && available && locked) {
    return (
      <div className="pw-lock" role="dialog" aria-modal="true" aria-label="Stashly locked">
        <div className="pw-lock-inner">
          <div className="pw-lock-logo" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <h1 className="pw-lock-title">Stashly is locked</h1>
          <p className="pw-lock-sub">
            {failed
              ? 'Face ID didn’t match. Try again to open your wallet.'
              : 'Unlock with Face ID to open your wallet.'}
          </p>
          <button className="pw-lock-btn" onClick={unlock} disabled={unlocking}>
            {unlocking ? 'Waiting for Face ID…' : failed ? 'Try again' : 'Unlock'}
          </button>
        </div>
      </div>
    )
  }

  return children
}
