// components/ProfileScreen.jsx
// Real profile now: shows the signed-in email, the editable birthday
// section, and the logout action. Profile data is read/written
// through profileApi.js so this stays UI-only.

import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { friendlyAuthError } from '../lib/authErrors.js'
import BirthdaySection from './BirthdaySection.jsx'

// Which providers are linked to this account.
const hasProvider = (user, name) => {
  const list =
    user?.app_metadata?.providers ||
    (user?.identities || []).map((i) => i.provider) ||
    []
  return list.includes(name)
}

export default function ProfileScreen({
  profile,
  onSaveProfile,
  onSignOut,
  biometricLockEnabled,
  onToggleBiometricLock,
}) {
  const { user, linkAppleIdentity } = useAuth()
  const [linkBusy, setLinkBusy] = useState(false)
  const [linkError, setLinkError] = useState(null)
  const appleLinked = hasProvider(user, 'apple')

  const connectApple = async () => {
    setLinkBusy(true)
    setLinkError(null)
    const { error } = await linkAppleIdentity()
    if (error) setLinkError(friendlyAuthError(error, 'signin'))
    setLinkBusy(false)
  }

  return (
    <div className="pw-screen active">
      <div className="pw-header">
        <div>
          <h1 className="pw-title">Profile</h1>
          <p className="pw-subtitle">Your Stashly account</p>
        </div>
      </div>
      <div className="pw-profile-body">
        <div className="pw-profile-account">
          <div className="pw-profile-illo" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#19123D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8.5" r="3.5" />
              <path d="M4.5 20c1.5-3.5 4.5-5.5 7.5-5.5s6 2 7.5 5.5" />
            </svg>
          </div>
          <div className="pw-profile-account-meta">
            <div className="pw-profile-account-label">Signed in as</div>
            <div className="pw-profile-account-email">{user?.email || '—'}</div>
          </div>
        </div>

        <BirthdaySection
          variant="profile"
          profile={profile}
          onSave={onSaveProfile}
        />

        {!appleLinked && (
          <div className="pw-setting-row">
            <div className="pw-setting-text">
              <div className="pw-setting-title">Connect Apple</div>
              <div className="pw-setting-sub">
                Add one-tap Sign in with Apple. Linking keeps everything in
                this account — no second account.
              </div>
              {linkError && <div className="pw-setting-error">{linkError}</div>}
            </div>
            <button
              type="button"
              className="pw-connect-btn"
              onClick={connectApple}
              disabled={linkBusy}
            >
              {linkBusy ? '…' : 'Connect'}
            </button>
          </div>
        )}

        <div className="pw-setting-row">
          <div className="pw-setting-text">
            <div className="pw-setting-title">Require Face ID</div>
            <div className="pw-setting-sub">
              Lock your wallet with Face ID or Touch ID when you open the app.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!!biometricLockEnabled}
            aria-label="Require Face ID"
            className={'pw-switch' + (biometricLockEnabled ? ' on' : '')}
            onClick={() => onToggleBiometricLock(!biometricLockEnabled)}
          >
            <span className="pw-switch-knob" />
          </button>
        </div>

        <button className="pw-signout-btn" onClick={onSignOut} type="button">
          Sign out
        </button>

        <p className="pw-privacy-note">
          Card numbers, PINs, and exact birthdays are never sent to analytics.
        </p>
      </div>
    </div>
  )
}
