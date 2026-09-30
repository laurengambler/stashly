// lib/cardEvents.js
// Helpers that shape card analytics properties.
//
// These exist as their own module because they encode a privacy guarantee —
// a card number or PIN must never reach an event — and a guarantee that is
// not tested is a hope. See test/cardEvents.test.mjs.

import { luhnCheck } from './helpers.js'

/**
 * Luhn validity of a saved card number, as a BOOLEAN — never the number.
 * Returns null when there is nothing to check: open-loop cards store only
 * last4, and a card can be saved with no number at all.
 *
 * A SIGNAL, NOT A VERDICT. Plenty of closed-loop gift cards are not
 * Luhn-valid — many merchants use their own numbering scheme — so `false`
 * does not mean "wrong" and the aggregate pass rate across all cards is
 * meaningless. It reads only per merchant, as a shift over time within one
 * merchant's cards. That is what merchant_known on the same event is for.
 */
export const luhnSignal = (card) => {
  const n = card?.number
  if (n == null || !String(n).trim()) return null
  return luhnCheck(n)
}

// The fields the edit form can change. Anything outside this list is
// ignored rather than guessed at, so a new field cannot silently start
// appearing in events.
export const EDITABLE_FIELDS = [
  'merchant',
  'number',
  'pin',
  'notes',
  'color',
  'startingBalance',
]

/**
 * The NAMES of fields an edit changed, and only the names.
 *
 * This is how a card number corrected days after the fact becomes visible:
 * a scan that was wrong and got saved anyway, which scanned_value_edited
 * cannot see because the user did not catch it on the confirm screen.
 * Knowing THAT the number changed is the entire signal — what it changed to
 * is the user's data and stays on the device.
 */
export const changedFieldNames = (before, updates) => {
  if (!before || !updates) return []
  return EDITABLE_FIELDS.filter((f) => {
    if (!(f in updates)) return false
    const a = before[f] == null ? '' : String(before[f]).trim()
    const b = updates[f] == null ? '' : String(updates[f]).trim()
    return a !== b
  })
}
