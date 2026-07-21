// lib/authErrors.js
// Turns Supabase auth errors into warm, specific, human copy. The auth
// UI shows ONLY these strings — never a raw error code or a Supabase
// message. `context` lets the same underlying error read differently on
// the sign-in vs. create-account screens.

export const friendlyAuthError = (error, context = 'signin') => {
  if (!error) return null

  const code = error.code || ''
  const msg = (error.message || '').toLowerCase()
  const status = error.status

  // User backed out of Apple / a native sheet — not an error worth showing.
  if (
    code === 'apple_canceled' ||
    msg.includes('cancel') ||
    msg.includes('1001') // ASAuthorization user-cancelled
  ) {
    return null
  }

  if (code === 'apple_unavailable') {
    return 'Sign in with Apple is available in the Stashly app on your iPhone.'
  }

  if (code === 'apple_failed' || code === 'apple_no_token') {
    return "We couldn't finish Sign in with Apple. Please try again, or use email below."
  }

  if (
    msg.includes('failed to fetch') ||
    msg.includes('network') ||
    code === 'network_error'
  ) {
    return "We couldn't reach Stashly just now. Check your connection and try again."
  }

  if (status === 429 || code === 'over_request_rate_limit' || msg.includes('rate limit')) {
    return 'Too many tries in a row. Give it a minute, then try again.'
  }

  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) {
    return 'Please confirm your email first — check your inbox for the link we sent.'
  }

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return context === 'signup'
      ? "That didn't work — double-check your email and password."
      : "That email and password don't match. Check them, or reset your password below."
  }

  if (
    code === 'user_already_exists' ||
    msg.includes('already registered') ||
    msg.includes('already been registered')
  ) {
    return 'You already have an account with this email. Try signing in instead.'
  }

  if (code === 'weak_password' || msg.includes('password should be') || msg.includes('at least 6')) {
    return 'Please pick a password with at least 6 characters.'
  }

  if (code === 'validation_failed' || msg.includes('valid email') || msg.includes('unable to validate email')) {
    return "That doesn't look like a valid email address."
  }

  return 'Something went wrong on our end. Please try again in a moment.'
}
