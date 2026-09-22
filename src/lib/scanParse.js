// lib/scanParse.js
// Parsing recognized card text into fields, for the cases the native
// plugin didn't already resolve.
//
// The native scanner does its own extraction (it has to — the live
// viewfinder highlights fields as you frame the card), so on device
// `scan.pin` normally arrives already filled. This module is the
// fallback: the browser/harness path, and any scan where the native
// side found text but no PIN.

// Labels that mean "the thing after me is a PIN". Deliberately narrow:
// we only prefill a PIN that the card itself clearly labels as one.
// Anything vaguer stays unfilled — a wrong PIN is worse than no PIN.
const PIN_LABEL = /\b(?:p\s*i\s*n|pin\s*(?:no|number|code|#)|access\s*(?:code|number|#)|security\s*code|scratch\s*(?:off\s*)?code|redemption\s*code)\b[\s:#.\-]*/i

// A plausible PIN: 3-10 alphanumerics, mostly digits. Long runs are
// card numbers, not PINs.
const isPlausiblePin = (raw) => {
  const s = (raw || '').trim()
  if (!/^[A-Za-z0-9]{3,10}$/.test(s)) return false
  const digits = (s.match(/\d/g) || []).length
  return digits >= 3 && digits * 2 >= s.length
}

const digitsOnly = (s) => (s || '').replace(/\D/g, '')

/**
 * Find a clearly labeled PIN in recognized text.
 *
 * Looks for a PIN label and takes the code that follows it, either on the
 * same line ("PIN: 4821") or as the whole of the next line, which is how
 * it usually lands when the label sits above a scratch-off panel.
 *
 * `excludeNumber` guards against returning the card number itself when a
 * card prints "PIN" near the long number.
 *
 * Returns the PIN string, or '' when nothing is clearly labeled.
 */
export const detectPin = (textLines = [], excludeNumber = '') => {
  const lines = (textLines || []).map((l) => String(l || '').trim())
  const exclude = digitsOnly(excludeNumber)

  for (let i = 0; i < lines.length; i++) {
    const m = PIN_LABEL.exec(lines[i])
    if (!m) continue

    // Same line, after the label: "PIN 4821" / "Access Code: 93117".
    // Take the WHOLE alphanumeric run and let isPlausiblePin judge it —
    // capping the match at 10 characters here would silently truncate a
    // 16-digit card number into something that looks like a valid PIN.
    const rest = lines[i].slice(m.index + m[0].length).trim()
    const inline = (rest.match(/^[A-Za-z0-9]+/) || [])[0]
    if (inline && isPlausiblePin(inline)) {
      if (!exclude || digitsOnly(inline) !== exclude) return inline
    }

    // Otherwise the next line, if it is nothing but a code.
    const next = lines[i + 1]
    if (next && isPlausiblePin(next)) {
      if (!exclude || digitsOnly(next) !== exclude) return next
    }
  }

  return ''
}
