// components/CardDetailScreen.jsx
// The main "working" screen — shows one card with all its details,
// the spending tracker, undo history, and (for merchant gift cards
// only) the barcode. Open-loop prepaid cards render in a limited
// reference view with no PAN, no PIN, and no barcode.

import { useEffect, useRef, useState, useMemo } from 'react'
import Barcode from './Barcode.jsx'
import PhotoInput from './PhotoInput.jsx'
import ColorPicker from './ColorPicker.jsx'
import {
  formatNumber,
  balanceSymbol,
  cardBalanceDisplay,
  computeBalance,
  relativeTime,
  haptic,
  txid,
  isOpenLoopCard,
  cardMaskedNumber,
  CARD_BRAND,
  defaultColorForCard,
} from '../lib/helpers.js'
import {
  compressImage,
  savePhoto,
  getPhoto,
  deletePhoto,
  newPhotoId,
} from '../lib/photoStorage.js'

function StarIcon({ filled, size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
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

// Sub-component: add/replace/remove front and back photos on an
// already-saved card.
function CardPhotos({ card, onUpdateCard }) {
  const [urls, setUrls] = useState({ front: null, back: null })
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const urlsRef = useRef(urls)
  urlsRef.current = urls
  useEffect(
    () => () => {
      if (urlsRef.current.front) URL.revokeObjectURL(urlsRef.current.front)
      if (urlsRef.current.back) URL.revokeObjectURL(urlsRef.current.back)
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [fBlob, bBlob] = await Promise.all([
        card.frontPhotoId
          ? getPhoto(card.frontPhotoId).catch(() => null)
          : Promise.resolve(null),
        card.backPhotoId
          ? getPhoto(card.backPhotoId).catch(() => null)
          : Promise.resolve(null),
      ])
      if (cancelled) return
      const nextFront = fBlob ? URL.createObjectURL(fBlob) : null
      const nextBack = bBlob ? URL.createObjectURL(bBlob) : null
      setUrls((prev) => {
        if (prev.front && prev.front !== nextFront) URL.revokeObjectURL(prev.front)
        if (prev.back && prev.back !== nextBack) URL.revokeObjectURL(prev.back)
        return { front: nextFront, back: nextBack }
      })
    })()
    return () => {
      cancelled = true
    }
  }, [card.frontPhotoId, card.backPhotoId])

  const fieldFor = (side) =>
    side === 'front' ? 'frontPhotoId' : 'backPhotoId'

  const handleFile = async (side, file) => {
    setBusy(side)
    setError(null)
    try {
      const blob = await compressImage(file).catch(() => file)
      const id = newPhotoId()
      await savePhoto(id, blob)
      const field = fieldFor(side)
      const oldId = card[field]
      onUpdateCard(card.id, { [field]: id })
      if (oldId) deletePhoto(oldId).catch(() => {})
    } catch (err) {
      console.warn('Could not save photo', err)
      setError('Could not save photo. Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const handleRemove = async (side) => {
    const field = fieldFor(side)
    const oldId = card[field]
    if (!oldId) return
    setBusy(side)
    setError(null)
    try {
      onUpdateCard(card.id, { [field]: null })
      deletePhoto(oldId).catch(() => {})
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="pw-photos-section">
      <div className="pw-photos-section-title">Card photos</div>
      <PhotoInput
        label="Front photo"
        previewUrl={urls.front}
        onFileSelected={(f) => handleFile('front', f)}
        onRemove={() => handleRemove('front')}
        busy={busy === 'front'}
      />
      <PhotoInput
        label="Back photo"
        previewUrl={urls.back}
        onFileSelected={(f) => handleFile('back', f)}
        onRemove={() => handleRemove('back')}
        busy={busy === 'back'}
      />
      {error && <p className="pw-error">{error}</p>}
    </div>
  )
}

// Sub-component: the spending tracker.
function SpendingTracker({ card, onDeduct, onUndo, autoFocus }) {
  const [amount, setAmount] = useState('')
  const inputRef = useRef(null)
  const parsed = parseFloat(amount)
  const canDeduct = !isNaN(parsed) && parsed > 0

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [autoFocus])

  const handleDeduct = () => {
    if (!canDeduct) return
    onDeduct(parsed)
    setAmount('')
  }

  const transactions = useMemo(
    () => (card.transactions || []).slice().sort((a, b) => b.date - a.date),
    [card.transactions]
  )

  const sym = balanceSymbol(card.balance)

  return (
    <div className="pw-section" id="pw-spending-tracker">
      <div className="pw-row" style={{ borderBottom: 'none', paddingBottom: 6 }}>
        <div className="pw-row-label">Track spending</div>
      </div>
      <div className="pw-deduct-row">
        <input
          ref={inputRef}
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

function PinRow({ pin }) {
  const [revealed, setRevealed] = useState(false)
  if (!pin) {
    return (
      <div className="pw-row">
        <div className="pw-row-label">PIN</div>
        <div className="pw-row-value" style={{ color: 'rgba(25,18,61,0.4)' }}>
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
          className={'pw-row-value' + (revealed ? '' : ' pw-pin-mask')}
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

const brandLabel = (brand) => {
  if (brand === CARD_BRAND.VISA) return 'Visa'
  if (brand === CARD_BRAND.MASTERCARD) return 'Mastercard'
  return 'Prepaid'
}

// Fullscreen scan view. Opens when the user taps "Scan at register"
// on the detail screen. After 12 seconds it asks the user whether
// they used the card; "Yes" closes the scan view and focuses the
// spending tracker on the underlying detail screen so they can
// deduct an amount immediately.
function FullscreenBarcode({ card, onClose, onUseCard }) {
  const [askUsed, setAskUsed] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setAskUsed(true), 12000)
    return () => clearTimeout(t)
  }, [])

  // Lock body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className="pw-fullscan" role="dialog" aria-modal="true" aria-label="Scan card">
      <button className="pw-fullscan-close" onClick={onClose} aria-label="Close">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>

      <div className="pw-fullscan-merchant">{card.merchant}</div>

      <div className="pw-fullscan-barcode-wrap">
        <Barcode value={card.number} large />
      </div>

      <div className="pw-fullscan-hint">Turn brightness up for easier scanning.</div>

      {askUsed && (
        <div className="pw-fullscan-prompt" role="alertdialog">
          <div className="pw-fullscan-prompt-title">Did you use this card?</div>
          <div className="pw-fullscan-prompt-actions">
            <button
              className="pw-modal-btn primary"
              onClick={() => {
                onUseCard()
              }}
            >
              Yes, deduct amount
            </button>
            <button
              className="pw-modal-btn secondary"
              onClick={() => setAskUsed(false)}
            >
              No
            </button>
          </div>
        </div>
      )}
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
  onUpdateCard,
  onArchive,
  onToggleFavorite,
  onRestore,
}) {
  const balance = cardBalanceDisplay(card)
  const hasBalance = computeBalance(card) !== null
  const openLoop = isOpenLoopCard(card)
  const [scanOpen, setScanOpen] = useState(false)
  const [focusDeduct, setFocusDeduct] = useState(0)

  const currentColor = card.color || defaultColorForCard(card)

  const handleDelete = () => {
    if (confirm('Remove ' + card.merchant + ' from your wallet?')) {
      onDelete(card.id)
    }
  }

  const handleUseCard = () => {
    setScanOpen(false)
    if (hasBalance) {
      // Bumping the counter forces a re-focus even if user opens scan
      // twice in a row and clicks "Yes" both times.
      setFocusDeduct((n) => n + 1)
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
          {card.archived ? 'Archives' : 'Wallet'}
        </button>
        <h2 className="pw-form-title">{card.merchant}</h2>
        <button
          className={'pw-fav-btn' + (card.favorite ? ' is-on' : '')}
          onClick={() => onToggleFavorite(card.id)}
          aria-label={card.favorite ? 'Unfavorite' : 'Favorite'}
          aria-pressed={!!card.favorite}
        >
          <StarIcon filled={!!card.favorite} size={20} />
        </button>
      </div>

      <div className="pw-detail-hero">
        <div
          className="pw-detail-card"
          style={{ background: theme.bg, color: theme.text }}
        >
          {openLoop && (
            <span className="pw-badge pw-badge-on-card">Reference only</span>
          )}
          <h3 className="pw-detail-merchant">{card.merchant}</h3>
          <div>
            <div className="pw-detail-bal-label">Balance</div>
            <div className="pw-detail-bal">{balance || '—'}</div>
          </div>
        </div>
      </div>

      {openLoop && (
        <div className="pw-notice">
          Limited visibility — for your security, Stashly only stores the last 4
          digits of this card. No barcode is generated.
        </div>
      )}

      {hasBalance && (
        <SpendingTracker
          card={card}
          autoFocus={focusDeduct}
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
          <div className="pw-row-value">
            {openLoop ? cardMaskedNumber(card) : formatNumber(card.number)}
          </div>
        </div>
        {!openLoop && <PinRow pin={card.pin} />}
      </div>

      <div className="pw-section">
        <div className="pw-row" style={{ borderBottom: 'none' }}>
          <div className="pw-row-label">Card color</div>
          <ColorPicker
            value={currentColor}
            onChange={(c) => onUpdateCard(card.id, { color: c })}
          />
        </div>
      </div>

      {card.notes && (
        <div className="pw-section">
          <div className="pw-row">
            <div className="pw-row-label">Notes</div>
            <div className="pw-notes-value">{card.notes}</div>
          </div>
        </div>
      )}

      <CardPhotos card={card} onUpdateCard={onUpdateCard} />

      {!openLoop && (
        <button
          className="pw-barcode pw-barcode-cta"
          onClick={() => setScanOpen(true)}
        >
          <div className="pw-barcode-label">Tap to scan at register</div>
          <Barcode value={card.number} />
          <div className="pw-barcode-cta-hint">Opens fullscreen scan view</div>
        </button>
      )}

      <div className="pw-detail-actions">
        {card.archived ? (
          <button
            className="pw-secondary-action"
            onClick={() => onRestore(card.id)}
          >
            Restore card
          </button>
        ) : (
          <button
            className="pw-secondary-action"
            onClick={() => onArchive(card.id)}
          >
            Archive card
          </button>
        )}
        <button className="pw-delete" onClick={handleDelete}>
          Remove card
        </button>
      </div>

      {scanOpen && (
        <FullscreenBarcode
          card={card}
          onClose={() => setScanOpen(false)}
          onUseCard={handleUseCard}
        />
      )}
    </div>
  )
}
