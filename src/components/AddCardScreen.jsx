// components/AddCardScreen.jsx
// The "add a card" form. Merchant + card number are required;
// everything else is optional. On save, the entered number is run
// through classifyCardNumber — if it matches a Visa or Mastercard
// PAN, the user is routed to a limited-storage confirmation and the
// saved card never contains the full number, PIN, expiration, or CVV.

import { useState } from 'react'
import {
  uid,
  balanceNumeric,
  balanceSymbol,
  classifyCardNumber,
  CARD_KIND,
  CARD_BRAND,
} from '../lib/helpers.js'

// Inline confirmation shown when a Visa/Mastercard PAN is detected.
// Continuing commits a limited-storage card; cancelling returns the
// user to the form with every field intact so they can correct the
// number if they entered the wrong one.
function LimitedStorageModal({ brand, onCancel, onContinue }) {
  const brandLabel =
    brand === CARD_BRAND.VISA
      ? 'Visa'
      : brand === CARD_BRAND.MASTERCARD
      ? 'Mastercard'
      : 'prepaid'

  return (
    <div
      className="pw-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-modal-title"
    >
      <div className="pw-modal">
        <h3 id="pw-modal-title" className="pw-modal-title">
          Heads up about this card
        </h3>
        <p className="pw-modal-body">
  This is a Visa or Mastercard payment card, not a store gift card.

  Stashly is built for gift cards, so we’ll save this one as a quick reference only. You can still keep track of it here, but it won’t work for scanning or checkout inside the app.
</p>
        <div className="pw-modal-actions">
          <button
            type="button"
            className="pw-modal-btn primary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pw-modal-btn secondary"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

const formatCardNumber = (value) => {
  const digits = value.replace(/\D/g, '')
  return digits.replace(/(.{4})(?=.)/g, '$1 ')
}

export default function AddCardScreen({ onCancel, onSave }) {
  const [merchant, setMerchant] = useState('')
  const [number, setNumber] = useState('')
  const [pin, setPin] = useState('')
  const [balance, setBalance] = useState('')
  const [notes, setNotes] = useState('')

  // When non-null, the user is staring at the limited-storage modal.
  // Holds the classification so Continue can persist without
  // re-running the check.
  const [pendingOpenLoop, setPendingOpenLoop] = useState(null)

  // Can only save once both required fields have content.
  const canSave = merchant.trim() && number.trim()

  // Build the normalized balance once — same logic used for both flows.
  const buildBalanceFields = () => {
    const startingBalance = balanceNumeric(balance)
    const normalizedBalance =
      startingBalance !== null
        ? balanceSymbol(balance) + startingBalance.toFixed(2)
        : ''
    return { startingBalance, normalizedBalance }
  }

  const saveMerchantCard = () => {
    const { startingBalance, normalizedBalance } = buildBalanceFields()
    onSave({
      id: uid(),
      kind: CARD_KIND.MERCHANT_GIFT_CARD,
      brand: CARD_BRAND.UNKNOWN,
      merchant: merchant.trim(),
      number: number.replace(/\s/g, ''),
      pin: pin.trim(),
      balance: normalizedBalance,
      startingBalance,
      transactions: [],
      notes: notes.trim(),
      createdAt: Date.now(),
    })
  }

  // Persist only the fields allowed for open-loop cards. The full PAN,
  // PIN, expiration, and CVV are never written to app state or storage.
  const saveOpenLoopCard = (classification) => {
    const { startingBalance, normalizedBalance } = buildBalanceFields()
    onSave({
      id: uid(),
      kind: CARD_KIND.OPEN_LOOP_PREPAID,
      brand: classification.brand,
      merchant: merchant.trim(),
      last4: classification.last4,
      balance: normalizedBalance,
      startingBalance,
      transactions: [],
      notes: notes.trim(),
      createdAt: Date.now(),
    })
  }

  const handleSave = () => {
    if (!canSave) return
    const classification = classifyCardNumber(number)
    if (classification.isOpenLoop) {
      setPendingOpenLoop(classification)
      return
    }
    saveMerchantCard()
  }

  const handleContinueLimited = () => {
    if (!pendingOpenLoop) return
    saveOpenLoopCard(pendingOpenLoop)
    setPendingOpenLoop(null)
  }

  return (
    <div className="pw-screen active">
      <div className="pw-form-header">
        <button className="pw-nav" onClick={onCancel}>
          Cancel
        </button>
        <h2 className="pw-form-title">Add card</h2>
        <button
          className="pw-nav primary"
          onClick={handleSave}
          disabled={!canSave}
        >
          Save
        </button>
      </div>
      <div className="pw-form-body">
        <div className="pw-group">
          <div className="pw-field">
            <label>Merchant</label>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="e.g. Starbucks, Target"
              autoComplete="off"
              autoCapitalize="words"
            />
          </div>
        </div>

        <div className="pw-group">
          <div className="pw-field">
            <label>Card number</label>
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(formatCardNumber(e.target.value))}
              placeholder="Required"
              autoComplete="off"
            />
          </div>
          <div className="pw-field">
            <label>PIN</label>
            <input
              type="text"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Optional"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="pw-group">
          <div className="pw-field">
            <label>Balance</label>
            <input
              type="text"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="Optional, e.g. 25.00"
              inputMode="decimal"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="pw-group">
          <div className="pw-field">
            <label>Notes</label>
            <textarea
              rows="3"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Expiration, who gifted it, anything else"
            />
          </div>
        </div>

        <p className="pw-hint">
          Stored only on this device. Nothing leaves your browser.
        </p>
      </div>

      {pendingOpenLoop && (
        <LimitedStorageModal
          brand={pendingOpenLoop.brand}
          onCancel={() => setPendingOpenLoop(null)}
          onContinue={handleContinueLimited}
        />
      )}
    </div>
  )
}
