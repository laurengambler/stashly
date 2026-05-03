// lib/helpers.js
// Pure utility functions — no React, no DOM side effects.
// These are the building blocks used across the app.

// Ombre anchor palette. The wallet list renders a smooth top-to-bottom
// gradient built by linearly interpolating between these anchors in the
// order listed — dark indigo at the top, warm cream at the bottom.
//
// #B2F332 from the brand palette is intentionally omitted: its neon
// saturation would create the "harsh / overly bright" transition the
// ombre brief explicitly asks us to avoid. Every anchor below moves
// smoothly in both hue (cool → warm) and lightness (dark → light).
export const GRADIENT_ANCHORS = [
  '#19123D', // deep indigo
  '#6787AF', // dusty blue
  '#BADDCF', // mint
  '#E8F3DA', // pale green
  '#F3EEE8', // cream
]

// --- Gradient math -------------------------------------------------

const hexToRgb = (hex) => {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

const rgbToHex = ([r, g, b]) => {
  const c = (n) => Math.round(n).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}

const lerpColor = (a, b, t) => {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  return rgbToHex([
    ra[0] + (rb[0] - ra[0]) * t,
    ra[1] + (rb[1] - ra[1]) * t,
    ra[2] + (rb[2] - ra[2]) * t,
  ])
}

// Sample the gradient at position ∈ [0,1]. Anchors are evenly spaced,
// so 0 = first anchor, 1 = last, and intermediate positions land
// between two adjacent anchors with a per-segment linear blend.
const sampleGradient = (position) => {
  if (position <= 0) return GRADIENT_ANCHORS[0]
  if (position >= 1) return GRADIENT_ANCHORS[GRADIENT_ANCHORS.length - 1]
  const segments = GRADIENT_ANCHORS.length - 1
  const scaled = position * segments
  const i = Math.floor(scaled)
  return lerpColor(GRADIENT_ANCHORS[i], GRADIENT_ANCHORS[i + 1], scaled - i)
}

// WCAG relative luminance — used to flip to readable text/mono tokens.
const relLuminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const n = c / 255
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Theme for the card at sorted-list index `i` out of `total` cards.
// i = 0 → first anchor, i = total-1 → last anchor, interior indices
// spread evenly between. Text + mono flip automatically based on
// background luminance so contrast stays strong end-to-end.
export const themeAtPosition = (i, total) => {
  const t = total <= 1 ? 0 : i / (total - 1)
  const bg = sampleGradient(t)
  return themeFromColor(bg)
}

// Build a card theme from any solid hex color.
export const themeFromColor = (hex) => {
  const dark = relLuminance(hex) < 0.5
  return {
    bg: hex,
    text: dark ? '#F3EEE8' : '#19123D',
    mono: dark ? 'rgba(255,255,255,0.18)' : 'rgba(25,18,61,0.12)',
  }
}

// User-selectable card color palette.
export const CARD_COLORS = [
  '#BADDCF',
  '#E8F3DA',
  '#6787AF',
  '#19123D',
  '#B2F332',
  '#F3EEE8',
]

// Deterministically pick a default palette color for a card that
// has no `color` field yet (cards saved before color shipped).
// Hashes the id so a given card always gets the same default.
export const defaultColorForCard = (card) => {
  const seed = String((card && card.id) || '')
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return CARD_COLORS[Math.abs(h) % CARD_COLORS.length]
}

// Resolve the theme for any card — explicit color wins, otherwise
// fall back to a stable default from the palette.
export const themeForCard = (card) =>
  themeFromColor(card.color || defaultColorForCard(card))

// Simple ID generators — random enough for a local-only app.
export const uid = () =>
  'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export const txid = () =>
  't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// First 2 letters of merchant name, uppercase.
// "Starbucks" → "ST", "Trader Joe's" → "TJ"
export const monogram = (merchant) => {
  const s = (merchant || '').trim()
  if (!s) return '•'
  const parts = s.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

// Mask all but the last 4 digits on the wallet list view.
export const maskNumber = (num) => {
  const x = (num || '').replace(/\s/g, '')
  if (x.length <= 4) return '•••• ' + x
  return '•••• •••• •••• ' + x.slice(-4)
}

// --- Card classification ------------------------------------------
// Stashly only handles closed-loop *merchant* gift cards fully. Open-
// loop prepaid cards (real Visa/Mastercard networks) are accepted
// under a reference-only flow that never persists the full PAN, PIN,
// expiration, or CVV. These constants are the single source of truth
// for that distinction across the app.

export const CARD_KIND = {
  MERCHANT_GIFT_CARD: 'merchant_gift_card',
  OPEN_LOOP_PREPAID: 'open_loop_prepaid',
}

export const CARD_BRAND = {
  VISA: 'visa',
  MASTERCARD: 'mastercard',
  UNKNOWN: 'unknown',
}

const digitsOnly = (s) => String(s == null ? '' : s).replace(/\D/g, '')

// Luhn (mod-10) checksum — the standard validation used by every
// real Visa/Mastercard PAN. Rejects short strings outright so we
// don't false-positive on a 4-digit merchant code.
export const luhnCheck = (num) => {
  const s = digitsOnly(num)
  if (s.length < 12) return false
  let sum = 0
  let alt = false
  for (let i = s.length - 1; i >= 0; i--) {
    let n = parseInt(s[i], 10)
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

// BIN-prefix brand detection. Works on partial input so callers can
// surface hints as the user types; length + Luhn are checked
// separately by isOpenLoopPrepaid for confident classification.
//   Visa         → starts with 4
//   Mastercard   → starts with 51–55 or 2221–2720 (2-series)
export const detectCardBrand = (num) => {
  const s = digitsOnly(num)
  if (!s) return CARD_BRAND.UNKNOWN
  if (s[0] === '4') return CARD_BRAND.VISA
  if (s.length >= 2) {
    const first2 = parseInt(s.slice(0, 2), 10)
    if (first2 >= 51 && first2 <= 55) return CARD_BRAND.MASTERCARD
  }
  if (s.length >= 4) {
    const first4 = parseInt(s.slice(0, 4), 10)
    if (first4 >= 2221 && first4 <= 2720) return CARD_BRAND.MASTERCARD
  }
  return CARD_BRAND.UNKNOWN
}

// True when the number matches a Visa/Mastercard BIN AND has a valid
// network length AND passes Luhn. This is the gate that triggers the
// limited-storage flow — conservative enough that a random 16-digit
// merchant code starting with "4" won't reach it.
export const isOpenLoopPrepaid = (num) => {
  const brand = detectCardBrand(num)
  if (brand === CARD_BRAND.UNKNOWN) return false
  const s = digitsOnly(num)
  const validLength =
    brand === CARD_BRAND.VISA
      ? s.length === 13 || s.length === 16 || s.length === 19
      : s.length === 16
  return validLength && luhnCheck(s)
}

// Extract the last 4 digits from any input. Safe on short/empty strings.
export const lastFour = (num) => {
  const s = digitsOnly(num)
  return s.length >= 4 ? s.slice(-4) : s
}

// Classify a raw card number at save time.
//   { brand, kind, isOpenLoop, last4 }
export const classifyCardNumber = (num) => {
  if (isOpenLoopPrepaid(num)) {
    return {
      brand: detectCardBrand(num),
      kind: CARD_KIND.OPEN_LOOP_PREPAID,
      isOpenLoop: true,
      last4: lastFour(num),
    }
  }
  return {
    brand: CARD_BRAND.UNKNOWN,
    kind: CARD_KIND.MERCHANT_GIFT_CARD,
    isOpenLoop: false,
    last4: lastFour(num),
  }
}

// Cards saved before the open-loop feature shipped don't have a
// `kind` field — treat them as merchant gift cards so nothing breaks.
export const cardKind = (card) =>
  (card && card.kind) || CARD_KIND.MERCHANT_GIFT_CARD

export const isOpenLoopCard = (card) =>
  cardKind(card) === CARD_KIND.OPEN_LOOP_PREPAID

// Masked display of a card's number for lists and detail views.
// Open-loop cards have no stored PAN, only last4, so they render
// from that field.
export const cardMaskedNumber = (card) => {
  if (isOpenLoopCard(card)) {
    const l4 = (card && card.last4) || ''
    return '•••• •••• •••• ' + l4
  }
  return maskNumber(card && card.number)
}

// Format the full number with spaces every 4 chars for the detail view.
export const formatNumber = (num) =>
  (num || '').replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim()

// --- Currency: single source of truth ------------------------------
// Two helpers, used everywhere. Anything money-shaped that crosses
// into Supabase or comes back out is funnelled through these so we
// never store a formatted string in a numeric column again.

// Sanitize anything the user (or legacy data) might hand us into a
// raw JS number. Strips $, commas, spaces, and any other non-numeric
// junk. Returns null when the input has no usable digits — null is
// the right shape for an empty Postgres numeric column.
//
//   sanitizeCurrencyInput('$65.00')  → 65
//   sanitizeCurrencyInput('1,250.5') → 1250.5
//   sanitizeCurrencyInput(65)        → 65
//   sanitizeCurrencyInput('')        → null
//   sanitizeCurrencyInput(null)      → null
//   sanitizeCurrencyInput('abc')     → null
export const sanitizeCurrencyInput = (value) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = String(value).replace(/[^0-9.\-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = parseFloat(cleaned)
  return Number.isNaN(n) ? null : n
}

// Format a number (or any sanitizable value) for display: "$65.00".
// `fallback` is what to show when there's nothing to format.
export const formatCurrency = (value, { fallback = '' } = {}) => {
  const n = sanitizeCurrencyInput(value)
  if (n === null) return fallback
  return '$' + n.toFixed(2)
}

// Back-compat alias — older code in the codebase still imports this name.
export const balanceNumeric = sanitizeCurrencyInput

// Currency-symbol guess from a (possibly legacy) string. Always returns
// '$' for numeric input or anything we don't recognise. Kept so older
// rows that still hold a "£20.00" string render with the right glyph.
export const balanceSymbol = (b) => {
  if (b === null || b === undefined) return '$'
  if (typeof b !== 'string') return '$'
  const s = b.trim()
  return /^[\$£€¥]/.test(s) ? s.charAt(0) : '$'
}

// Pretty-format a balance for display: "$47.50". Now a thin shim over
// formatCurrency so all formatting goes through one path.
export const formatBalance = (b) => {
  const n = sanitizeCurrencyInput(b)
  if (n === null) return null
  return formatCurrency(n)
}

// Basic HTML escape — used when we inject merchant names anywhere
// that might be dangerous. React already escapes most things by
// default, but this is here for defense in depth.
export const escapeHtml = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Human-readable relative time for transaction entries.
// "Just now", "5 min ago", "Yesterday", then a date after a week.
export const relativeTime = (ts) => {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return m + ' min ago'
  const h = Math.floor(m / 60)
  if (h < 24) return h + 'h ago'
  const days = Math.floor(h / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return days + 'd ago'
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

// Trigger a vibration on supported devices (Android Chrome).
// iOS Safari silently ignores this — that's fine, it's just polish.
export const haptic = (pattern) => {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch (e) {
      // swallow — haptics are best-effort
    }
  }
}

// Given a card, compute its current balance from
// startingBalance - sum(transactions). Floors at 0.
// This is the critical piece that makes undo bulletproof:
// balance is always derived, never stored directly, so removing
// a transaction automatically restores the correct total.
export const computeBalance = (card) => {
  // Tolerant to legacy rows where startingBalance might still be a
  // formatted string like "$65.00" — sanitize before doing math so a
  // bad shape can never crash the wallet.
  const start = sanitizeCurrencyInput(card.startingBalance)
  if (start === null) return null
  const spent = (card.transactions || []).reduce(
    (a, t) => a + (sanitizeCurrencyInput(t.amount) || 0),
    0
  )
  return Math.max(0, start - spent)
}

// Get the display-ready balance string for a card.
export const cardBalanceDisplay = (card) => {
  const n = computeBalance(card)
  if (n === null) return null
  return formatCurrency(n)
}
