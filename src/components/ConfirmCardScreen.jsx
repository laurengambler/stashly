// components/ConfirmCardScreen.jsx
// The single confirm screen after a scan / photo import. Everything the
// user needs to save a findable, spendable card: the captured photo, the
// merchant, the card number exactly as scanned, and optional balance /
// PIN chips. Save is the one lime action.
//
// Three rules this screen exists to enforce:
//
//   1. The card number is shown and stored VERBATIM — no grouping, no
//      re-spacing. The user checks it character-for-character against the
//      card in their hand, and inserted spaces make that read wrong.
//   2. The merchant is only prefilled when recognized text matches a
//      known merchant (see lib/merchants.js). Cards get photographed
//      back-side-up, and a fine-print prefill is worse than a blank field.
//   3. The PIN is optional and collapsed. It only opens pre-filled when
//      the card clearly labeled a PIN. It is never required to save.
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
import { matchMerchant, normalizeMerchantName } from '../lib/merchants.js'
import { parseCardFields, validatedNumber } from '../lib/scanParse.js'
import { savePhoto, newPhotoId } from '../lib/photoStorage.js'
import { track } from '../lib/posthog.js'

const b64ToBlob = async (b64, type = 'image/jpeg') => {
  const res = await fetch(`data:${type};base64,${b64}`)
  return res.blob()
}

