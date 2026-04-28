// components/ConfirmModal.jsx
// Generic two-button confirmation modal. Reuses the same .pw-modal
// styles as the limited-storage / no-photo / confirm-save modals so
// every modal in the app shares the same look.

export default function ConfirmModal({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  destructive = false,
}) {
  return (
    <div
      className="pw-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pw-confirm-modal-title"
      onClick={onCancel}
    >
      <div className="pw-modal" onClick={(e) => e.stopPropagation()}>
        <h3 id="pw-confirm-modal-title" className="pw-modal-title">
          {title}
        </h3>
        {body && <p className="pw-modal-body">{body}</p>}
        <div className="pw-modal-actions">
          <button
            type="button"
            className={'pw-modal-btn ' + (destructive ? 'primary' : 'primary')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="pw-modal-btn secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
