// components/AddCardFlow.jsx
// Capture-first add-card flow. The new front door for "+": opens straight
// to the capture screen (no form), routes a scan/photo through the one
// confirm screen, and keeps the capture hot for batch adds. Manual entry
// is the quiet fallback (the existing form). Owns the funnel events:
//   card_add_started — once, when this flow opens
//   capture_failed   — when a scan/photo yields nothing usable
// (card_added is fired by the parent's onSave, with method + batch_position.)

import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import CaptureScreen from './CaptureScreen.jsx'
import ConfirmCardScreen from './ConfirmCardScreen.jsx'
import AddCardScreen from './AddCardScreen.jsx'
import {
  scanLive,
  scanImage,
  scanUsable,
  describeCaptureError,
} from '../lib/scanner.js'
import { track } from '../lib/posthog.js'

export default function AddCardFlow({ onCancel, onSave, onToast }) {
  const toast = (m) => onToast?.(m)

  const [step, setStep] = useState('capture') // 'capture' | 'confirm' | 'manual'
  const [scan, setScan] = useState(null)
  const [method, setMethod] = useState('scan')
  const [savedCount, setSavedCount] = useState(0)
  const [busy, setBusy] = useState(false)
  // A capture that never opened — shown on the capture screen itself, since
  // that is where the user still is.
  const [error, setError] = useState(null)

  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    track('card_add_started', {})
  }, [])

  const runScan = async (getResult, m) => {
    setBusy(true)
    setError(null)
    try {
      const result = await getResult()
      if (result?.cancelled) return // user backed out — stay on capture
      if (!scanUsable(result)) {
        // It ran and read nothing. Not silent: the confirm screen opens so
        // the card can still be typed in, and the toast says why it is empty
        // rather than leaving the user to guess.
        track('capture_failed', { method: m, reason: 'no_fields_found' })
        toast("Couldn't read that card. Add the details below.")
      }
      setScan(result || {})
      setMethod(m)
      setStep('confirm') // never a dead-end: confirm opens even with empty fields
    } catch (err) {
      const info = describeCaptureError(err)
      if (info.cancelled) return

      // The picker or camera never opened. Routing to the confirm screen
      // here would tell the user the scan found nothing, which is not what
      // happened — so stay put and say what went wrong. Swallowing this
      // case is exactly what made "From photos" a dead button in 1.3.
      if (info.blocked) {
        track('capture_error', {
          method: m,
          reason: info.reason,
          error_message: info.detail,
        })
        setError(info.message) // stays on screen after the toast fades
        toast(info.message)
        return
      }

      track('capture_failed', {
        method: m,
        reason: info.reason,
        error_message: info.detail,
      })
      toast("Couldn't read that card. Add the details below.")
      setScan({})
      setMethod(m)
      setStep('confirm')
    } finally {
      setBusy(false)
    }
  }

  const handleScan = () => runScan(scanLive, 'scan')

  // Fired the moment the button is tapped, before anything can reject.
  // This is the event that distinguishes "the tap never registered" from
  // "the picker refused to open" — the question that took a device report
  // to answer when this path silently died in 1.3. Pair it with
  // capture_error / card_added on method:'photos' to see where taps go.
  const handlePhotos = () => {
    track('photo_upload_tapped', {})
    return runScan(async () => {
      let base64 = null
      if (Capacitor.isNativePlatform?.()) {
        const { Camera } = await import('@capacitor/camera')
        // Deliberately NOT caught here. A rejection has to reach runScan so
        // the user sees why nothing opened; catching it to null turned every
        // failure — including the missing Info.plist key that broke 1.3 —
        // into a silent no-op.
        const photo = await Camera.getPhoto({
          source: 'PHOTOS',
          resultType: 'base64',
          quality: 85,
        })
        if (!photo?.base64String) return { cancelled: true }
        base64 = photo.base64String
      }
      return scanImage(base64)
    }, 'photos')
  }

  const handleSave = async (payload, { addAnother, fields }) => {
    const batchPosition = savedCount + 1
    // `fields` comes from the confirm screen and describes which fields the
    // scan prefilled and which of those the user corrected. Only the
    // capture paths supply it; manual entry has nothing to prefill.
    await onSave(payload, { method, batchPosition, fields })
    setSavedCount(batchPosition)
    if (addAnother) {
      setScan(null)
      setStep('capture') // keep the capture hot for the next card
    } else {
      onCancel() // done — back to the wallet
    }
  }

  if (step === 'manual') {
    return (
      <AddCardScreen
        onCancel={() => setStep('capture')}
        onSave={(card) =>
          onSave(card, { method: 'manual', batchPosition: savedCount + 1 }).then(
            () => onCancel()
          )
        }
      />
    )
  }

  if (step === 'confirm') {
    return (
      <ConfirmCardScreen
        scan={scan}
        batchPosition={savedCount + 1}
        onSave={handleSave}
        onBack={() => setStep('capture')}
        onCancel={onCancel}
      />
    )
  }

  return (
    <CaptureScreen
      savedCount={savedCount}
      busy={busy}
      error={error}
      onScan={handleScan}
      onPhotos={handlePhotos}
      onManual={() => setStep('manual')}
      onDone={onCancel}
      onCancel={onCancel}
    />
  )
}
