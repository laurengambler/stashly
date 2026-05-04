// lib/cardsApi.js
// Single boundary between the React app (camelCase, in-memory) and
// Supabase (snake_case, on-the-wire). Every read goes through
// cardFromDb; every write goes through cardToInsert / updatesToDb.
// This is the only file in the codebase that knows real column names.
//
// Schema this file is paired with — see the SQL in CHANGELOG-style
// reconciliation block:
//   public.cards columns the app touches:
//     id, user_id, merchant, brand, kind,
//     card_number, pin, access_code, last4,
//     starting_balance, current_balance, balance,
//     nickname, notes, color,
//     barcode_value, barcode_format,
//     front_photo_id, back_photo_id,
//     is_favorite, is_archived, favorite, archived,
//     transactions, created_at, updated_at
//
// Two boolean pairs (favorite / is_favorite, archived / is_archived)
// are kept mirrored on every write so the table stays consistent
// regardless of which name a downstream tool reads from. On read we
// prefer the un-prefixed name and fall back to the is_* sibling.

import { supabase } from './supabase.js'
import { sanitizeCurrencyInput } from './helpers.js'

// --- Helpers ------------------------------------------------------

// Live balance = starting_balance − sum(transactions). The single
// place this is computed for the wire so cardToInsert / updatesToDb
// stay in sync with what the UI shows.
const deriveCurrentBalance = (startingBalance, transactions) => {
  const start = sanitizeCurrencyInput(startingBalance)
  if (start === null) return null
  const txs = Array.isArray(transactions) ? transactions : []
  const spent = txs.reduce(
    (a, t) => a + (sanitizeCurrencyInput(t?.amount) || 0),
    0
  )
  return Math.max(0, start - spent)
}

// Pick the truthy value out of either of two boolean columns. Used
// to load rows that pre-date the dual-column scheme.
const eitherBool = (a, b) => !!(a ?? b ?? false)

// --- Shape mapping -------------------------------------------------

// Database row → in-memory card the UI expects.
export const cardFromDb = (row) => ({
  id: row.id,
  userId: row.user_id || null,
  kind: row.kind,
  brand: row.brand,
  merchant: row.merchant,
  number: row.card_number || '',
  pin: row.pin || '',
  accessCode: row.access_code || '',
  last4: row.last4 || '',
  // All numeric columns sanitized so a legacy "$65.00" string still
  // becomes 65 on the JS side.
  startingBalance: sanitizeCurrencyInput(row.starting_balance),
  currentBalance: sanitizeCurrencyInput(row.current_balance),
  balance: sanitizeCurrencyInput(row.balance),
  nickname: row.nickname || '',
  notes: row.notes || '',
  color: row.color || null,
  barcodeValue: row.barcode_value || '',
  barcodeFormat: row.barcode_format || '',
  transactions: Array.isArray(row.transactions) ? row.transactions : [],
  // Prefer the un-prefixed flag, fall back to is_* if a row only has that.
  favorite: eitherBool(row.favorite, row.is_favorite),
  archived: eitherBool(row.archived, row.is_archived),
  frontPhotoId: row.front_photo_id || null,
  backPhotoId: row.back_photo_id || null,
  createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
})

// In-memory card → INSERT payload. id is omitted so Postgres
// generates the UUID. Boolean pairs are mirrored.
export const cardToInsert = (card, userId) => {
  const startingBalance = sanitizeCurrencyInput(card.startingBalance)
  // current_balance and balance both seed from starting_balance at
  // creation time so the row reads consistently before any spend.
  const initialCurrent =
    sanitizeCurrencyInput(card.currentBalance) ??
    deriveCurrentBalance(startingBalance, card.transactions) ??
    startingBalance

  const fav = !!card.favorite
  const arch = !!card.archived

  return {
    user_id: userId,
    kind: card.kind || 'merchant_gift_card',
    brand: card.brand || 'unknown',
    merchant: card.merchant || '',
    card_number: card.number || null,
    pin: card.pin || null,
    access_code: card.accessCode || null,
    last4: card.last4 || null,
    starting_balance: startingBalance,
    current_balance: initialCurrent,
    balance: sanitizeCurrencyInput(card.balance) ?? startingBalance,
    nickname: card.nickname || null,
    notes: card.notes || null,
    color: card.color || null,
    // Default the barcode value to the merchant gift card number so
    // existing barcodes keep rendering even before any UI lets the
    // user customise it.
    barcode_value: card.barcodeValue || card.number || null,
    barcode_format: card.barcodeFormat || null,
    front_photo_id: card.frontPhotoId || null,
    back_photo_id: card.backPhotoId || null,
    transactions: card.transactions || [],
    favorite: fav,
    is_favorite: fav,
    archived: arch,
    is_archived: arch,
  }
}

