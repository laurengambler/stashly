// components/WalletScreen.jsx
// The home screen. Shows all saved cards as a scrollable list,
// or an empty state if there are no cards.

import {
  themeAtPosition,
  monogram,
  cardBalanceDisplay,
  cardMaskedNumber,
  isOpenLoopCard,
} from '../lib/helpers.js'

// A single card row in the list view. Receives its theme precomputed
// from the parent so the color reflects the card's position in the
// full sorted list (ombre gradient, top → bottom).
function CardListItem({ card, theme, onOpen }) {
  const balance = cardBalanceDisplay(card)
  const openLoop = isOpenLoopCard(card)

  return (
    <div
      className="pw-card"
      onClick={() => onOpen(card.id)}
      style={{ background: theme.bg, color: theme.text }}
    >
      {openLoop && (
        <span className="pw-badge pw-badge-on-card">Reference only</span>
      )}
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
    </div>
  )
}

// Empty state shown when the user has zero cards.
function EmptyState({ onAdd }) {
  return (
    <div className="pw-empty">
      <div className="pw-empty-illo">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#19123D"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="6" width="20" height="14" rx="3" />
          <path d="M2 11h20" />
          <path d="M7 16h3" />
        </svg>
      </div>
      <h2 className="pw-empty-title">Your wallet is ready</h2>
      <p className="pw-empty-body">
        Add your first gift card and it will live here — no accounts, no
        cloud, just your cards.
      </p>
      <button className="pw-empty-cta" onClick={onAdd}>
        Add a card
      </button>
    </div>
  )
}

export default function WalletScreen({ cards, onAdd, onOpen }) {
  // `cards` arrives pre-sorted (A→Z by merchant) from App.jsx, so the
  // gradient index here is also the display order.
  const subtitle =
    cards.length === 0
      ? 'Empty and ready'
      : cards.length === 1
      ? '1 card'
      : cards.length + ' cards'

  return (
    <div className="pw-screen active">
      <div className="pw-header">
        <div>
          <h1 className="pw-title">Wallet</h1>
          <p className="pw-subtitle">{subtitle}</p>
        </div>
        <button className="pw-add-btn" onClick={onAdd} aria-label="Add card">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <div className="pw-cards">
        {cards.length === 0 ? (
          <EmptyState onAdd={onAdd} />
        ) : (
          cards.map((card, i) => (
            <CardListItem
              key={card.id}
              card={card}
              theme={themeAtPosition(i, cards.length)}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  )
}
