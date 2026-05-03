// components/ProfileScreen.jsx
// Real profile now: shows the signed-in email, the editable birthday
// section, and the logout action. Profile data is read/written
// through profileApi.js so this stays UI-only.

import { useAuth } from '../lib/auth.jsx'
import BirthdaySection from './BirthdaySection.jsx'

export default function ProfileScreen({ profile, onSaveProfile, onSignOut }) {
  const { user } = useAuth()

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

        <button className="pw-signout-btn" onClick={onSignOut} type="button">
          Sign out
        </button>

        <p className="pw-privacy-note">
          We never sell your data. Card numbers, PINs, and exact birthdays are
          never sent to analytics.
        </p>
      </div>
    </div>
  )
}