export default function ConfirmCardScreen({
  scan,
  batchPosition,
  onSave,
  onBack,
  onCancel,
}) {
  // Merchant autofill is gated on the known-merchant list. No match means
  // an empty field on purpose — we do not guess from fine print.
  const scanMatch = useMemo(
    () => matchMerchant(scan?.textLines, scan?.merchantGuess),
    [scan]
  )
  const [merchant, setMerchant] = useState(scanMatch?.name || '')
  const merchantRef = useRef(null)

  // Merchant is the one field that gates Save, and gating it on the known
  // list means it now arrives blank more often than it used to. Put the
  // cursor in it so the user is one keystroke from being able to save
  // rather than having to find the field first.
  //
  // Caveat: focusing programmatically does not reliably raise the iOS
  // keyboard without a user gesture, so this places the caret and may or
  // may not open the keyboard. The short delay lets the screen transition
  // settle first — focusing mid-transition gets dropped.
  useEffect(() => {
    if (scanMatch) return
    const t = setTimeout(() => merchantRef.current?.focus(), 350)
    return () => clearTimeout(t)
  }, [scanMatch])

  // The native scanner resolves both fields from the card's layout (a line
  // can carry a number AND a PIN). parseCardFields is the same rule set in
  // JS, covering the browser/harness path and any scan that came back with
  // text but no resolved fields.
  const parsed = useMemo(
    () => parseCardFields(scan?.textLines, scan?.barcode),
    [scan]
  )

  // Verbatim. Whatever the scanner read (or the user types) is what shows
  // and what gets stored.
  //
  // validatedNumber is the guard: a SCANNED value only reaches this field
  // as a single alphanumeric run, never as raw recognized line text. The
  // native side already applies it, and it is applied again here because
  // this is the field itself — nothing should be able to route around it.
  // What the user types afterwards is theirs and is not filtered.
  const [number, setNumber] = useState(
    () => validatedNumber(scan?.number) || parsed.number
  )
  const scannedPin = scan?.pin || parsed.pin
  const [pin, setPin] = useState(scannedPin)

  // What the scan put in each field, frozen at mount. Compared against the
  // final values at save to report which prefills the user had to correct —
  // the honest measure of whether the scanner is actually helping. Booleans
  // only; no field values ever leave the device.
  const prefill = useRef({
    number: validatedNumber(scan?.number) || parsed.number,
    pin: scannedPin,
    merchant: scanMatch?.name || '',
  })
  const [showPin, setShowPin] = useState(!!scannedPin)

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

    // Merchant-list gap signal. Fires when the name the user settled on
    // isn't on the known-merchant list — either we prefilled nothing and
    // they typed it, or we prefilled a match and they replaced it with
    // something else. Ranked by frequency, these are exactly the names
    // worth adding to lib/merchants.js next.
    //
    // Deliberately measured at save, not on every keystroke, so it
    // reflects what the user committed to. It is not an error event and
    // has no bearing on the add-card funnel.
    const typedMerchant = merchant.trim()
    if (typedMerchant && !matchMerchant([typedMerchant])) {
      track('merchant_unmatched', {
        merchant: normalizeMerchantName(typedMerchant),
        // Did the gated autofill put something there that they replaced?
        replaced_match: scanMatch ? scanMatch.name : null,
        // Distinguishes "the list is missing this merchant" from "the scan
        // read no text at all", which is a capture problem, not a gap.
        had_scan_text: (scan?.textLines || []).length > 0,
        batch_position: batchPosition,
      })
    }

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
        // Stored exactly as scanned/typed — only surrounding whitespace
        // is trimmed. Any internal spacing is the card's own.
        number: number.trim(),
        pin: pin.trim(),
        // The scanned barcode is stored in its own right, because it is not
        // always the card number: a gift-card barcode often carries a retail
        // UPC plus an internal serial. cardsApi falls back to the number when
        // this is absent, which was fine only while the two were the same
        // value — now that a labeled number outranks the barcode, the
        // register needs the payload that was actually on the card.
        barcodeValue: scan?.barcode || '',
        barcodeFormat: scan?.barcodeFormat || '',
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
      // Which fields the scan filled, and which of those the user had to
      // correct before saving. Booleans only — never the values.
      //
      // `balance` is never prefilled today (nothing reads a balance off a
      // card), so its two flags are always false. They are emitted anyway so
      // the event's shape does not change if balance prefill ever lands.
      const edited = (before, after) =>
        !!before && before.trim() !== (after || '').trim()

      await onSave(payload, {
        addAnother,
        fields: {
          prefilled_number: !!prefill.current.number,
          prefilled_pin: !!prefill.current.pin,
          prefilled_merchant: !!prefill.current.merchant,
          prefilled_balance: false,
          edited_number: edited(prefill.current.number, number),
          edited_pin: edited(prefill.current.pin, pin),
          edited_merchant: edited(prefill.current.merchant, merchant),
          edited_balance: false,
        },
      })
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
        {/* Leaving the flow used to mean tapping Retake first, to reach the
            capture screen's Cancel. Two taps, and the first one looks like
            it discards the scan. This is the way out, always on screen. */}
        <button
          className="pw-nav pw-nav-close"
          onClick={() => {
            track('card_add_cancelled', { from: 'confirm' })
            onCancel?.()
          }}
          disabled={saving}
          aria-label="Cancel adding this card"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
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
            ref={merchantRef}
            type="text"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="Who's it for? e.g. Starbucks"
            autoCapitalize="words"
          />
        </div>

        {!classification.isOpenLoop ? (
          <div className="pw-field pw-confirm-field pw-confirm-verbatim">
            <label>Card number</label>
            <input
              type="text"
              inputMode="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Scanned automatically"
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <p className="pw-field-hint">
              Shown exactly as it reads on the card — check it before saving.
            </p>
          </div>
        ) : (
          <p className="pw-notice pw-confirm-notice">
            This looks like a Visa or Mastercard. For your security we'll save
            only the last 4 digits (••{classification.last4}) as a reference.
          </p>
        )}

        {/* PIN and balance are both optional add-ons, collapsed until asked
            for. Neither gates the save. */}
        {!classification.isOpenLoop &&
          (showPin ? (
            <div className="pw-field pw-confirm-field pw-confirm-verbatim">
              <label>
                PIN <span className="pw-optional">(optional)</span>
              </label>
              <input
                type="text"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="e.g. 4821"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={!scannedPin}
              />
              {scannedPin ? (
                <p className="pw-field-hint">Found a PIN on the card — check it.</p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className="pw-confirm-chip"
              onClick={() => setShowPin(true)}
            >
              + Add PIN
            </button>
          ))}

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
