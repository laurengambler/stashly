// components/SwipeRow.jsx
// Reusable swipe-to-reveal row. Tracks horizontal pointer drag on the
// content layer and reveals action buttons rendered behind it. A swipe
// past the threshold latches the row open; tapping anywhere else (or
// swiping the other direction) closes it.

import { useEffect, useRef, useState } from 'react'

const THRESHOLD = 56
const MAX_OFFSET = 120

export default function SwipeRow({
  children,
  leftActions = null,    // revealed when user swipes RIGHT (finger moves right)
  rightActions = null,   // revealed when user swipes LEFT
  onLeftAction = null,   // fired when a RIGHT swipe crosses the threshold
  onRightAction = null,  // fired when a LEFT swipe crosses the threshold
  className = '',
  onTap,
}) {
  const [offset, setOffset] = useState(0)
  const [latched, setLatched] = useState(0) // -1, 0, 1
  const startX = useRef(0)
  const startY = useRef(0)
  const dragging = useRef(false)
  const moved = useRef(false)
  const wrapRef = useRef(null)

  // Close when a tap lands outside this row.
  useEffect(() => {
    if (!latched) return
    const onDocPointer = (e) => {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target)) {
        setLatched(0)
        setOffset(0)
      }
    }
    document.addEventListener('pointerdown', onDocPointer, true)
    return () => document.removeEventListener('pointerdown', onDocPointer, true)
  }, [latched])

  const handleStart = (clientX, clientY) => {
    startX.current = clientX
    startY.current = clientY
    dragging.current = true
    moved.current = false
  }

  const handleMove = (clientX, clientY) => {
    if (!dragging.current) return
    const dx = clientX - startX.current
    const dy = clientY - startY.current
    if (!moved.current && Math.abs(dy) > Math.abs(dx)) {
      // Vertical scroll wins — abandon swipe.
      dragging.current = false
      return
    }
    if (Math.abs(dx) > 4) moved.current = true
    let next = latched * THRESHOLD + dx
    if (next > 0 && !leftActions) next = 0
    if (next < 0 && !rightActions) next = 0
    next = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, next))
    setOffset(next)
  }

  const handleEnd = () => {
    if (!dragging.current) return
    dragging.current = false
    // Fire the side's action once the swipe crosses the threshold...
    if (offset > THRESHOLD && leftActions) {
      if (onLeftAction) onLeftAction()
    } else if (offset < -THRESHOLD && rightActions) {
      if (onRightAction) onRightAction()
    }
    // ...then always settle back to the closed resting position so the
    // card never stays stuck half-swiped on release.
    setLatched(0)
    setOffset(0)
  }

  const handleClick = (e) => {
    if (moved.current) {
      e.preventDefault()
      e.stopPropagation()
      moved.current = false
      return
    }
    if (latched) {
      // Tap on content while latched closes the row.
      setLatched(0)
      setOffset(0)
      e.stopPropagation()
      return
    }
    if (onTap) onTap()
  }

  return (
    <div ref={wrapRef} className={'pw-swipe ' + className}>
      {leftActions && (
        <div
          className="pw-swipe-actions pw-swipe-actions-left"
          aria-hidden={offset <= 0}
        >
          {leftActions({ close: () => { setLatched(0); setOffset(0) } })}
        </div>
      )}
      {rightActions && (
        <div
          className="pw-swipe-actions pw-swipe-actions-right"
          aria-hidden={offset >= 0}
        >
          {rightActions({ close: () => { setLatched(0); setOffset(0) } })}
        </div>
      )}
      <div
        className="pw-swipe-content"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging.current ? 'none' : 'transform 0.22s ease',
        }}
        onPointerDown={(e) => handleStart(e.clientX, e.clientY)}
        onPointerMove={(e) => handleMove(e.clientX, e.clientY)}
        onPointerUp={handleEnd}
        onPointerCancel={handleEnd}
        onClick={handleClick}
      >
        {children}
      </div>
    </div>
  )
}
