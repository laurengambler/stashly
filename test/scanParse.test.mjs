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
  validatedNumber,
} from '../src/lib/scanParse.js'
import { matchMerchant, normalizeMerchantName } from '../src/lib/merchants.js'
import { describeCaptureError } from '../src/lib/scanner.js'

// ---------------------------------------------------------------------
// Capture failures must never be silent.
//
// Regression from 1.3: "From photos" registered the tap and did nothing.
// @capacitor/camera rejects getPhoto when ANY of its three usage-description
// keys is missing — including NSPhotoLibraryAddUsageDescription, which the
// app never uses and which had been removed — and the call site caught that
// rejection to null and treated it as a user cancellation. Dead button, no
// message, and no analytics event either.
//
// Messages below are the literal strings @capacitor/camera rejects with
// (CameraPlugin.swift / CameraTypes.swift).
// ---------------------------------------------------------------------

test('a missing usage description is reported, not swallowed', () => {
  const r = describeCaptureError(
    new Error(
      'You are missing NSPhotoLibraryAddUsageDescription in your Info.plist file.' +
        ' Camera will not function without it. Learn more: https://developer.apple.com/…'
    )
  )
  assert.equal(r.cancelled, undefined, 'must not look like a cancellation')
  assert.equal(r.blocked, true, 'must keep the user on the capture screen')
  assert.equal(r.reason, 'missing_usage_description')
  assert.match(r.message, /\S/, 'must carry a message for the user')
})

test('user cancellation stays silent', () => {
  assert.equal(describeCaptureError(new Error('User cancelled photos app')).cancelled, true)
  assert.equal(describeCaptureError({ code: 'cancelled', message: 'cancelled' }).cancelled, true)
  assert.equal(describeCaptureError(null).cancelled, true, 'no error at all')
})

test('denied permission names the right setting', () => {
  const photos = describeCaptureError(new Error('User denied access to photos'))
  assert.equal(photos.blocked, true)
  assert.equal(photos.reason, 'photos_permission_denied')
  assert.match(photos.message, /Photos/)

  const camera = describeCaptureError(new Error('User denied access to camera'))
  assert.equal(camera.blocked, true)
  assert.equal(camera.reason, 'camera_permission_denied')
  assert.match(camera.message, /Camera/)
})

test('an unavailable scanner is blocked, not routed to an empty confirm', () => {
  const r = describeCaptureError(new Error('Camera not available while running in Simulator'))
  assert.equal(r.blocked, true)
  assert.equal(r.reason, 'scanner_unavailable')
})

test('a recognition failure still opens the confirm screen', () => {
  // This one DID run — the user can type the card in, so do not block.
  const r = describeCaptureError(new Error('Error processing image'))
  assert.equal(r.blocked, undefined)
  assert.equal(r.cancelled, undefined)
  assert.equal(r.reason, 'recognition_failed')
})

// ---------------------------------------------------------------------
// THE GUARD. The card number field only ever receives a single validated
// alphanumeric run — never raw recognized line text.
//
// Regression from device testing: the field came back holding
// "ACCT#: 70123456 789 0123456", the raw transcript of a tapped highlight.
// The tap override is gone, but the guard is what makes that class of bug
// impossible rather than merely fixed.
// ---------------------------------------------------------------------

test('raw recognized line text can never be a card number', () => {
  const rejected = [
    'ACCT#: 70123456 789 0123456',          // the reported value
    'Card #1234567890        18934',         // number + PIN, unsegmented
    '6011 5000 1234 5678',                   // grouped, spaces intact
    'This card is not redeemable for cash',  // fine print
    'For balance visit example.com/balance',
    'ACCT#:70123456',                        // punctuation anywhere at all
    '',
  ]
  for (const r of rejected) {
    assert.equal(validatedNumber(r), '', `must reject ${JSON.stringify(r)}`)
  }
})

