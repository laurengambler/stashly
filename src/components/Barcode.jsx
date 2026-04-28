// components/Barcode.jsx
// Renders a Code 128 barcode from a card number using JsBarcode.
// `large` switches to a fullscreen-friendly size used by the scan view.

import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

export default function Barcode({ value, large = false }) {
  const svgRef = useRef(null)

  useEffect(() => {
    if (!svgRef.current) return
    const clean = (value || '').replace(/\s/g, '')
    if (!clean) {
      svgRef.current.innerHTML = ''
      return
    }
    try {
      JsBarcode(svgRef.current, clean, {
        format: 'CODE128',
        displayValue: true,
        fontSize: large ? 20 : 14,
        font: 'monospace',
        lineColor: '#19123D',
        background: '#ffffff',
        margin: large ? 16 : 8,
        height: large ? 180 : 80,
        width: large ? 3 : 1.8,
      })
    } catch (e) {
      svgRef.current.innerHTML =
        '<text x="50%" y="50%" text-anchor="middle" fill="#19123D" font-size="13">Number cannot be encoded</text>'
      svgRef.current.setAttribute('viewBox', '0 0 300 100')
    }
  }, [value, large])

  return <svg ref={svgRef} className="pw-barcode-svg" />
}
