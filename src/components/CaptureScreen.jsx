// components/CaptureScreen.jsx
// The instant front door for adding a card — no form. Two capture
// entrances (live scan, photo library) plus a quiet manual fallback.
// Presentational only: AddCardFlow owns the scan + routing logic.

export default function CaptureScreen({
  savedCount = 0,
  busy = false,
  onScan,
  onPhotos,
  onManual,
  onDone,
  onCancel,
}) {
  return (
    <div className="pw-screen active pw-capture">
      <div className="pw-form-header">
        <button className="pw-nav" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <h2 className="pw-form-title">Add a card</h2>
        <span style={{ minWidth: 44 }} />
      </div>

      <div className="pw-capture-body">
        <h1 className="pw-capture-headline">
          {savedCount > 0 ? (
            <>Nice — <em>{savedCount}</em> added.</>
          ) : (
            <>Point, and it's <em>saved</em>.</>
          )}
        </h1>
        <p className="pw-capture-sub">
          {savedCount > 0
            ? 'Scan the next card, or finish up.'
            : 'Scan a card or pick a screenshot — Stashly reads the name and number for you.'}
        </p>

        <button
          type="button"
          className="pw-capture-primary"
          onClick={onScan}
          disabled={busy}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
            <path d="M3 12h18" />
          </svg>
          Scan card
        </button>

        <button
          type="button"
          className="pw-capture-secondary"
          onClick={onPhotos}
          disabled={busy}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          From photos
        </button>

        {savedCount > 0 && (
          <button type="button" className="pw-capture-done" onClick={onDone} disabled={busy}>
            Done — see my wallet
          </button>
        )}

        <button type="button" className="pw-capture-manual" onClick={onManual} disabled={busy}>
          Enter manually instead
        </button>
      </div>
    </div>
  )
}
