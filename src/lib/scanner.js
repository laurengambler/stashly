// lib/scanner.js
// Abstraction over the native on-device card scanner (Apple Vision /
// VisionKit). The native implementation lives in a custom Capacitor
// plugin (StashScanner, added in the native phase). On the web build —
// and in the test harness — it returns a mock scan so the whole
// capture → confirm → save flow can be exercised without a device.
//
// Result shape (all fields optional; the flow degrades to empty fields):
//   { merchantGuess, number, pin, barcode, barcodeFormat, imageBase64, textLines }
//
// `merchantGuess` is only ever a HINT. It is the largest non-numeric line
// the scanner saw, which on the back of a card is usually fine print — so
// nothing autofills the merchant field from it directly. It is fed through
// matchMerchant() with the rest of the text and used only on a hit against
// the known-merchant list.

import { Capacitor, registerPlugin } from '@capacitor/core'
import { matchMerchant } from './merchants.js'

const StashScanner = registerPlugin('StashScanner')
const isNative = () => !!Capacitor.isNativePlatform?.()

// Deterministic mock for the browser/harness. window.__mockScan can override
// it (e.g. set to {} to exercise the "OCR found nothing" path).
const mockResult = () => {
  if (typeof window !== 'undefined' && window.__mockScan !== undefined) {
    return { ...window.__mockScan }
  }
  return {
    merchantGuess: 'STARBUCKS',
    number: '6011500012345678',
    pin: '',
    barcode: '6011500012345678',
    barcodeFormat: 'code128',
    imageBase64: null,
    textLines: [
      'STARBUCKS',
      '6011 5000 1234 5678',
      'PIN 4821',
      'Balance $25.00',
    ],
  }
}

export const scannerAvailable = async () => {
  if (!isNative()) return true
  try {
    const r = await StashScanner.isAvailable()
    return !!r?.available
  } catch {
    return false
  }
}

// Present the live VisionKit scanner; resolves with a scan result, or
// throws { code: 'cancelled' } if the user backs out.
export const scanLive = async () => {
  if (!isNative()) return mockResult()
  return StashScanner.scanLive()
}

// Run Vision (barcode + OCR) over an already-picked image (base64, no
// data: prefix). Used by the "From photos" path.
export const scanImage = async (base64) => {
  if (!isNative()) return mockResult()
  return StashScanner.scanImage({ base64 })
}

/**
 * Classify a capture failure so the UI can respond to it.
 *
 * Three outcomes:
 *   { cancelled: true }              the user backed out — say nothing
 *   { blocked: true, reason, message } the picker or camera never opened —
 *                                    show the message, stay on capture
 *   { reason }                       it ran but found nothing — the confirm
 *                                    screen opens with empty fields
 *
 * The distinction matters: a blocked capture that routes to the confirm
 * screen looks to the user like the scan simply found nothing, which is a
 * lie — the picker never opened. And a blocked capture that is swallowed
 * entirely is a dead button, which is how "From photos" behaved in 1.3.
 *
 * Matching is on message text because that is all @capacitor/camera gives
 * us; its rejections are plain strings (see CameraPlugin.swift).
 */
export const describeCaptureError = (err) => {
  const raw = String(err?.message || err?.errorMessage || err || '')
  const msg = raw.toLowerCase()

  // Our own scanLive rejects with code 'cancelled'; Capacitor rejects with
  // "User cancelled photos app".
  if (!raw || err?.code === 'cancelled' || msg.includes('cancel')) {
    return { cancelled: true }
  }

  // A missing usage-description string. Should be unreachable now, but if a
  // build ever ships without one this is the signal that says so.
  if (msg.includes('info.plist') || msg.includes('usagedescription')) {
    return {
      blocked: true,
      reason: 'missing_usage_description',
      message:
        "Stashly can't open your photos in this version. Please update to the latest version, or add the card manually below.",
    }
  }

  if (msg.includes('denied') || msg.includes('permission') || msg.includes('restricted')) {
    const photos = msg.includes('photo')
    return {
      blocked: true,
      reason: photos ? 'photos_permission_denied' : 'camera_permission_denied',
      message: photos
        ? 'Stashly needs access to your photos. Open Settings › Stashly › Photos, then try again.'
        : 'Stashly needs access to your camera. Open Settings › Stashly › Camera, then try again.',
    }
  }

  if (msg.includes('not supported') || msg.includes('unavailable') || msg.includes('simulator')) {
    return {
      blocked: true,
      reason: 'scanner_unavailable',
      message:
        "Scanning isn't available on this device. You can pick a photo instead, or add the card manually below.",
    }
  }

  // It got far enough to try. Let the confirm screen open with empty fields
  // rather than blocking — the user can still type the card in.
  return { reason: 'recognition_failed' }
}

// Did the scan surface anything usable? Drives the capture_failed event.
//
// "Usable" means the user is about to see a field already filled in. A raw
// merchantGuess no longer counts — it only fills the merchant field if it
// matches the known-merchant list, so that is what we test here. Keeping
// the loose old test would have under-reported capture_failed exactly on
// the back-of-card scans this release set out to fix.
export const scanUsable = (r) => {
  if (!r) return false
  const has = (v) => !!(v && String(v).trim())
  return (
    has(r.number) ||
    has(r.barcode) ||
    has(r.pin) ||
    !!matchMerchant(r.textLines, r.merchantGuess)
  )
}
