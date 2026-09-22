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
import { scanLive, scanImage, scanUsable } from '../lib/scanner.js'
import { track } from '../lib/posthog.js'

export default function AddCardFlow({ onCancel, onSave }) {
  const [step, setStep] = useState('capture') // 'capture' | 'confirm' | 'manual'
  const [scan, setScan] = useState(null)
  const [method, setMethod] = useState('scan')
  const [savedCount, setSavedCount] = useState(0)
  const [busy, setBusy] = useState(false)

  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    track('card_add_started', {})
  }, [])

  const runScan = async (getResult, m) => {
    setBusy(true)
    try {
      const result = await getResult()
      if (result?.cancelled) return // user backed out — stay on capture
      if (!scanUsable(result)) track('capture_failed', { method: m })
      setScan(result || {})
      setMethod(m)
      setStep('confirm') // never a dead-end: confirm opens even with empty fields
    } catch (err) {
      if (err?.code === 'cancelled') return
      track('capture_failed', { method: m })
      setScan({})
      setMethod(m)
      setStep('confirm')
    } finally {
      setBusy(false)
    }
  }

  const handleScan = () => runScan(scanLive, 'scan')

  const handlePhotos = () =>
    runScan(async () => {
      let base64 = null
      if (Capacitor.isNativePlatform?.()) {
        const { Camera } = await import('@capacitor/camera')
        const photo = await Camera.getPhoto({
          source: 'PHOTOS',
          resultType: 'base64',
          quality: 85,
        }).catch(() => null)
        if (!photo) return { cancelled: true }
        base64 = photo.base64String
      }
      return scanImage(base64)
    }, 'photos')

  const handleSave = async (payload, { addAnother }) => {
    const batchPosition = savedCount + 1
    await onSave(payload, { method, batchPosition })
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
      onScan={handleScan}
      onPhotos={handlePhotos}
      onManual={() => setStep('manual')}
      onDone={onCancel}
      onCancel={onCancel}
    />
  )
}
