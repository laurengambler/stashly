// lib/biometrics.js
// Thin wrapper over device biometrics (Face ID / Touch ID) with device
// passcode fallback, via @aparajita/capacitor-biometric-auth. On the web
// (and anywhere without a real biometric sensor) it reports unavailable
// and never blocks — the lock only engages on the native device build.

import { Capacitor } from '@capacitor/core'
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'

export const biometricsAvailable = async () => {
  if (!Capacitor.isNativePlatform?.()) return false
  try {
    const info = await BiometricAuth.checkBiometry()
    return !!info?.isAvailable
  } catch {
    return false
  }
}

// Prompt Face ID / Touch ID, allowing the device passcode as fallback.
// Resolves true on success, false on cancel/failure. On web it resolves
// true so it can never lock a developer out of the browser build.
export const runBiometricUnlock = async (reason = 'Unlock your Stashly wallet') => {
  if (!Capacitor.isNativePlatform?.()) return true
  try {
    await BiometricAuth.authenticate({
      reason,
      allowDeviceCredential: true, // passcode fallback (brief requirement)
      iosFallbackTitle: 'Use passcode',
      cancelTitle: 'Cancel',
    })
    return true
  } catch {
    return false
  }
}
