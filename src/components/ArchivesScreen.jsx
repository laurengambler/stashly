// components/ArchivesScreen.jsx
// Lists every archived card. Each row shows a "Restore" action that
// flips `archived` back to false on the parent state. Archived cards
// stay in localStorage; this screen is just a different view of them.

import {
  themeForCard,
  monogram,
  cardMaskedNumber,
  cardBalanceDisplay,
} from '../lib/helpers.js'

function ArchivedCardRow({ card, onRestore, onOpen }) {
  const theme = themeForCard(card)
  const balance = cardBalanceDisplay(card)
  return (
    <div className="pw-archive-row">
      <button
        className="pw-card pw-card-compact"
        onClick={() => onOpen(card.id)}
        style={{ background: theme.bg, color: theme.text }}
      >
        <div className="pw-card-top">
          <div className="pw-monogram" style={{ background: theme.mono }}>
            {monogram(card.merchant)}
          </div>
          <h3 className="pw-merchant">{card.merchant}</h3>
        </div>
        <div className="pw-card-bottom">
          <div className="pw-card-num">{cardMaskedNumber(card)}</div>
          {balance && (
            <div>
              <div className="pw-card-bal-label">Balance</div>
              <div className="pw-card-bal">{balance}</div>
            </div>
          )}
        </div>
      </button>
      <button
        className="pw-archive-restore"
        onClick={() => onRestore(card.id)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
        Restore
      </button>
    </div>
  )
}

export default function ArchivesScreen({ cards, onRestore, onOpen }) {
  const subtitle =
    cards.length === 0
      ? 'Nothing archived yet'
      : cards.length === 1
      ? '1 archived card'
      : cards.length + ' archived cards'

  return (
    <div className="pw-screen active">
      <div className="pw-header">
        <div>
          <h1 className="pw-title">Archives</h1>
          <p className="pw-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="pw-cards">
        {cards.length === 0 ? (
          <div className="pw-empty">
            <div className="pw-empty-illo">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#19123D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="4" rx="1.5" />
                <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
                <path d="M10 13h4" />
              </svg>
            </div>
            <h2 className="pw-empty-title">Nothing archived</h2>
            <p className="pw-empty-body">
              Cards you archive from your wallet will live here. Restore one
              any time to bring it back.
            </p>
          </div>
        ) : (
          cards.map((card) => (
            <ArchivedCardRow
              key={card.id}
              card={card}
              onRestore={onRestore}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  )
}
