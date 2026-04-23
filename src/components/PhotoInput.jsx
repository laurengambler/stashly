// components/PhotoInput.jsx
// A self-contained slot for a single card photo (front or back).
// Presentation-only — the parent owns the actual blob/URL lifecycle
// and decides what to do when a new file is picked or the photo is
// removed. Used from both AddCardScreen (pending photos) and
// CardDetailScreen (photos already saved to IndexedDB).

import { useRef } from 'react'

export default function PhotoInput({
  label,
  addLabel = 'Add Photo',
  previewUrl,
  onFileSelected,
  onRemove,
  busy,
}) {
  // One hidden input with no `capture` attribute — on iOS and
  // Android this surfaces the native sheet that lets the user pick
  // either the camera or the photo library.
  const pickerRef = useRef(null)

  const openPicker = () => {
    if (pickerRef.current) pickerRef.current.click()
  }

  const handleChange = (e) => {
    const file = e.target.files && e.target.files[0]
    // Reset so picking the same file twice still fires onChange.
    e.target.value = ''
    if (file) onFileSelected(file)
  }

  return (
    <div className="pw-photo-slot">
      {label && <div className="pw-photo-slot-label">{label}</div>}

      {previewUrl ? (
        <div className="pw-photo-preview-wrap">
          <img
            src={previewUrl}
            alt={label || addLabel}
            className="pw-photo-preview-img"
          />
          <div className="pw-photo-actions">
            <button
              type="button"
              className="pw-photo-btn pw-photo-btn-replace"
              onClick={openPicker}
              disabled={busy}
            >
              Replace
            </button>
            <button
              type="button"
              className="pw-photo-remove"
              onClick={onRemove}
              disabled={busy}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="pw-photo-btn pw-photo-btn-add"
          onClick={openPicker}
          disabled={busy}
        >
          {addLabel}
        </button>
      )}

      <input
        ref={pickerRef}
        type="file"
        accept="image/*"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}
