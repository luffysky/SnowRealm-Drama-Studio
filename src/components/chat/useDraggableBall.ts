'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 讓懸浮球可以拖，而且記得放在哪裡 (Z120).
 *
 * It is `fixed` in the bottom-right corner, which is also where pages put
 * their own controls. `--dock-height` already keeps it off a composer, but
 * that only solves the one case anybody thought of — and a floating thing
 * that covers a button you need is not a thing you can reason your way out
 * of. So it moves.
 *
 * Three things make it feel right rather than merely possible:
 *
 *  1. **A drag is not a click.** Below a few pixels of movement it stays a
 *     tap, so picking it up slightly does not swallow the press.
 *  2. **It sticks to a side.** Released mid-screen it slides to whichever
 *     edge is nearer, the way every phone's accessibility button does. A ball
 *     parked in the middle of the page is in the way of everything.
 *  3. **It stays on screen.** Clamped on resize and rotation, or a ball
 *     dragged to the bottom of a tall window is unreachable in a short one.
 *
 * The position is per device (`localStorage`): where it should sit depends on
 * the screen it is on and on which hand is holding it.
 */

const STORAGE_KEY = 'srds.chat.ball.position.v1'

/** Movement under this is a press, not a drag. */
const DRAG_THRESHOLD = 4

/** Keeps the whole ball visible when it parks. */
const EDGE_MARGIN = 8

export type BallPosition = {
  /** Distance from the left edge, in pixels. */
  x: number
  /** Distance from the top edge, in pixels. */
  y: number
}

function read(): BallPosition | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BallPosition>
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null
    return { x: parsed.x, y: parsed.y }
  } catch {
    // Private window, or blocked site data. It just does not remember.
    return null
  }
}

function write(position: BallPosition): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
  } catch {
    /* Not worth interrupting anyone over. */
  }
}

/**
 * Keeps a position inside the part of the window you can actually see.
 *
 * `window.innerHeight` is the wrong floor on a phone: the keyboard covers the
 * page without resizing it, and the safe-area inset is behind the home
 * indicator where a tap is a system gesture rather than a press. Clamping to
 * either one parks the ball somewhere real and untouchable.
 */
function clampTo(p: BallPosition, size: number, obscured = 0): BallPosition {
  const safeBottom = readInset('--safe-bottom')
  const safeTop = readInset('--safe-top')
  const floor = window.innerHeight - obscured - safeBottom

  return {
    x: Math.min(Math.max(p.x, EDGE_MARGIN), window.innerWidth - size - EDGE_MARGIN),
    y: Math.min(Math.max(p.y, EDGE_MARGIN + safeTop), floor - size - EDGE_MARGIN),
  }
}

/** The CSS env() value as a number; 0 where the device has no inset. */
function readInset(variable: string): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable)
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function useDraggableBall(size = 56, obscured = 0) {
  const ref = useRef<HTMLDivElement | null>(null)

  /*
   * Read straight into state rather than in a mount effect.
   *
   * Safe because `FloatingChat` renders nothing until it has mounted, so the
   * server never produced a ball for this to disagree with — and an effect
   * that immediately calls `setPosition` is a second render for a value that
   * was available all along.
   */
  const [position, setPosition] = useState<BallPosition | null>(() => {
    if (typeof window === 'undefined') return null
    const saved = read()
    // Clamped here too: the window may be a different size than last time.
    return saved ? clampTo(saved, size, 0) : null
  })
  const [dragging, setDragging] = useState(false)

  /** Set while a drag is in flight, so the click handler can refuse. */
  const movedRef = useRef(false)
  const originRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const clamp = useCallback(
    (p: BallPosition) => clampTo(p, size, obscured),
    [size, obscured]
  )

  // A rotated phone or a resized window must not strand it off-screen.
  useEffect(() => {
    const onResize = () => setPosition((current) => (current ? clamp(current) : null))
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [clamp])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    // Left button or touch only; a right-click is not a drag.
    if (event.button !== 0) return

    const box = ref.current?.getBoundingClientRect()
    if (!box) return

    originRef.current = { x: box.left, y: box.top, px: event.clientX, py: event.clientY }
    movedRef.current = false
    ref.current?.setPointerCapture(event.pointerId)
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const origin = originRef.current
      if (!origin) return

      const dx = event.clientX - origin.px
      const dy = event.clientY - origin.py

      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return

      movedRef.current = true
      setDragging(true)
      setPosition(clamp({ x: origin.x + dx, y: origin.y + dy }))
    },
    [clamp]
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const origin = originRef.current
      originRef.current = null
      try {
        ref.current?.releasePointerCapture(event.pointerId)
      } catch {
        /* already released */
      }

      if (!origin || !movedRef.current) {
        setDragging(false)
        return
      }

      setPosition((current) => {
        if (!current) return current

        /*
         * Snap to the nearer side. Left out, this parks in the middle of the
         * page and is then in the way of everything rather than one thing.
         */
        const toLeft = current.x + size / 2
        const snapped = clamp({
          x: toLeft < window.innerWidth / 2 ? EDGE_MARGIN : window.innerWidth - size - EDGE_MARGIN,
          y: current.y,
        })

        write(snapped)
        return snapped
      })

      setDragging(false)
    },
    [clamp, size]
  )

  /** True for the moment after a drag, so the click can be ignored. */
  const justDragged = useCallback(() => movedRef.current, [])

  /*
   * Where it is drawn, as opposed to where it was put.
   *
   * Clamped at render rather than written back into state: the chosen
   * position is the person's, and the keyboard is a temporary guest. Storing
   * the corrected value would mean the ball never returns to where they left
   * it once the keyboard closes — and it would be a `setState` reacting to an
   * effect, which is the other thing wrong with doing it that way.
   */
  const rendered =
    position && typeof window !== 'undefined' ? clampTo(position, size, obscured) : position

  return {
    ref,
    position: rendered,
    dragging,
    justDragged,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
    /** Back to the corner the CSS puts it in. */
    reset: () => {
      setPosition(null)
      try {
        window.localStorage.removeItem(STORAGE_KEY)
      } catch {
        /* nothing to do */
      }
    },
  }
}
