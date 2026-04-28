// components/ProfileScreen.jsx
// Placeholder profile tab.

export default function ProfileScreen() {
  return (
    <div className="pw-screen active">
      <div className="pw-header">
        <div>
          <h1 className="pw-title">Profile</h1>
          <p className="pw-subtitle">Your Stashly account</p>
        </div>
      </div>
      <div className="pw-profile-body">
        <div className="pw-profile-card">
          <div className="pw-profile-illo" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#19123D" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8.5" r="3.5" />
              <path d="M4.5 20c1.5-3.5 4.5-5.5 7.5-5.5s6 2 7.5 5.5" />
            </svg>
          </div>
          <h2 className="pw-profile-title">Profile settings coming soon.</h2>
          <p className="pw-profile-body-text">
            We&rsquo;re still cooking — you&rsquo;ll be able to personalise
            Stashly here in a future update.
          </p>
        </div>
      </div>
    </div>
  )
}
