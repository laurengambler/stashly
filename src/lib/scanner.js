// lib/scanner.js
// Abstraction over the native on-device card scanner (Apple Vision /
// VisionKit). The native implementation lives in a custom Capacitor
// plugin (StashScanner, added in the native phase). On the web build —
// and in the test harness — it returns a mock scan so the whole
// capture → confirm → save flow can be exercised without a device.
//
// Result shape (all fields optional; the flow degrades to empty fields):
//   { merchantGuess, number, barcode, barcodeFormat, imageBase64, textLines }

import { Capacitor, registerPlugin } from '@capacitor/core'

const StashScanner = registerPlugin('StashScanner')
const isNative = () => !!Capacitor.isNativePlatform?.()

// Deterministic mock for the browser/harness. window.__mockScan can override
// it (e.g. set to {} to exercise the "OCR found nothing" path).
const mockResult = () => {
  if (typeof window !== 'undefined' && window.__mockScan !== undefined) {
    return { ...window.__mockScan }
  }
  return {
    merchantGuess: 'Starbucks',
    number: '6011500012345678',
    barcode: '6011500012345678',
    barcodeFormat: 'code128',
    imageBase64: null,
    textLines: ['STARBUCKS', '6011 5000 1234 5678', 'Balance $25.00'],
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

// Did the scan surface anything usable? Drives the capture_failed event.
export const scanUsable = (r) =>
  !!(r && ((r.number && r.number.trim()) || (r.merchantGuess && r.merchantGuess.trim())))
