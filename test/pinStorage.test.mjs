// test/pinStorage.test.mjs
// WHAT THIS RELEASE ACTUALLY DOES: PINs are saved to the server, exactly as
// in 1.3.1. Device-only storage is built and tested but switched OFF, so
// the first test here is the one that matters most — that it is still off.
// Shipping it on by accident would migrate real users' PINs in a release
// that says nothing about PINs.
//
// The structural assertions below guard the dormant feature so it stays
// correct until it is enabled. cardsApi cannot be imported here — it pulls
// in the Supabase client and import.meta.env — so they read the source.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pinsAreDeviceOnly } from '../src/lib/pinStorage.js'

const SRC = readFileSync(new URL('../src/lib/cardsApi.js', import.meta.url), 'utf8')

// Strip comments so prose about `pin` cannot satisfy or trip an assertion.
const CODE = SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

test('device-only PIN storage is OFF, so PINs save to the server', () => {
  assert.equal(
    pinsAreDeviceOnly(),
    false,
    'pinsAreDeviceOnly must be false in this release — turning it on migrates real PINs'
  )
})

test('with the flag off, the INSERT carries the pin', () => {
  // The conditional resolves to the server branch, which is 1.3.1 behaviour.
  const insert = CODE.slice(CODE.indexOf('cardToInsert'), CODE.indexOf('FIELD_MAP'))
  assert.match(insert, /pin:\s*card\.pin/, 'the insert must still be able to send the pin')
})

test('with the flag off, an edited pin reaches the server', () => {
  const upd = CODE.slice(CODE.indexOf('export const updateCard'))
  assert.match(upd, /payload\.pin\s*=\s*updates\.pin/, 'updateCard must send an edited pin')
})

test('the migration cannot run while the flag is off', () => {
  const src = readFileSync(new URL('../src/lib/pinStorage.js', import.meta.url), 'utf8')
  const hydrate = src.slice(src.indexOf('export const hydratePins'))
  assert.match(
    hydrate,
    /if\s*\(!pinsAreDeviceOnly\(\)\)\s*return/,
    'hydratePins must return before copying anything when the flag is off'
  )
})

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
