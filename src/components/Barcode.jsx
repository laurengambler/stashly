// components/Barcode.jsx
// Renders a Code 128 barcode from a card number using JsBarcode.
// Uses a ref + effect so the library can draw into the SVG element
// after React has mounted it.

import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

export default function Barcode({ value }) {
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
        fontSize: 14,
        font: 'monospace',
        lineColor: '#19123D',
        background: '#ffffff',
        margin: 8,
        height: 80,
        width: 1.8,
      })
    } catch (e) {
      // Some strings can't be encoded as Code 128.
      svgRef.current.innerHTML =
        '<text x="50%" y="50%" text-anchor="middle" fill="#19123D" font-size="13">Number cannot be encoded</text>'
      svgRef.current.setAttribute('viewBox', '0 0 300 100')
    }
  }, [value])

  return <svg ref={svgRef} className="pw-barcode-svg" />
}
