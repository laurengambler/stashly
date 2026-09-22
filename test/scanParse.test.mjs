// test/scanParse.test.mjs
// Spec for card-text parsing. Run with `npm test` (node --test, no deps).
//
// This is the shared spec for BOTH implementations: src/lib/scanParse.js
// and CardTextParser in ios/App/App/StashScannerPlugin.swift. The Swift
// copy is what runs on device; this one covers the browser/harness path.
// Change a rule here and change it in both.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  segmentLine,
  detectPin,
  parseCardFields,
} from '../src/lib/scanParse.js'
import { matchMerchant, normalizeMerchantName } from '../src/lib/merchants.js'

// ---------------------------------------------------------------------
// Regression: a card printing the number and PIN on one line.
//
// Reported from device testing. Live capture returned the two runs fused
// into a single 15-digit "card number" (123456789018934), because the
// parser reduced the whole line to its digits before looking at it. The
// still-image path happened to get it right only because Vision handed it
// the two runs pre-split — neither path actually understood the layout.
// ---------------------------------------------------------------------

test('card number and PIN on one line are separate fields', () => {
  const line = 'Card #1234567890        18934'

  assert.deepEqual(segmentLine(line), ['Card #1234567890', '18934'])

  const { number, pin, numberFromLabel } = parseCardFields([line])
  assert.equal(number, '1234567890', 'the labeled run is the card number')
  assert.equal(pin, '18934', 'the shorter trailing run is the PIN')
  assert.equal(numberFromLabel, true)
})

test('same card, whichever way the recognizer split the line', () => {
  // Both paths now build visual lines from bounding boxes, so they agree.
  // Whatever the gap width, the answer must not move.
  for (const gap of ['  ', '    ', '            ', '\t']) {
    const { number, pin } = parseCardFields([`Card #1234567890${gap}18934`])
    assert.equal(number, '1234567890', `gap ${JSON.stringify(gap)}`)
    assert.equal(pin, '18934', `gap ${JSON.stringify(gap)}`)
  }
})

test('the label wins over the longest-run heuristic', () => {
  // The PIN-ish run is LONGER than the labeled card number here. Without
  // the label rule the longest run would win and pick the wrong field.
  const { number, pin } = parseCardFields(['Card #12345678     987654321'])
  assert.equal(number, '12345678')
  assert.equal(pin, '')  // 9 digits but longer than the number: not a PIN
})

// ---------------------------------------------------------------------
// Grouped card numbers must survive segmentation.
// ---------------------------------------------------------------------

test('single-spaced grouping is one number', () => {
  const { number, pin } = parseCardFields(['6011 5000 1234 5678'])
  assert.equal(number, '6011500012345678')
  assert.equal(pin, '')
})

test('wide-spaced grouping is still one number', () => {
  // Equal-length groups re-join even across wide gaps: this is one number
  // printed with airy tracking, not four fields.
  assert.deepEqual(segmentLine('1234  5678  9012  3456'), ['1234 5678 9012 3456'])
  assert.equal(parseCardFields(['1234  5678  9012  3456']).number, '1234567890123456')
})

test('uneven grouping still re-joins', () => {
  assert.equal(parseCardFields(['1234  5678 9012 3456']).number, '1234567890123456')
})

test('unequal shapes do NOT re-join', () => {
  // 10 digits then 5 is the reported card: different shapes, two fields.
  assert.deepEqual(segmentLine('1234567890   18934'), ['1234567890', '18934'])
  const { number, pin } = parseCardFields(['1234567890   18934'])
  assert.equal(number, '1234567890')
  assert.equal(pin, '18934')
})

// ---------------------------------------------------------------------
// Labeled PINs (the pre-existing rule) still hold.
// ---------------------------------------------------------------------

test('labeled PIN, inline and on the next line', () => {
  assert.equal(detectPin(['STARBUCKS', 'PIN: 4821']), '4821')
  assert.equal(detectPin(['Access Code', '93117']), '93117')
  assert.equal(detectPin(['Security Code 55213']), '55213')
})

test('a PIN label is not enough without a code', () => {
  assert.equal(detectPin(['Your PIN protected balance is safe']), '')
  assert.equal(detectPin(['STARBUCKS', '4821']), '', 'no label, no prefill')
})

test('a card number on a PIN line is not a PIN', () => {
  // Regression: the candidate used to be truncated to 10 characters, which
  // turned a 16-digit card number into a plausible-looking PIN.
  assert.equal(detectPin(['PIN 6011500012345678'], '6011500012345678'), '')
})

test('a labeled PIN beats the trailing-run guess', () => {
  const { number, pin } = parseCardFields(['Card #1234567890   18934', 'PIN 7766'])
  assert.equal(number, '1234567890')
  assert.equal(pin, '7766')
})

// ---------------------------------------------------------------------
// Barcode precedence.
// ---------------------------------------------------------------------

test('a barcode payload is the number, and keeps letters', () => {
  const { number } = parseCardFields(['Card #1234567890   18934'], 'AB123456789012')
  assert.equal(number, 'AB123456789012')
})

test('a barcode does not hide a trailing PIN', () => {
  const { pin } = parseCardFields(['Card #1234567890   18934'], '1234567890')
  assert.equal(pin, '18934')
})

test('the PIN never duplicates the number', () => {
  const { pin } = parseCardFields(['Card #18934   18934'])
  assert.equal(pin, '')
})

// ---------------------------------------------------------------------
// Merchant gating — a wrong prefill is worse than a blank field.
// ---------------------------------------------------------------------

test('back-of-card fine print never fills the merchant', () => {
  const fineprint = [
    'This card is not redeemable for cash except where required by law.',
    'Terms and conditions apply. See back for details.',
    'For balance inquiry call 1-800-555-0199',
  ]
  assert.equal(matchMerchant(fineprint, fineprint[0]), null)
})

test('a known merchant fills, in any casing or punctuation', () => {
  assert.equal(matchMerchant(['STARBUCKS']).name, 'Starbucks')
  assert.equal(matchMerchant(['BATH & BODY WORKS®']).name, 'Bath & Body Works')
  assert.equal(matchMerchant(['For balance visit starbucks.com/card']).name, 'Starbucks')
})

test('substrings inside other words do not match', () => {
  assert.equal(matchMerchant(['See their terms']), null, '"rei" inside "their"')
  assert.equal(matchMerchant(['No gaps in coverage']), null, '"gap" inside "gaps"')
})

test('the longest alias wins', () => {
  assert.equal(matchMerchant(['Bath & Body Works']).name, 'Bath & Body Works')
})

test('unmatched merchant names normalize to one ranking key', () => {
  assert.equal(
    normalizeMerchantName("Dutchie's Coffee"),
    normalizeMerchantName('DUTCHIES COFFEE')
  )
})
