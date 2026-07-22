// components/ConfirmCardScreen.jsx
// The single confirm screen after a scan / photo import. Everything the
// user needs to save a findable, spendable card: the captured photo, an
// auto-guessed merchant (tap to edit), the auto-filled number, and an
// optional balance chip. Save is the one lime action. PIN / color / notes
// are intentionally left for the card detail screen post-add.
//
// Open-loop (Visa/Mastercard) detection is preserved: if the number
// classifies as a payment PAN we store the last-4 only and fire
// open_loop_card_detected, exactly like the manual form did.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  uid,
  classifyCardNumber,
  sanitizeCurrencyInput,
  CARD_KIND,
  CARD_BRAND,
  CARD_COLORS,
} from '../lib/helpers.js'
import { savePhoto, newPhotoId } from '../lib/photoStorage.js'
import { track } from '../lib/posthog.js'

const formatCardNumber = (value) => {
  const digits = (value || '').replace(/\D/g, '')
  return digits.replace(/(.{4})(?=.)/g, '$1 ')
}

const b64ToBlob = async (b64, type = 'image/jpeg') => {
  const res = await fetch(`data:${type};base64,${b64}`)
  return res.blob()
}

export default function ConfirmCardScreen({
  scan,
  batchPosition,
  onSave,
  onBack,
}) {
  const [merchant, setMerchant] = useState(scan?.merchantGuess || '')
  const [number, setNumber] = useState(formatCardNumber(scan?.number || ''))
  const [showBalance, setShowBalance] = useState(false)
  const [balance, setBalance] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(null)
  const blobRef = useRef(null)

  // Build a preview from the captured image (kept as a blob to persist on save).
  useEffect(() => {
    let url
    let cancelled = false
    ;(async () => {
      if (!scan?.imageBase64) return
      try {
        const blob = await b64ToBlob(scan.imageBase64)
        if (cancelled) return
        blobRef.current = blob
        url = URL.createObjectURL(blob)
        setPhotoUrl(url)
      } catch {
        /* no preview — fine */
      }
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [scan])

  const classification = useMemo(() => classifyCardNumber(number), [number])
  const canSave = merchant.trim().length > 0

  const commit = async ({ addAnother }) => {
    if (!canSave || saving) return
    setSaving(true)
    setError(null)

    // Persist the captured photo (if any) to IndexedDB.
    let frontPhotoId = null
    try {
      if (blobRef.current) {
        frontPhotoId = newPhotoId()
        await savePhoto(frontPhotoId, blobRef.current)
      }
    } catch {
      frontPhotoId = null // photo is optional; never block the save
    }

    const startingBalance = showBalance ? sanitizeCurrencyInput(balance) : null

    let payload
    if (classification.isOpenLoop) {
      track('open_loop_card_detected', { brand: classification.brand })
      payload = {
        id: uid(),
        kind: CARD_KIND.OPEN_LOOP_PREPAID,
        brand: classification.brand,
        merchant: merchant.trim(),
        last4: classification.last4,
        balance: startingBalance,
        startingBalance,
        transactions: [],
        notes: '',
        frontPhotoId,
        backPhotoId: null,
        color: CARD_COLORS[0],
        favorite: false,
        archived: false,
        createdAt: Date.now(),
      }
    } else {
      payload = {
        id: uid(),
        kind: CARD_KIND.MERCHANT_GIFT_CARD,
        brand: CARD_BRAND.UNKNOWN,
        merchant: merchant.trim(),
        number: number.replace(/\s/g, ''),
        pin: '',
        balance: startingBalance,
        startingBalance,
        transactions: [],
        notes: '',
        frontPhotoId,
        backPhotoId: null,
        color: CARD_COLORS[0],
        favorite: false,
        archived: false,
        createdAt: Date.now(),
      }
    }

    try {
      await onSave(payload, { addAnother })
      // Parent handles navigation (next scan or back to wallet).
    } catch (err) {
      setError(err?.message || 'Could not save. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="pw-screen active pw-confirm">
      <div className="pw-form-header">
        <button className="pw-nav" onClick={onBack} disabled={saving}>
          Retake
        </button>
        <h2 className="pw-form-title">Confirm card</h2>
        <span style={{ minWidth: 44 }} />
      </div>

      <div className="pw-confirm-body">
        <div className="pw-confirm-photo">
          {photoUrl ? (
            <img src={photoUrl} alt="Captured card" />
          ) : (
            <div className="pw-confirm-photo-empty" aria-hidden="true">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="14" rx="3" />
                <path d="M2 11h20" />
              </svg>
            </div>
          )}
        </div>

        <div className="pw-field pw-confirm-field">
          <label>Merchant</label>
          <input
            type="text"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="Who's it for? e.g. Starbucks"
            autoCapitalize="words"
          />
        </div>

        {!classification.isOpenLoop ? (
          <div className="pw-field pw-confirm-field">
            <label>Card number</label>
            <input
              type="text"
              inputMode="numeric"
              value={number}
              onChange={(e) => setNumber(formatCardNumber(e.target.value))}
              placeholder="Scanned automatically"
            />
          </div>
        ) : (
          <p className="pw-notice pw-confirm-notice">
            This looks like a Visa or Mastercard. For your security we'll save
            only the last 4 digits (••{classification.last4}) as a reference.
          </p>
        )}

        {showBalance ? (
          <div className="pw-field pw-confirm-field">
            <label>Balance <span className="pw-optional">(optional)</span></label>
            <input
              type="text"
              inputMode="decimal"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="e.g. 25.00"
              autoFocus
            />
          </div>
        ) : (
          <button
            type="button"
            className="pw-confirm-chip"
            onClick={() => setShowBalance(true)}
          >
            + Add balance
          </button>
        )}

        {error && <p className="pw-error">{error}</p>}
      </div>

      <div className="pw-confirm-footer">
        <button
          type="button"
          className="pw-confirm-save"
          onClick={() => commit({ addAnother: false })}
          disabled={!canSave || saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="pw-confirm-again"
          onClick={() => commit({ addAnother: true })}
          disabled={!canSave || saving}
        >
          Save &amp; scan another
        </button>
      </div>
    </div>
  )
}
