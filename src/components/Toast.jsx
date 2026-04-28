// components/Toast.jsx
// Small transient message that slides up from the bottom.
// Parent controls whether it's visible via the `message` prop.

export default function Toast({ message, visible }) {
  // Don't render the pill at all on first mount (empty message).
  // Otherwise the empty pill is short enough that its resting
  // translateY(120%) still leaves a sliver of navy peeking above
  // the viewport bottom — visible as a dot/oval at center.
  if (!message) return null
  return (
    <div className={'pw-toast' + (visible ? ' show' : '')}>
      {message}
    </div>
  )
}
