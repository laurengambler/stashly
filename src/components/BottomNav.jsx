// components/BottomNav.jsx
// Fixed bottom navigation: Cards (active wallet), Archives, Profile.

const TABS = [
  {
    id: 'wallet',
    label: 'Cards',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="14" rx="3" />
        <path d="M2 11h20" />
      </svg>
    ),
  },
  {
    id: 'archives',
    label: 'Archives',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="4" rx="1.5" />
        <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
        <path d="M10 13h4" />
      </svg>
    ),
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M4.5 20c1.5-3.5 4.5-5.5 7.5-5.5s6 2 7.5 5.5" />
      </svg>
    ),
  },
]

export default function BottomNav({ active, onChange }) {
  return (
    <nav className="pw-bottomnav" aria-label="Primary">
      {TABS.map((tab) => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            className={'pw-bottomnav-tab' + (isActive ? ' active' : '')}
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="pw-bottomnav-icon">{tab.icon}</span>
            <span className="pw-bottomnav-label">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
