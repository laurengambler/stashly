// lib/pinStorage.js
// Device-only storage for card PINs.
//
// A card NUMBER alone is weak; a number PLUS its PIN is spendable. So the
// PIN never goes to the server — it lives here, in the same IndexedDB the
// card photos use, and syncs to no other device. That is a deliberate
// trade: the PIN is unreadable by anyone with database access, including
// us, at the cost of not appearing on a second device.
//
// WHY A SEPARATE MODULE, not a column on the card: making it a different
// store makes "this never leaves the device" something you can see in the
// code rather than a rule someone has to remember. cardsApi cannot send
// what it does not hold.
//
// DURABILITY. This is app-container IndexedDB inside a WKWebView, not
// Safari — Safari's 7-day eviction of script-writable storage does not
// apply, and the data is included in device backups. It is still lost if
// the app is deleted, and iOS can in principle evict under severe storage
// pressure. The iOS Keychain would be a stronger home for a secret this
// small; see the note in the module docs for photoStorage's sibling.
// Everything here is behind this module so that swap is one file.

const DB_NAME = 'stashly_pins'
const DB_VERSION = 1
const STORE = 'pins'

let _dbPromise = null

const openDb = () => {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      _dbPromise = null
      reject(req.error)
    }
    req.onblocked = () => {
      _dbPromise = null
      reject(new Error('IndexedDB blocked'))
    }
  })
  return _dbPromise
}

const tx = async (mode, fn) => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    const req = fn(store)
    t.oncomplete = () => resolve(req ? req.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

/** Store (or clear) a card's PIN on this device. */
export const savePin = async (cardId, pin) => {
  if (!cardId) return
  const value = (pin || '').trim()
  if (!value) return deletePin(cardId)
  await tx('readwrite', (s) => s.put(value, cardId))
}

export const getPin = async (cardId) => {
  if (!cardId) return ''
  const v = await tx('readonly', (s) => s.get(cardId))
  return v || ''
}

export const deletePin = async (cardId) => {
  if (!cardId) return
  await tx('readwrite', (s) => s.delete(cardId))
}

/** Every PIN this device holds, as { [cardId]: pin }. */
export const allPins = async () => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const out = {}
    const t = db.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).openCursor()
    req.onsuccess = () => {
      const cur = req.result
      if (!cur) {
        resolve(out)
        return
      }
      out[cur.key] = cur.value
      cur.continue()
    }
    req.onerror = () => reject(req.error)
  })
}

/**
 * Attach this device's PINs to freshly fetched cards, migrating any PIN
 * still held on the server as it goes.
 *
 * MIGRATION. Cards saved before this change carry their PIN in Postgres.
 * The first device to open the app copies it down here. The server copy is
 * deliberately NOT deleted at the same moment: a user with two devices
 * would otherwise lose the PIN everywhere except whichever one opened
 * first. Leaving it lets every device self-heal, and the server column is
 * cleared once in a single pass later, on a date chosen deliberately.
 *
 * Returns { cards, migrated } — cards with `pin` filled from the device,
 * and how many PINs were copied down this time.
 */
export const hydratePins = async (cards) => {
  if (!Array.isArray(cards) || !cards.length) return { cards: cards || [], migrated: 0 }

  let local = {}
  try {
    local = await allPins()
  } catch (err) {
    // No local store: show the server PIN if there still is one rather
    // than blanking a field the user can see today.
    console.warn('Could not read device PINs', err)
    return { cards, migrated: 0 }
  }

  let migrated = 0
  const out = await Promise.all(
    cards.map(async (card) => {
      const localPin = local[card.id]
      if (localPin) return { ...card, pin: localPin }

      const serverPin = (card.pin || '').trim()
      if (!serverPin) return { ...card, pin: '' }

      try {
        await savePin(card.id, serverPin)
        migrated += 1
      } catch (err) {
        console.warn('Could not migrate a PIN to this device', err)
      }
      return { ...card, pin: serverPin }
    })
  )
  return { cards: out, migrated }
}
