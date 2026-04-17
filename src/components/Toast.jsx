// components/Toast.jsx
// Small transient message that slides up from the bottom.
// Parent controls whether it's visible via the `message` prop.

export default function Toast({ message, visible }) {
  return (
    <div className={'pw-toast' + (visible ? ' show' : '')}>
      {message}
    </div>
  )
}
