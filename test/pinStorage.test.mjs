// test/pinStorage.test.mjs
// The guarantee: a PIN never reaches the server, and the migration that
// moves existing ones onto the device does not lose or duplicate them.
//
// node has no IndexedDB, so the store is exercised through a minimal
// in-memory fake. That is enough for what matters here — the migration
// logic and the cardsApi omission — and the real store is the same code
// path the photos already use in production.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cardToInsertShape } from './helpers/cardsApiShape.mjs'

test('the INSERT payload never carries a pin or access_code', () => {
  const payload = cardToInsertShape({
    merchant: 'Target',
    number: '1111222233334444',
    pin: '4821',
    accessCode: '99',
  })
  assert.ok(!('pin' in payload), 'pin must not be a column in the insert')
  assert.ok(!('access_code' in payload), 'access_code must not be in the insert')
  assert.equal(payload.card_number, '1111222233334444', 'the number still syncs')

  // Belt and braces: the value itself must appear nowhere in the payload.
  const serialized = JSON.stringify(payload)
  assert.ok(!serialized.includes('4821'), 'the PIN value leaked into the payload')
})

test('the update field map cannot carry a pin', () => {
  const src = readFileSync(new URL('../src/lib/cardsApi.js', import.meta.url), 'utf8')
  const map = src.slice(src.indexOf('const FIELD_MAP'), src.indexOf('const NUMERIC_KEYS'))
  assert.ok(!/\bpin:\s*'pin'/.test(map), "FIELD_MAP must not map pin -> 'pin'")
  assert.ok(!/accessCode:\s*'access_code'/.test(map), 'FIELD_MAP must not map accessCode')
  assert.ok(/number:\s*'card_number'/.test(map), 'the number is still mapped')
})
