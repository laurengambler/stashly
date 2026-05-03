// components/PhotoViewerModal.jsx
// Fullscreen viewer for a single saved card photo. The actual storage
// + replace + delete logic still lives in CardDetailScreen's CardPhotos
// component — this modal just surfaces the existing handlers behind a
// big tap target. A hidden file input drives the "Replace" action so
// we don't duplicate any picker logic from PhotoInput.

import { useEffect, useRef } from 'react'

export default function PhotoViewerModal({
  imageUrl,
  title,
  busy,
  onClose,
  onReplaceFile,
  onRemove,
}) {
  const pickerRef = useRef(null)

  // Lock body scroll while the viewer is open so swipes don't bleed
  // through to the underlying detail screen.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Close on Escape so desktop users can dismiss without reaching for
  // the X button.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const openPicker = () => {
    if (pickerRef.current) pickerRef.current.click()
  }

  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (file) onReplaceFile(file)
  }

  return (
    <div
      className="pw-photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Card photo'}
    >
      <div className="pw-photo-viewer-bar">
        <h3 className="pw-photo-viewer-title">{title || 'Photo'}</h3>
        <button
          type="button"
          className="pw-photo-viewer-close"
          onClick={onClose}
          aria-label="Close"
          disabled={busy}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="pw-photo-viewer-stage">
        {imageUrl && (
          <img src={imageUrl} alt={title || 'Card photo'} className="pw-photo-viewer-img" />
        )}
      </div>

      <div className="pw-photo-viewer-actions">
        <button
          type="button"
          className="pw-modal-btn pw-photo-viewer-replace"
          onClick={openPicker}
          disabled={busy}
        >
          Replace photo
        </button>
        <button
          type="button"
          className="pw-modal-btn pw-photo-viewer-remove"
          onClick={onRemove}
          disabled={busy}
        >
          Remove photo
        </button>
      </div>

      {busy && <div className="pw-photo-viewer-busy">Working…</div>}

      <input
        ref={pickerRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}
