// test/pinStorage.test.mjs
// The contract: in the APP, a PIN never reaches the server. On the WEB it
// still does, because Safari evicts IndexedDB after 7 days and device-only
// storage there would be data loss on a timer rather than privacy.
//
// These are source-level assertions. cardsApi cannot be imported here — it
// pulls in the Supabase client and import.meta.env — and the thing worth
// protecting is structural anyway: that no code path writes a PIN to the
// server without passing the platform check.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../src/lib/cardsApi.js', import.meta.url), 'utf8')

// Strip comments so prose about `pin` cannot satisfy or trip an assertion.
const CODE = SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

test('every pin write to the server is behind the platform check', () => {
  const lines = CODE.split('\n')
  const pinWrites = lines.filter((l) => /\bpin\b\s*[:=]/.test(l) && !/row\.pin/.test(l))
  assert.ok(pinWrites.length > 0, 'expected to find the web-only pin write')
  for (const line of pinWrites) {
    assert.match(
      line.includes('pinsAreDeviceOnly') ? line : nearestGuard(lines, line),
      /pinsAreDeviceOnly/,
      `unguarded pin write: ${line.trim()}`
    )
  }
})

// The guard may sit on the line above (an `if`), so look back a little.
function nearestGuard(lines, line) {
  const i = lines.indexOf(line)
  return lines.slice(Math.max(0, i - 3), i + 1).join('\n')
}

test('the update field map cannot carry a pin', () => {
  const map = CODE.slice(CODE.indexOf('const FIELD_MAP'), CODE.indexOf('const NUMERIC_KEYS'))
  assert.ok(!/\bpin:\s*'pin'/.test(map), "FIELD_MAP must not map pin -> 'pin'")
  assert.ok(!/accessCode:/.test(map), 'FIELD_MAP must not map accessCode')
  assert.ok(/number:\s*'card_number'/.test(map), 'the number is still mapped')
})

test('access_code is never written, on any platform', () => {
  assert.ok(
    !/access_code\s*:/.test(CODE.slice(CODE.indexOf('cardToInsert'))),
    'access_code must not appear in any write payload'
  )
})

test('pin is still READ from the server, so existing ones can migrate', () => {
  assert.match(CODE, /pin:\s*row\.pin/, 'cardFromDb must still read row.pin')
})
