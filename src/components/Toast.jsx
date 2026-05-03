// components/Toast.jsx
// Small transient message that slides up from the bottom.
// Parent controls visibility via the `visible` prop and clears the
// message a moment after `visible` flips to false, so the slide-out
// transition can finish before the node unmounts.

export default function Toast({ message, visible }) {
  // Render nothing when the toast is fully idle. This is a hard
  // guarantee that an inactive toast can never be partially visible —
  // even if a CSS rule somewhere else gets out of sync with the
  // off-screen transform.
  if (!message && !visible) return null
  if (!message) return null
  return (
    <div className={'pw-toast' + (visible ? ' show' : '')} role="status" aria-live="polite">
      {message}
    </div>
  )
}
