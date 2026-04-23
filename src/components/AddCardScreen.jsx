// components/AddCardScreen.jsx
// The "add a card" form. Merchant + card number are required;
// everything else is optional. On save, the entered number is run
// through classifyCardNumber — if it matches a Visa or Mastercard
// PAN, the user is routed to a limited-storage confirmation and the
// saved card never contains the full number, PIN, expiration, or CVV.
//
// The save flow also gates on two UX checks:
//   1) If the user added no front or back photo → warn them.
//   2) A final "confirm card details" step before committing.
// Photos are persisted to IndexedDB via photoStorage.js; only the
// returned photo IDs are written into card metadata.

import { useEffect, useRef, useState } from 'react'
import PhotoInput from './PhotoInput.jsx'
import {
  uid,
  balanceNumeric,
  balanceSymbol,
  classifyCardNumber,
  CARD_KIND,
  CARD_BRAND,
} from '../lib/helpers.js'
import {
  compressImage,
  savePhoto,
  deletePhoto,
  newPhotoId,
} from '../lib/photoStorage.js'

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

function NoPhotoWarningModal({ onAddPhoto, onSaveWithoutPhoto }) {
  return (
    <div
      className="pw-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-nophoto-title"
    >
      <div className="pw-modal">
        <h3 id="pw-nophoto-title" className="pw-modal-title">
          Add a photo before saving?
        </h3>
        <p className="pw-modal-body">
          A photo can help you verify details later if a number, PIN,
          access code, or barcode is missing.
        </p>
        <div className="pw-modal-actions">
          <button
            type="button"
            className="pw-modal-btn primary"
            onClick={onAddPhoto}
          >
            Add Photo
          </button>
          <button
            type="button"
            className="pw-modal-btn secondary"
            onClick={onSaveWithoutPhoto}
          >
            Save Without Photo
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmSaveModal({ onConfirm, onGoBack, saving }) {
  return (
    <div
      className="pw-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-confirm-title"
    >
      <div className="pw-modal">
        <h3 id="pw-confirm-title" className="pw-modal-title">
          Confirm card details
        </h3>
        <p className="pw-modal-body">
          Please make sure your card number, PIN, access code, and any
          other checkout details are correct before saving.
        </p>
        <div className="pw-modal-actions">
          <button
            type="button"
            className="pw-modal-btn primary"
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save Card'}
          </button>
          <button
            type="button"
            className="pw-modal-btn secondary"
            onClick={onGoBack}
            disabled={saving}
          >
            Go Back
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

  // Pending photos — { blob, url } while the card hasn't been saved.
  // Only committed to IndexedDB in commitCard().
  const [frontPhoto, setFrontPhoto] = useState(null)
  const [backPhoto, setBackPhoto] = useState(null)

  // Modal state machine. Only one modal open at a time.
  // null | 'limited' | 'no-photo' | 'confirm'
  const [modal, setModal] = useState(null)
  const [pendingOpenLoop, setPendingOpenLoop] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Keep refs to current photos so unmount cleanup revokes the
  // most recent object URLs (not stale values captured at mount).
  const frontRef = useRef(frontPhoto)
  const backRef = useRef(backPhoto)
  frontRef.current = frontPhoto
  backRef.current = backPhoto
  useEffect(
    () => () => {
      if (frontRef.current?.url) URL.revokeObjectURL(frontRef.current.url)
      if (backRef.current?.url) URL.revokeObjectURL(backRef.current.url)
    },
    []
  )

  // Auto-grow the Notes textarea. Starts at single-line height and
  // expands to fit the content as the user types.
  const notesRef = useRef(null)
  useEffect(() => {
    const el = notesRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [notes])

  const canSave = merchant.trim() && number.trim()
  const hasAnyPhoto = Boolean(frontPhoto || backPhoto)

  const handlePhotoSelected = async (side, file) => {
    const blob = await compressImage(file).catch(() => file)
    const url = URL.createObjectURL(blob)
    const setter = side === 'front' ? setFrontPhoto : setBackPhoto
    setter((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return { blob, url }
    })
  }

  const handlePhotoRemoved = (side) => {
    const setter = side === 'front' ? setFrontPhoto : setBackPhoto
    setter((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return null
    })
  }

  // Build the normalized balance once — same logic used for both flows.
  const buildBalanceFields = () => {
    const startingBalance = balanceNumeric(balance)
    const normalizedBalance =
      startingBalance !== null
        ? balanceSymbol(balance) + startingBalance.toFixed(2)
        : ''
    return { startingBalance, normalizedBalance }
  }

  // Write the pending photo blobs (if any) to IndexedDB and return
  // the IDs to attach to the card. Rolls back any partial write if
  // the second blob fails, so we never end up with orphaned data.
  const persistPhotos = async () => {
    const ids = { frontPhotoId: null, backPhotoId: null }
    if (frontPhoto) {
      ids.frontPhotoId = newPhotoId()
      await savePhoto(ids.frontPhotoId, frontPhoto.blob)
    }
    if (backPhoto) {
      try {
        ids.backPhotoId = newPhotoId()
        await savePhoto(ids.backPhotoId, backPhoto.blob)
      } catch (err) {
        if (ids.frontPhotoId) deletePhoto(ids.frontPhotoId).catch(() => {})
        throw err
      }
    }
    return ids
  }

  const commitCard = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const photoIds = await persistPhotos()
      const { startingBalance, normalizedBalance } = buildBalanceFields()
      if (pendingOpenLoop) {
        onSave({
          id: uid(),
          kind: CARD_KIND.OPEN_LOOP_PREPAID,
          brand: pendingOpenLoop.brand,
          merchant: merchant.trim(),
          last4: pendingOpenLoop.last4,
          balance: normalizedBalance,
          startingBalance,
          transactions: [],
          notes: notes.trim(),
          frontPhotoId: photoIds.frontPhotoId,
          backPhotoId: photoIds.backPhotoId,
          createdAt: Date.now(),
        })
      } else {
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
          frontPhotoId: photoIds.frontPhotoId,
          backPhotoId: photoIds.backPhotoId,
          createdAt: Date.now(),
        })
      }
    } catch (err) {
      console.warn('Could not save card photos', err)
      setSaveError(
        'Could not save photos to this device. Please try again, or remove the photos to save without them.'
      )
      setSaving(false)
      setModal(null)
    }
  }

  // Called from the Save button: decide which modal (if any) to show
  // before committing. The confirm modal is the single commit gate.
  const advanceFromForm = () => {
    if (!canSave) return
    const classification = classifyCardNumber(number)
    if (classification.isOpenLoop) {
      setPendingOpenLoop(classification)
      setModal('limited')
      return
    }
    setPendingOpenLoop(null)
    if (!hasAnyPhoto) {
      setModal('no-photo')
      return
    }
    setModal('confirm')
  }

  const afterLimitedContinue = () => {
    if (!hasAnyPhoto) {
      setModal('no-photo')
    } else {
      setModal('confirm')
    }
  }

  const cancelLimited = () => {
    setPendingOpenLoop(null)
    setModal(null)
  }

  const returnToFormForPhoto = () => {
    setModal(null)
  }

  const skipPhotoWarning = () => {
    setModal('confirm')
  }

  const goBackFromConfirm = () => {
    setModal(null)
  }

  return (
    <div className="pw-screen active">
      <div className="pw-form-header">
        <button className="pw-nav" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <h2 className="pw-form-title">Add card</h2>
        <button
          className="pw-nav primary"
          onClick={advanceFromForm}
          disabled={!canSave || saving}
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
              ref={notesRef}
              rows={1}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Expiration, who gifted it, anything else"
            />
          </div>
        </div>

        <div className="pw-photos-group">
          <div className="pw-photos-group-title">Card photos</div>
          <div className="pw-photos-group-hint">
            Optional — helps you verify details later.
          </div>
          <PhotoInput
            addLabel="Front Photo"
            previewUrl={frontPhoto?.url || null}
            onFileSelected={(file) => handlePhotoSelected('front', file)}
            onRemove={() => handlePhotoRemoved('front')}
            busy={saving}
          />
          <PhotoInput
            addLabel="Back Photo"
            previewUrl={backPhoto?.url || null}
            onFileSelected={(file) => handlePhotoSelected('back', file)}
            onRemove={() => handlePhotoRemoved('back')}
            busy={saving}
          />
        </div>

        {saveError && <p className="pw-error">{saveError}</p>}

        <p className="pw-hint">
          Stored only on this device. Nothing leaves your browser.
        </p>
      </div>

      {modal === 'limited' && pendingOpenLoop && (
        <LimitedStorageModal
          brand={pendingOpenLoop.brand}
          onCancel={cancelLimited}
          onContinue={afterLimitedContinue}
        />
      )}

      {modal === 'no-photo' && (
        <NoPhotoWarningModal
          onAddPhoto={returnToFormForPhoto}
          onSaveWithoutPhoto={skipPhotoWarning}
        />
      )}

      {modal === 'confirm' && (
        <ConfirmSaveModal
          saving={saving}
          onConfirm={commitCard}
          onGoBack={goBackFromConfirm}
        />
      )}
    </div>
  )
}