test('a single alphanumeric run passes', () => {
  assert.equal(validatedNumber('701234567890123456'), '701234567890123456')
  assert.equal(validatedNumber('1234567890'), '1234567890')
  assert.equal(validatedNumber('AB123456789012'), 'AB123456789012')
  assert.equal(validatedNumber('  1234567890  '), '1234567890', 'outer space trimmed')
})

test('a run that is not really a number is rejected', () => {
  assert.equal(validatedNumber('STARBUCKS'), '', 'letters only')
  assert.equal(validatedNumber('12345'), '', 'too short')
  assert.equal(validatedNumber('1'.repeat(33)), '', 'too long')
  assert.equal(validatedNumber('ABCDEFGH1234'), '', 'not mostly digits')
})

test('the guard fires on the reported card, end to end', () => {
  // Vision returns this whole line as ONE fragment, so the parser has to
  // strip the label itself. What it must never do is pass the line through.
  const { number, pin, numberFromLabel } = parseCardFields([
    'ACCT#: 70123456 789 0123456',
  ])
  assert.equal(number, '701234567890123456')
  assert.equal(numberFromLabel, true)
  assert.equal(pin, '')
  assert.ok(!number.includes('ACCT'), 'no label')
  assert.ok(!/\s/.test(number), 'no whitespace')
})

test('fine print alone leaves the number blank, not guessed', () => {
  const { number, rejectedNumber } = parseCardFields([
    'This card is not redeemable for cash except where required by law.',
    'For balance visit example.com/balance',
  ])
  assert.equal(number, '')
  assert.equal(rejectedNumber, '', 'nothing was even a candidate')
})

test('a rejected candidate is reported, not silently dropped', () => {
  // A phone number in fine print is a single run but too short to be a
  // card number; the parser records what it threw away for the debug log.
  const { number, rejectedNumber } = parseCardFields(['Call 18005550199'])
  assert.equal(number, '18005550199', '11 digits is a plausible card number')
  assert.equal(rejectedNumber, '')
})

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

test('the barcode is the number when nothing is labeled, and keeps letters', () => {
  const { number } = parseCardFields(['1234567890'], 'AB123456789012')
  assert.equal(number, 'AB123456789012')
})

// ---------------------------------------------------------------------
// Regression: a cinema gift card whose barcode is NOT its card number.
//
// Reported from device testing. The card is laid out:
//
//     CARD#: 41230-8856-2274Q          PIN: 4412238
//     0125        2048576        0-12345-67890
//
// and its barcode encodes the retail UPC plus an internal serial, not the
// card number. The number field filled with that payload. A barcode like
// this is the right thing to scan at a register and the wrong thing to
// show as the card number, so a LABELED number outranks it.
//
// Every digit here is synthetic — no real card data in this repo.
// ---------------------------------------------------------------------

test('a labeled card number beats the barcode payload', () => {
  const { number, numberFromLabel, pin } = parseCardFields(
    ['CARD#: 41230-8856-2274Q   PIN: 4412238'],
    '012345678905000000411223' // UPC + serial, not the card number
  )
  assert.equal(number, '4123088562274Q', 'the printed, labeled number')
  assert.equal(numberFromLabel, true)
  assert.equal(pin, '4412238')
})

test('an alphanumeric card number keeps its letter and loses its dashes', () => {
  // Dropping the trailing letter yields a number that will not redeem.
  const { number } = parseCardFields(['CARD#: 41230-8856-2274Q'])
  assert.equal(number, '4123088562274Q')
  assert.ok(number.endsWith('Q'), 'letter preserved')
  assert.ok(!number.includes('-'), 'separators closed up')
})

test('a label glued to its number does not leak into the value', () => {
  assert.equal(parseCardFields(['ACCT#:70123456789']).number, '70123456789')
  assert.equal(parseCardFields(['CARD#41230885622740']).number, '41230885622740')
})

test('a word next to a number is dropped, not glued to it', () => {
  assert.equal(parseCardFields(['Call 18005550199']).number, '18005550199')
  assert.equal(parseCardFields(['STASH MARKET 12345678']).number, '12345678')
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
