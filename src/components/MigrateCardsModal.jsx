// components/MigrateCardsModal.jsx
// Shown once after login when localStorage still has cards from the
// pre-account era. The user picks "move them in" or "not now" — only
// "move them in" uploads anything to Supabase. "Not now" simply hides
// the prompt for this session and leaves the local data alone.

export default function MigrateCardsModal({ count, busy, onMigrate, onSkip }) {
  return (
    <div
      className="pw-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-migrate-title"
    >
      <div className="pw-modal">
        <h3 id="pw-migrate-title" className="pw-modal-title">
          Move your saved cards in?
        </h3>
        <p className="pw-modal-body">
          We found {count} {count === 1 ? 'card' : 'cards'} saved on this device
          from before you had an account. Want to move {count === 1 ? 'it' : 'them'}{' '}
          into your Stashly account so {count === 1 ? "it's" : "they're"} backed
          up and synced?
        </p>
        <div className="pw-modal-actions">
          <button
            type="button"
            className="pw-modal-btn primary"
            onClick={onMigrate}
            disabled={busy}
          >
            {busy ? 'Moving…' : 'Move them in'}
          </button>
          <button
            type="button"
            className="pw-modal-btn secondary"
            onClick={onSkip}
            disabled={busy}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
