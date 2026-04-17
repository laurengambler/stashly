// lib/storage.js
// Everything that touches localStorage lives here, behind a tiny API.
// When you later swap in Supabase or another database, you only
// need to change this file — the rest of the app stays the same.

const KEY = 'stashly_cards_v1'
// Legacy key from the previous "Pocket" branding. Read once and
// migrated to KEY so renaming the app doesn't orphan saved data.
const LEGACY_KEY = 'pocket_wallet_cards_v1'

const readKey = (key) => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : null
  } catch (e) {
    console.warn('Could not read stored cards', e)
    return null
  }
}

export const loadCards = () => {
  const current = readKey(KEY)
  if (current !== null) return current

  const legacy = readKey(LEGACY_KEY)
  if (legacy !== null) {
    try {
      localStorage.setItem(KEY, JSON.stringify(legacy))
      localStorage.removeItem(LEGACY_KEY)
    } catch (e) {
      console.warn('Could not migrate legacy cards', e)
    }
    return legacy
  }

  return null
}

export const saveCards = (cards) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(cards))
    return true
  } catch (e) {
    console.warn('Could not save cards', e)
    return false
  }
}
