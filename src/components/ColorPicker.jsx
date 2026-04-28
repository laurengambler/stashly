// components/ColorPicker.jsx
// A tiny swatch picker for card colors. Renders the fixed Stashly
// palette as rounded pills; the selected swatch gets a check + ring.

import { CARD_COLORS } from '../lib/helpers.js'

const isLight = (hex) => {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return r * 0.299 + g * 0.587 + b * 0.114 > 160
}

export default function ColorPicker({ value, onChange }) {
  return (
    <div className="pw-colors" role="radiogroup" aria-label="Card color">
      {CARD_COLORS.map((c) => {
        const selected = value === c
        return (
          <button
            type="button"
            key={c}
            role="radio"
            aria-checked={selected}
            aria-label={'Color ' + c}
            className={'pw-color-swatch' + (selected ? ' selected' : '')}
            style={{ background: c }}
            onClick={() => onChange(c)}
          >
            {selected && (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke={isLight(c) ? '#19123D' : '#F3EEE8'}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12l5 5L20 7" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}
