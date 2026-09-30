// test/cardEvents.test.mjs
// The privacy guarantee on card analytics, asserted rather than assumed:
// a card number or PIN must never reach an event property.

import test from 'node:test'
import assert from 'node:assert/strict'
import { luhnSignal, changedFieldNames } from '../src/lib/cardEvents.js'

test('luhnSignal returns a boolean, never the number', () => {
  // 4111111111111111 is the canonical Luhn-valid test number.
  assert.equal(luhnSignal({ number: '4111111111111111' }), true)
  assert.equal(luhnSignal({ number: '4111111111111112' }), false)
  for (const card of [{ number: '4111111111111111' }, { number: 'nope' }]) {
    assert.equal(typeof luhnSignal(card), 'boolean')
  }
})

test('luhnSignal is null when there is nothing to check', () => {
  assert.equal(luhnSignal({ last4: '1234' }), null, 'open-loop card, no PAN stored')
  assert.equal(luhnSignal({ number: '' }), null)
  assert.equal(luhnSignal({ number: '   ' }), null)
  assert.equal(luhnSignal({}), null)
  assert.equal(luhnSignal(null), null)
})

test('a closed-loop number that fails Luhn is false, not an error', () => {
  // Many merchant gift cards are not Luhn-valid by design. This must report
  // cleanly, because the metric is only meaningful per merchant.
  assert.equal(luhnSignal({ number: '6011500012345678' }), false)
  assert.equal(luhnSignal({ number: '4123088562274Q' }), false, 'alphanumeric')
})

test('changedFieldNames returns names only — never values', () => {
  const before = { merchant: 'Target', number: '1111222233334444', pin: '4821' }
  const updates = { merchant: 'Target', number: '9999888877776666', pin: '4821' }

  const out = changedFieldNames(before, updates)
  assert.deepEqual(out, ['number'])

  // The guarantee, stated as an assertion: no value from either side may
  // appear anywhere in the emitted payload.
  const serialized = JSON.stringify(out)
  for (const v of [...Object.values(before), ...Object.values(updates)]) {
    assert.ok(!serialized.includes(v), `leaked a value: ${v}`)
  }
})

test('unchanged fields are not reported', () => {
  const before = { merchant: 'Target', number: '1111222233334444' }
  assert.deepEqual(changedFieldNames(before, { merchant: 'Target' }), [])
  assert.deepEqual(changedFieldNames(before, {}), [])
})

test('whitespace-only differences are not changes', () => {
  const before = { merchant: 'Target' }
  assert.deepEqual(changedFieldNames(before, { merchant: '  Target  ' }), [])
})

test('null and empty are treated as the same absence', () => {
  assert.deepEqual(changedFieldNames({ pin: null }, { pin: '' }), [])
  assert.deepEqual(changedFieldNames({ pin: '' }, { pin: '4821' }), ['pin'])
})

test('fields outside the editable list are ignored', () => {
  // A new field cannot silently start appearing in events.
  const out = changedFieldNames(
    { id: 'a', userId: 'u1' },
    { id: 'b', userId: 'u2', frontPhotoId: 'p1' }
  )
  assert.deepEqual(out, [])
})

test('multiple changes are all reported', () => {
  const out = changedFieldNames(
    { merchant: 'Target', number: '1111222233334444', notes: '' },
    { merchant: 'Kohl’s', number: '9999888877776666', notes: 'gift' }
  )
  assert.deepEqual(out.sort(), ['merchant', 'notes', 'number'])
})
