// components/WalletScreen.jsx
// The home screen. Shows all active (non-archived) cards. Cards can
// be swiped right to reveal an Archive action and swiped left to
// toggle Favorite. Favorited cards float to the top of the list.

import SwipeRow from './SwipeRow.jsx'
import {
  themeForCard,
  monogram,
  cardBalanceDisplay,
  cardMaskedNumber,
  isOpenLoopCard,
} from '../lib/helpers.js'

function StarIcon({ filled }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2.5l2.95 6.4 7.05.7-5.3 4.9 1.55 6.95L12 17.7l-6.25 3.75L7.3 14.5 2 9.6l7.05-.7L12 2.5z" />
    </svg>
  )
}

function CardListItem({ card, onOpen, onArchive, onToggleFavorite }) {
  const theme = themeForCard(card)
  const balance = cardBalanceDisplay(card)
  const openLoop = isOpenLoopCard(card)

  const leftActions = ({ close }) => (
    <button
      className="pw-swipe-action pw-swipe-archive"
      onClick={(e) => {
        e.stopPropagation()
        close()
        onArchive(card.id)
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="4" rx="1.5" />
        <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
        <path d="M10 13h4" />
      </svg>
      Archive
    </button>
  )

  const rightActions = ({ close }) => (
    <button
      className={'pw-swipe-action pw-swipe-favorite' + (card.favorite ? ' is-on' : '')}
      onClick={(e) => {
        e.stopPropagation()
        close()
        onToggleFavorite(card.id)
      }}
    >
      <StarIcon filled={card.favorite} />
      {card.favorite ? 'Unfavorite' : 'Favorite'}
    </button>
  )

  return (
    <SwipeRow
      className="pw-swipe-card"
      leftActions={leftActions}
      rightActions={rightActions}
      onTap={() => onOpen(card.id)}
    >
      <div
        className="pw-card"
        style={{ background: theme.bg, color: theme.text }}
      >
        {openLoop && (
          <span className="pw-badge pw-badge-on-card">Reference only</span>
        )}
        {card.favorite && (
          <span
            className="pw-card-fav"
            style={{ color: theme.text }}
            aria-label="Favorited"
          >
            <StarIcon filled />
          </span>
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
    </SwipeRow>
  )
}

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

export default function WalletScreen({
  cards,
  onAdd,
  onOpen,
  onArchive,
  onToggleFavorite,
}) {
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
          cards.map((card) => (
            <CardListItem
              key={card.id}
              card={card}
              onOpen={onOpen}
              onArchive={onArchive}
              onToggleFavorite={onToggleFavorite}
            />
          ))
        )}
      </div>
    </div>
  )
}
