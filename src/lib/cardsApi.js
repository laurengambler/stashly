// lib/cardsApi.js
// All Supabase reads/writes for the `cards` table live here. Two
// helpers translate between the camelCase shape the React components
// already use and the snake_case columns Postgres expects, so the
// rest of the app stays identical to the localStorage version.
//
// Photos are intentionally NOT moved to Supabase — they continue to
// live locally in IndexedDB (see lib/photoStorage.js). Only the
// photo IDs are stored on the row.

import { supabase } from './supabase.js'
import { sanitizeCurrencyInput } from './helpers.js'

// --- Shape mapping -------------------------------------------------

// Database row → in-memory card object the UI expects.
// Numeric columns are passed through sanitizeCurrencyInput so a row
// that still contains a legacy string ("$65.00") in `balance` is
// silently coerced to a number — nothing further down the pipe has
// to think about it.
export const cardFromDb = (row) => ({
  id: row.id,
  kind: row.kind,
  brand: row.brand,
  merchant: row.merchant,
  number: row.card_number || '',
  pin: row.pin || '',
  last4: row.last4 || '',
  balance: sanitizeCurrencyInput(row.balance),
  startingBalance: sanitizeCurrencyInput(row.starting_balance),
  transactions: Array.isArray(row.transactions) ? row.transactions : [],
  notes: row.notes || '',
  color: row.color || null,
  favorite: !!row.favorite,
  archived: !!row.archived,
  frontPhotoId: row.front_photo_id || null,
  backPhotoId: row.back_photo_id || null,
  createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
})

// In-memory card → row payload for INSERT (omits id so Postgres
// can generate the UUID for us). user_id is stamped by the caller.
// Numeric columns go through sanitizeCurrencyInput as the last gate
// before the database — even if a "$" string sneaks through from
// somewhere upstream, Postgres only ever sees a number-or-null.
export const cardToInsert = (card, userId) => ({
  user_id: userId,
  kind: card.kind || 'merchant_gift_card',
  brand: card.brand || 'unknown',
  merchant: card.merchant || '',
  card_number: card.number || null,
  pin: card.pin || null,
  last4: card.last4 || null,
  balance: sanitizeCurrencyInput(card.balance),
  starting_balance: sanitizeCurrencyInput(card.startingBalance),
  transactions: card.transactions || [],
  notes: card.notes || null,
  color: card.color || null,
  favorite: !!card.favorite,
  archived: !!card.archived,
  front_photo_id: card.frontPhotoId || null,
  back_photo_id: card.backPhotoId || null,
})

// Partial in-memory updates → snake_case column updates. Only the
// keys the caller passed in are forwarded, so Supabase only writes
// what actually changed.
const FIELD_MAP = {
  merchant: 'merchant',
  brand: 'brand',
  kind: 'kind',
  number: 'card_number',
  pin: 'pin',
  last4: 'last4',
  balance: 'balance',
  startingBalance: 'starting_balance',
  transactions: 'transactions',
  notes: 'notes',
  color: 'color',
  favorite: 'favorite',
  archived: 'archived',
  frontPhotoId: 'front_photo_id',
  backPhotoId: 'back_photo_id',
}

// Columns that must be a number (or null) in Postgres. Any update
// touching one of these is coerced through sanitizeCurrencyInput so
// a stray "$65.00" can never reach the wire.
const NUMERIC_KEYS = new Set(['balance', 'startingBalance'])

export const updatesToDb = (updates) => {
  const out = {}
  for (const [key, value] of Object.entries(updates)) {
    const dbKey = FIELD_MAP[key]
    if (!dbKey) continue
    out[dbKey] = NUMERIC_KEYS.has(key) ? sanitizeCurrencyInput(value) : value
  }
  return out
}

// --- CRUD ----------------------------------------------------------

export const fetchCards = async () => {
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map(cardFromDb)
}

export const insertCard = async (card, userId) => {
  const payload = cardToInsert(card, userId)
  const { data, error } = await supabase
    .from('cards')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return cardFromDb(data)
}

export const insertManyCards = async (cards, userId) => {
  if (!cards.length) return []
  const payload = cards.map((c) => cardToInsert(c, userId))
  const { data, error } = await supabase
    .from('cards')
    .insert(payload)
    .select()
  if (error) throw error
  return (data || []).map(cardFromDb)
}

export const updateCard = async (id, updates) => {
  const payload = updatesToDb(updates)
  if (!Object.keys(payload).length) return null
  const { data, error } = await supabase
    .from('cards')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return cardFromDb(data)
}

export const deleteCard = async (id) => {
  const { error } = await supabase.from('cards').delete().eq('id', id)
  if (error) throw error
}
