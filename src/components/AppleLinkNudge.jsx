// components/AppleLinkNudge.jsx
// The "first-run guard": a dismissible nudge shown to existing email
// users who haven't linked Apple yet. Linking proactively (while signed
// in as their email account) is the only way to prevent a Private-Relay
// duplicate later, so we surface it gently before they ever tap a
// standalone Sign in with Apple. Hidden once Apple is linked or dismissed.

import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import {
  getAppleNudgeDismissed,
  setAppleNudgeDismissed,
} from '../lib/appSettings.js'
import { track } from '../lib/posthog.js'

const hasProvider = (user, name) => {
  const list =
    user?.app_metadata?.providers ||
    (user?.identities || []).map((i) => i.provider) ||
    []
  return list.includes(name)
}

export default function AppleLinkNudge() {
  const { user, linkAppleIdentity } = useAuth()
  const [dismissed, setDismissed] = useState(getAppleNudgeDismissed())
  const [busy, setBusy] = useState(false)

  const appleLinked = hasProvider(user, 'apple')
  const isEmailUser = hasProvider(user, 'email')
  if (dismissed || appleLinked || !isEmailUser) return null

  const connect = async () => {
    setBusy(true)
    track('apple_link_started', { source: 'nudge' })
    await linkAppleIdentity()
    setBusy(false)
  }
  const dismiss = () => {
    setAppleNudgeDismissed(true)
    setDismissed(true)
    track('apple_link_nudge_dismissed', {})
  }

  return (
    <div className="pw-apple-nudge" role="status">
      <div className="pw-apple-nudge-text">
        <strong>One-tap sign-in</strong>
        Connect Apple so you never type a password again — it stays this same
        account.
      </div>
      <div className="pw-apple-nudge-actions">
        <button
          type="button"
          className="pw-apple-nudge-btn"
          onClick={connect}
          disabled={busy}
        >
          {busy ? '…' : 'Connect Apple'}
        </button>
        <button
          type="button"
          className="pw-apple-nudge-x"
          onClick={dismiss}
          aria-label="Dismiss"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
