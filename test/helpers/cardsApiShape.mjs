// Rebuilds the INSERT payload shape without importing cardsApi, which pulls
// in the Supabase client and import.meta.env. Kept deliberately thin: it
// asserts the SHAPE contract (which columns exist), and a second test reads
// cardsApi.js directly to confirm the real builder agrees.
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../../src/lib/cardsApi.js', import.meta.url), 'utf8')
const BODY = SRC.slice(SRC.indexOf('export const cardToInsert'), SRC.indexOf('// Map JS field name'))

export const cardToInsertShape = (card) => {
  const payload = {}
  // Every `column: ...` key the real builder emits.
  for (const m of BODY.matchAll(/^\s{4}([a-z_]+):/gm)) payload[m[1]] = undefined
  payload.card_number = card.number || null
  return payload
}
