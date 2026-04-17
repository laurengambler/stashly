// components/CardDetailScreen.jsx
// The main "working" screen — shows one card with all its details,
// the spending tracker, undo history, and the barcode.

import { useState, useMemo } from 'react'
import Barcode from './Barcode.jsx'
import {
  formatNumber,
  balanceSymbol,
  cardBalanceDisplay,
  computeBalance,
  relativeTime,
  haptic,
  txid,
} from '../lib/helpers.js'

// Sub-component: the spending tracker section.
// Only rendered when the card has a starting balance.
function SpendingTracker({ card, onDeduct, onUndo }) {
  const [amount, setAmount] = useState('')
  const parsed = parseFloat(amount)
  const canDeduct = !isNaN(parsed) && parsed > 0

  const handleDeduct = () => {
    if (!canDeduct) return
    onDeduct(parsed)
    setAmount('')
  }

  // Show most recent first.
  const transactions = useMemo(
    () => (card.transactions || []).slice().sort((a, b) => b.date - a.date),
    [card.transactions]
  )

  const sym = balanceSymbol(card.balance)

  return (
    <div className="pw-section">
      <div className="pw-row" style={{ borderBottom: 'none', paddingBottom: 6 }}>
        <div className="pw-row-label">Track spending</div>
      </div>
      <div className="pw-deduct-row">
        <input
          type="number"
          className="pw-deduct-input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleDeduct()}
          placeholder="Amount spent"
          step="0.01"
          min="0"
        />
        <button
          className="pw-deduct-btn"
          onClick={handleDeduct}
          disabled={!canDeduct}
        >
          Deduct
        </button>
      </div>

      {transactions.length > 0 && (
        <div className="pw-tx-list">
          <div className="pw-tx-header">Recent activity</div>
          {transactions.map((t) => (
            <div className="pw-tx-row" key={t.id}>
              <div className="pw-tx-left">
                <div className="pw-tx-amount">
                  − {sym}
                  {t.amount.toFixed(2)}
                </div>
                <div className="pw-tx-date">{relativeTime(t.date)}</div>
              </div>
              <button className="pw-tx-undo" onClick={() => onUndo(t.id)}>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 14L4 9l5-5" />
                  <path d="M4 9h11a5 5 0 0 1 5 5v1" />
                </svg>
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Sub-component: the PIN row with tap-to-reveal.
function PinRow({ pin }) {
  const [revealed, setRevealed] = useState(false)

  if (!pin) {
    return (
      <div className="pw-row">
        <div className="pw-row-label">PIN</div>
        <div
          className="pw-row-value"
          style={{ color: 'rgba(25,18,61,0.4)' }}
        >
          Not set
        </div>
      </div>
    )
  }

  const toggle = () => {
    setRevealed((r) => !r)
    haptic(15)
  }

  return (
    <div className="pw-row">
      <div className="pw-row-label">PIN</div>
      <div className="pw-pin-row">
        <div
          className={
            'pw-row-value' + (revealed ? '' : ' pw-pin-mask')
          }
          style={revealed ? { color: '#19123D' } : undefined}
        >
          {revealed ? pin : '••••'}
        </div>
        <button
          className={'pw-pin-reveal' + (revealed ? ' active' : '')}
          onClick={toggle}
        >
          {revealed ? 'Hide' : 'Reveal'}
        </button>
      </div>
    </div>
  )
}

export default function CardDetailScreen({
  card,
  theme,
  onBack,
  onDeduct,
  onUndo,
  onDelete,
}) {
  const balance = cardBalanceDisplay(card)
  const hasBalance = computeBalance(card) !== null

  const handleDelete = () => {
    if (confirm('Remove ' + card.merchant + ' from your wallet?')) {
      onDelete(card.id)
    }
  }

  return (
    <div className="pw-screen active">
      <div className="pw-form-header">
        <button className="pw-nav" onClick={onBack}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ verticalAlign: '-3px', marginRight: 4 }}
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Wallet
        </button>
        <h2 className="pw-form-title">{card.merchant}</h2>
        <div style={{ minWidth: 60 }} />
      </div>

      <div className="pw-detail-hero">
        <div
          className="pw-detail-card"
          style={{ background: theme.bg, color: theme.text }}
        >
          <h3 className="pw-detail-merchant">{card.merchant}</h3>
          <div>
            <div className="pw-detail-bal-label">Balance</div>
            <div className="pw-detail-bal">{balance || '—'}</div>
          </div>
        </div>
      </div>

      {hasBalance && (
        <SpendingTracker
          card={card}
          onDeduct={(amt) => {
            onDeduct(card.id, {
              id: txid(),
              amount: Math.round(amt * 100) / 100,
              date: Date.now(),
            })
            haptic(15)
          }}
          onUndo={(tid) => onUndo(card.id, tid)}
        />
      )}

      <div className="pw-section">
        <div className="pw-row">
          <div className="pw-row-label">Card number</div>
          <div className="pw-row-value">{formatNumber(card.number)}</div>
        </div>
        <PinRow pin={card.pin} />
      </div>

      {card.notes && (
        <div className="pw-section">
          <div className="pw-row">
            <div className="pw-row-label">Notes</div>
            <div className="pw-notes-value">{card.notes}</div>
          </div>
        </div>
      )}

      <div className="pw-barcode">
        <div className="pw-barcode-label">Scan at register</div>
        <Barcode value={card.number} />
      </div>

      <button className="pw-delete" onClick={handleDelete}>
        Remove card
      </button>
    </div>
  )
}
