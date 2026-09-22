// lib/scanParse.js
// Parsing recognized card text into fields.
//
// Mirrors CardTextParser in ios/App/App/StashScannerPlugin.swift, which is
// what actually runs on device (the live viewfinder has to resolve fields
// frame by frame to highlight them). This copy covers the browser/harness
// path and any scan where the native side returned text but no fields.
// The two must stay in step — test/scanParse.test.mjs is the spec for
// both, so change the tests and both implementations together.
//
// THE LAYOUT PROBLEM. Cards print more than one number on a line:
//
//     Card #1234567890        18934
//
// Two fields, one line. Reducing that line to its digits — which is what
// this used to do — yields 123456789018934: the card number and the PIN
// fused into a number that matches no card. The fix is to treat a wide
// horizontal gap as a field boundary and parse each run separately.
//
// Grouped numbers are the complication, because a card number is often
// printed with gaps of its own:
//
//     1234  5678  9012  3456
//
// So after splitting on wide gaps we re-join neighbouring runs that look
// like one grouped number — equal-length digit groups of at most 5.
// "1234567890" and "18934" have different shapes and stay apart.

// Labels that mean "the number after me is the CARD number". When a card
// says so, believe it over any length heuristic.
const CARD_LABEL = /\b(?:card|acct|account|gift\s*card)\s*(?:#|№|nos?\b|no\.|number|num\b)/i

// Labels that mean "what follows is a PIN". Deliberately narrow: we only
// prefill a PIN the card clearly labels as one, or one that the layout
// makes obvious (see the trailing-run rule in parseCardFields).
const PIN_LABEL = /\b(?:p\s*i\s*n|pin\s*(?:no|number|code|#)|access\s*(?:code|number|#)|security\s*code|scratch\s*(?:off\s*)?code|redemption\s*code)\b[\s:#.\-]*/i

// Two or more spaces is a field boundary, and so is a single tab — one
// tab is one whitespace character but never accidental spacing. A single
// space is grouping inside one number ("6011 5000 1234 5678").
const WIDE_GAP = /\t+|\s{2,}/

const digitsOnly = (s) => (s || '').replace(/\D/g, '')

/**
 * THE GUARD. The only way a scanned value reaches the card-number field.
 *
 * A card number is a single alphanumeric run: no spaces, no punctuation, no
 * label, no sentence. Anything else is rejected outright and the field stays
 * blank — a blank field the user fills in beats a field holding a line of
 * fine print they have to notice and clear.
 *
 * This exists because a value once reached that field as raw recognized
 * line text ("ACCT#: 70123456 789 0123456"), and no amount of care in the
 * parser prevents that on its own: it needs one checkpoint that every
 * candidate passes through.
 *
 * Note this guards SCANNED values only. What the user types is theirs.
 *
 * Mirrors CardTextParser.validatedNumber in the Swift plugin.
 */
export const validatedNumber = (candidate) => {
  const s = String(candidate || '').trim()
  if (!s) return ''
  // One run. This is what raw line text fails on.
  if (!/^[A-Za-z0-9]+$/.test(s)) return ''
  if (s.length < 6 || s.length > 32) return ''
  // Mostly digits — a word that happens to be one run is not a number.
  const d = digitsOnly(s).length
  if (d < 6 || d * 2 < s.length) return ''
  return s
}

// Strip a leading card-number label from a segment, so "ACCT#:70123456"
// does not carry "ACCT" into the value.
const stripCardLabel = (text) => {
  const m = CARD_LABEL.exec(text)
  return m ? text.slice(m.index + m[0].length) : text
}

/**
 * The number printed in a segment.
 *
 * Keeps LETTERS — plenty of gift cards end in one ("41230-8856-2274Q") and
 * dropping it produces a number that will not redeem — and closes up the
 * separators a card prints inside its number (dashes, spaces). Tokens
 * carrying no digit at all are labels or words, and are dropped, so
 * "Call 18005550199" yields the number and not "Call18005550199".
 */
const numberValue = (text) =>
  stripCardLabel(String(text || ''))
    .split(/\s+/)
    .filter((t) => /\d/.test(t))
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    .join('')

// A plausible PIN: 3-10 alphanumerics, mostly digits. Longer runs are
// card numbers.
const isPlausiblePin = (raw) => {
  const s = (raw || '').trim()
  if (!/^[A-Za-z0-9]{3,10}$/.test(s)) return false
  const digits = (s.match(/\d/g) || []).length
  return digits >= 3 && digits * 2 >= s.length
}

// If `s` is nothing but equal-length digit groups of at most 5 ("1234",
// "1234 5678"), return that group length; otherwise 0. This is what tells
// a chopped-up card number from a genuinely separate field.
const groupLength = (s) => {
  if (!/^\d+( \d+)*$/.test(s)) return 0
  const parts = s.split(' ')
  const n = parts[0].length
  if (n > 5) return 0
  return parts.every((p) => p.length === n) ? n : 0
}

/**
 * Split one visual line into fields at wide gaps, then re-join runs that
 * are really one grouped number.
 */
export const segmentLine = (line) => {
  const raw = String(line || '')
    .split(WIDE_GAP)
    .map((s) => s.trim())
    .filter(Boolean)

  const out = []
  for (const seg of raw) {
    const g = groupLength(seg)
    const prev = out[out.length - 1]
    if (g && prev && groupLength(prev) === g) {
      out[out.length - 1] = `${prev} ${seg}`
    } else {
      out.push(seg)
    }
  }
  return out
}

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

/**
 * Resolve the card number and PIN from recognized text.
 *
 * `textLines` must be VISUAL lines — everything printed across one line of
 * the card, wide gaps preserved. Both native paths build them that way
 * from bounding boxes so they segment identically; see visualLines() in
 * StashScannerPlugin.swift.
 *
 * Precedence for the number:
 *   1. a run the card LABELS "Card #" / "ACCT#" / "Card number"
 *   2. a barcode payload
 *   3. the longest remaining digit run on the card
 *
 * The label outranks the barcode because a gift-card barcode routinely
 * encodes something that is not the card number — a retail UPC plus an
 * internal serial, for instance. That is the right thing to scan at a
 * register and the wrong thing to show as the number, so the barcode is
 * kept separately as barcodeValue rather than shown.
 *
 * Precedence for the PIN:
 *   1. a labeled PIN
 *   2. a separate, shorter run sitting after the number on the same line
 *
 * Returns { number, pin, numberFromLabel }.
 */
export const parseCardFields = (textLines = [], barcode = '') => {
  const lines = (textLines || [])
    .map((l) => String(l || '').trim())
    .filter(Boolean)

  // Flatten to positioned segments so we can reason about "later on the
  // same line", which is what makes the trailing run a PIN.
  const segs = []
  lines.forEach((line, lineIndex) => {
    segmentLine(line).forEach((text, pos) => {
      segs.push({ text, digits: digitsOnly(text), lineIndex, pos })
    })
  })

  const isCardLabeled = (i) => {
    const s = segs[i]
    if (CARD_LABEL.test(s.text)) return true
    // "Card #" can also sit in its own segment before the digits.
    const prev = segs[i - 1]
    return !!(
      prev &&
      prev.lineIndex === s.lineIndex &&
      !prev.digits &&
      CARD_LABEL.test(prev.text)
    )
  }

  const pinLabeled = detectPin(lines, '')
  const pinLabeledDigits = digitsOnly(pinLabeled)

  // Resolve the number from the text even when a barcode is present: the
  // barcode wins as the value, but we still need to know WHERE on the card
  // the number sits to spot a trailing PIN beside it.
  let numberSeg = null
  let numberFromLabel = false // reassigned below once the label candidate is validated

  const labeledIndex = segs.findIndex(
    (s, i) => s.digits.length >= 6 && isCardLabeled(i)
  )
  if (labeledIndex >= 0) {
    numberSeg = segs[labeledIndex]
    numberFromLabel = true
  } else {
    for (const s of segs) {
      if (s.digits.length < 8) continue
      if (pinLabeledDigits && s.digits === pinLabeledDigits) continue
      if (!numberSeg || s.digits.length > numberSeg.digits.length) numberSeg = s
    }
  }

  // Precedence. A card that LABELS its number is telling us outright, and
  // it outranks the barcode: a gift-card barcode routinely encodes
  // something else entirely — a retail UPC plus an internal serial, say —
  // which is the right thing to scan at a register and the wrong thing to
  // show as the card number. The barcode is kept as barcodeValue so
  // register scanning still works.
  const labeledCandidate = numberSeg && numberFromLabel ? numberValue(numberSeg.text) : ''
  const labeled = validatedNumber(labeledCandidate)

  let candidate
  if (labeled) candidate = labeled
  else if (barcode) candidate = String(barcode)
  else if (numberSeg) candidate = numberValue(numberSeg.text)
  else candidate = ''

  const number = validatedNumber(candidate)
  const rejectedNumber = !number && candidate ? candidate : ''
  numberFromLabel = !!labeled

  let pin = pinLabeled
  if (!pin && numberSeg) {
    // A separate, shorter run after the number on the same line. On a card
    // reading "Card #1234567890   18934" this is the PIN, and it is the
    // only thing distinguishing it from part of the number.
    const trailing = segs.find(
      (s) =>
        s.lineIndex === numberSeg.lineIndex &&
        s.pos > numberSeg.pos &&
        s.digits.length >= 3 &&
        s.digits.length <= 10 &&
        s.digits.length < numberSeg.digits.length
    )
    if (trailing) pin = trailing.digits
  }

  if (pin && number && digitsOnly(pin) === digitsOnly(number)) pin = ''

  return { number, pin, numberFromLabel, rejectedNumber }
}
