// lib/posthog.js
// Thin PostHog wrapper. The rest of the app calls track() / identify()
// without needing to know whether PostHog is configured — if the env
// var is missing in dev, every call is a no-op.
//
// Privacy: we deliberately keep the event payload tiny and never pass
// gift card numbers, PINs, access codes, or exact birthdays through
// here. See the helpers in this file (ageRange, safeBrand) for the
// allow-list shape we send.

import posthog from 'posthog-js'

let _ready = false

export const initPostHog = () => {
  if (_ready) return
  const key = import.meta.env.VITE_POSTHOG_KEY
  const host = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'
  if (!key) {
    // No key in this environment — analytics simply won't fire.
    // This is the expected state during local dev before you set up PostHog.
    return
  }
  posthog.init(key, {
    api_host: host,
    capture_pageview: true,
    persistence: 'localStorage',
    autocapture: false,
    enableExceptionAutocapture: true,
  })
  _ready = true
}

export const identifyUser = (userId, properties = {}) => {
  if (!_ready) return
  if (!userId) return
  posthog.identify(userId, properties)
}

export const resetUser = () => {
  if (!_ready) return
  posthog.reset()
}

// Calculate a coarse age range for analytics. Returns null if we
// don't have a birth year — we never send the raw birthday.
export const ageRange = (birthYear) => {
  if (!birthYear) return null
  const age = new Date().getFullYear() - Number(birthYear)
  if (isNaN(age) || age < 0 || age > 120) return null
  if (age < 18) return 'under_18'
  if (age < 25) return '18_24'
  if (age < 35) return '25_34'
  if (age < 45) return '35_44'
  if (age < 55) return '45_54'
  if (age < 65) return '55_64'
  return '65_plus'
}

// Only the brand label is safe to send. Never pass card.number, card.pin,
// card.last4, or anything user-typed-into-notes.
export const safeBrand = (card) => {
  if (!card) return null
  return card.brand || null
}

export const track = (event, properties = {}) => {
  if (!_ready) return
  posthog.capture(event, {
    ...properties,
    timestamp: new Date().toISOString(),
  })
}
