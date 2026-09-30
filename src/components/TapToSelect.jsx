// components/TapToSelect.jsx
// The low-confidence path: show the captured card with every recognized
// run boxed, and let the user point at the card number, then the PIN.
//
// This exists because the alternative to guessing is not an empty field —
// it is asking. When several runs on a card could be the number, filling
// one in is a coin flip the user then has to notice and undo. Pointing at
// it is two taps and is always right.
//
// Deliberately NOT a separate step: it renders in place of the confirm
// screen's photo, with the fields still below and still editable. A user
// who ignores it entirely can type as before, so this adds no required
// step to the add-card flow.
//
// Box coordinates arrive normalized to the image (0..1, top-left origin)
// from CardTextParser.TextBox, so they overlay the photo without anyone
// needing to know its pixel size.

import { useState } from 'react'

export default function TapToSelect({
  photoUrl,
  boxes = [],
  onPick,
  onDismiss,
  askPin = true,
}) {
  // 'number' -> 'pin' -> null (done/dismissed)
  const [asking, setAsking] = useState('number')
  const [picked, setPicked] = useState({})

  if (!photoUrl || !boxes.length || !asking) return null

  const handleTap = (box) => {
    onPick?.(asking, box.text)
    setPicked((p) => ({ ...p, [asking]: box.text }))
    if (asking === 'number' && askPin) setAsking('pin')
    else finish()
  }

  const finish = () => {
    setAsking(null)
    onDismiss?.()
  }

  return (
    <div className="pw-tapselect">
      <div className="pw-tapselect-prompt">
        <span>
          {asking === 'number'
            ? 'Tap the card number on the photo'
            : 'Now tap the PIN, if the card has one'}
        </span>
        <button type="button" className="pw-tapselect-skip" onClick={finish}>
          {asking === 'number' ? 'Skip' : 'No PIN'}
        </button>
      </div>

      <div className="pw-tapselect-photo">
        <img src={photoUrl} alt="Captured card" />
        {boxes.map((b, i) => {
          const isPicked = Object.values(picked).includes(b.text)
          return (
            <button
              key={`${b.text}-${i}`}
              type="button"
              className={`pw-tapselect-box${isPicked ? ' picked' : ''}`}
              style={{
                left: `${b.x * 100}%`,
                top: `${b.y * 100}%`,
                width: `${b.w * 100}%`,
                height: `${b.h * 100}%`,
              }}
              onClick={() => handleTap(b)}
              aria-label={`Use ${b.text} as the ${asking === 'number' ? 'card number' : 'PIN'}`}
            />
          )
        })}
      </div>
    </div>
  )
}
