// lib/appSettings.js
// Tiny persisted app-settings store. Backed by localStorage (which
// persists across launches in the iOS WebView); a Capacitor Preferences
// adapter can back it later for extra durability without changing callers.

const KEY = 'stashly_settings_v1'

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

// Returns { ok, settings }. `ok: false` means the setting did NOT persist
// and will be back to its old value next launch — callers must say so
// rather than leaving the UI showing a change that did not stick.
// Swallowing this mattered most for the biometric lock, which defaults ON:
// a user who turned it off in private mode, or with storage full, found it
// on again next launch with no explanation.
const write = (patch) => {
  const next = { ...read(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
    return { ok: true, settings: next }
  } catch (err) {
    console.warn('Could not persist app settings', err)
    return { ok: false, settings: next }
  }
}

// Biometric app-lock defaults ON — the brief wants Face ID protecting the
// wallet on app open. Users can turn it off in settings.
export const getBiometricLockEnabled = () => read().biometricLock !== false
// Returns { ok, settings } — check `ok` and tell the user on failure.
export const setBiometricLockEnabled = (on) => write({ biometricLock: !!on })

// One-time "Connect Apple" nudge for existing email users (dismissible).
export const getAppleNudgeDismissed = () => read().appleNudgeDismissed === true
export const setAppleNudgeDismissed = (v) => write({ appleNudgeDismissed: !!v })
