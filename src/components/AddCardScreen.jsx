// components/AddCardScreen.jsx
// The "add a card" form. Merchant + card number are required;
// everything else is optional. Save button stays disabled until
// the required fields are filled.

import { useState } from 'react'
import { uid, balanceNumeric, balanceSymbol } from '../lib/helpers.js'

export default function AddCardScreen({ onCancel, onSave }) {
  const [merchant, setMerchant] = useState('')
  const [number, setNumber] = useState('')
  const [pin, setPin] = useState('')
  const [balance, setBalance] = useState('')
  const [notes, setNotes] = useState('')

  // Can only save once both required fields have content.
  const canSave = merchant.trim() && number.trim()

  const handleSave = () => {
    if (!canSave) return
    const startingBalance = balanceNumeric(balance)
    // Normalize the stored balance string so it looks consistent.
    const normalizedBalance =
      startingBalance !== null
        ? balanceSymbol(balance) + startingBalance.toFixed(2)
        : ''

    onSave({
      id: uid(),
      merchant: merchant.trim(),
      number: number.trim(),
      pin: pin.trim(),
      balance: normalizedBalance,
      startingBalance,
      transactions: [],
      notes: notes.trim(),
      createdAt: Date.now(),
    })
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
              onChange={(e) => setNumber(e.target.value)}
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
    </div>
  )
}
