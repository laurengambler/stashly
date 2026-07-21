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

const write = (patch) => {
  const next = { ...read(), ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
  return next
}

// Biometric app-lock defaults ON — the brief wants Face ID protecting the
// wallet on app open. Users can turn it off in settings.
export const getBiometricLockEnabled = () => read().biometricLock !== false
export const setBiometricLockEnabled = (on) => write({ biometricLock: !!on })