// Map JS field name → DB column name. Fields not in this map are
// dropped from updates rather than guessed at, so a typo in a
// component never hits the wire as an unknown column.
const FIELD_MAP = {
  merchant:      'merchant',
  brand:         'brand',
  kind:          'kind',
  number:        'card_number',
  pin:           'pin',
  accessCode:    'access_code',
  last4:         'last4',
  balance:       'balance',
  startingBalance: 'starting_balance',
  currentBalance:  'current_balance',
  nickname:      'nickname',
  notes:         'notes',
  color:         'color',
  barcodeValue:  'barcode_value',
  barcodeFormat: 'barcode_format',
  frontPhotoId:  'front_photo_id',
  backPhotoId:   'back_photo_id',
  transactions:  'transactions',
  // favorite / archived are handled specially below to mirror their is_* siblings.
}

const NUMERIC_KEYS = new Set([
  'balance',
  'startingBalance',
  'currentBalance',
])

export const updatesToDb = (updates, fullCard = null) => {
  const out = {}

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'favorite') {
      const v = !!value
      out.favorite = v
      out.is_favorite = v
      continue
    }
    if (key === 'archived') {
      const v = !!value
      out.archived = v
      out.is_archived = v
      continue
    }
    const dbKey = FIELD_MAP[key]
    if (!dbKey) continue
    out[dbKey] = NUMERIC_KEYS.has(key) ? sanitizeCurrencyInput(value) : value
  }

  // If the update touches transactions or starting_balance, recompute
  // current_balance + balance so the cached numeric columns track the
  // derived value. We need the current state of the card to do this
  // safely (the caller passes it as `fullCard`).
  if (fullCard && ('transactions' in updates || 'startingBalance' in updates)) {
    const nextStart =
      'startingBalance' in updates
        ? sanitizeCurrencyInput(updates.startingBalance)
        : sanitizeCurrencyInput(fullCard.startingBalance)
    const nextTx =
      'transactions' in updates ? updates.transactions : fullCard.transactions
    const nextCurrent = deriveCurrentBalance(nextStart, nextTx)
    out.current_balance = nextCurrent
    out.balance = nextCurrent
  }

  return out
}

// --- Logging ------------------------------------------------------

const logErr = (label, err, extra = {}) => {
  console.error(`[${label}]`, {
    code: err?.code,
    message: err?.message,
    details: err?.details,
    hint: err?.hint,
    ...extra,
    error: err,
  })
}

// --- CRUD ----------------------------------------------------------

export const fetchCards = async () => {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    logErr('fetchCards', error)
    throw error
  }
  return (data || []).map(cardFromDb)
}

export const insertCard = async (card, userId) => {
  const payload = cardToInsert(card, userId)
  console.log('[insertCard] payload →', payload)
  const { data, error } = await supabase
    .from('cards')
    .insert(payload)
    .select()
    .single()
  if (error) {
    logErr('insertCard', error, { payload })
    throw error
  }
  return cardFromDb(data)
}

export const insertManyCards = async (cards, userId) => {
  if (!cards.length) return []
  const payload = cards.map((c) => cardToInsert(c, userId))
  console.log('[insertManyCards] payload →', payload)
  const { data, error } = await supabase
    .from('cards')
    .insert(payload)
    .select()
  if (error) {
    logErr('insertManyCards', error, { count: payload.length })
    throw error
  }
  return (data || []).map(cardFromDb)
}

export const updateCard = async (id, updates, fullCard = null) => {
  const payload = updatesToDb(updates, fullCard)
  if (!Object.keys(payload).length) return null
  console.log('[updateCard] id =', id, 'payload →', payload)
  const { data, error } = await supabase
    .from('cards')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) {
    logErr('updateCard', error, { id, payload })
    throw error
  }
  return cardFromDb(data)
}

export const deleteCard = async (id) => {
  const { error } = await supabase.from('cards').delete().eq('id', id)
  if (error) {
    logErr('deleteCard', error, { id })
    throw error
  }
}
