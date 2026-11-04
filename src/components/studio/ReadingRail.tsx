'use client'

import { useEffect, useRef } from 'react'

/**
 * 閱讀器的進度條。
 *
 * What replaces the browser's scrollbar inside the reader (`.reader-surface`
 * hides that). The native one is dressed for the studio's dark chrome and ran
 * down the edge of a cream page; worse, it took 10px of layout width, so the
 * text column was narrower on the right than on the left and the measure was
 * visibly off-centre.
 *
 * Three decisions:
 *
 *  1. **It is drawn in the page's own ink**, at low opacity, so it belongs to
 *     whichever theme is on rather than to the app.
 *  2. **It fades when you stop.** While reading there is nothing on the edge
 *     of the page at all; it appears the moment anything moves and goes again
 *     a second later. A permanent line beside the prose is the thing being
 *     replaced, so adding a quieter permanent line would miss the point.
 *  3. **It is still draggable.** Hiding a scrollbar and giving back a
 *     decoration takes something away from anyone who scrolls by dragging —
 *     which includes people for whom a wheel or a long swipe is awkward. The
 *     visible line is 3px; the thing you grab is 24px wide and transparent,
 *     which is the WCAG 2.5.8 floor.
 *
 * Driven by direct DOM writes rather than React state: this updates on every
 * scroll frame of a 13,000px chapter, and a `setState` per frame is how a
 * reader starts to stutter on a phone.
 */
export function ReadingRail({
  containerRef,
  /** The theme's faint colour, so the rail belongs to the page. */
  color,
  /** False in the paged modes, where nothing scrolls. */
  enabled,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  color: string
  enabled: boolean
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const scroller = containerRef.current
    const rail = railRef.current
    const thumb = thumbRef.current
    if (!scroller || !rail || !thumb || !enabled) return

    /** Shortest thumb that is still a thumb rather than a dot. */
    const MIN_THUMB = 28
    /** How long the rail stays up after the last movement. */
    const LINGER_MS = 900

    let frame = 0
    let idle = 0
    let dragging = false

    /** Places the rail over the scrolling element, in viewport coordinates. */
    function position() {
      const box = scroller!.getBoundingClientRect()
      rail!.style.top = `${box.top + 8}px`
      rail!.style.height = `${Math.max(0, box.height - 16)}px`
    }

    function show() {
      thumb!.style.opacity = '1'
      window.clearTimeout(idle)
      // While dragging it must not fade out from under the finger.
      if (!dragging) idle = window.setTimeout(() => (thumb!.style.opacity = '0'), LINGER_MS)
    }

    function draw() {
      frame = 0

      const span = scroller!.scrollHeight - scroller!.clientHeight
      // Nothing to scroll: no rail at all, rather than a full-height thumb
      // that looks like a stuck control.
      if (span <= 8) {
        thumb!.style.opacity = '0'
        return
      }

      const track = rail!.clientHeight
      const height = Math.max(MIN_THUMB, (scroller!.clientHeight / scroller!.scrollHeight) * track)
      const offset = (scroller!.scrollTop / span) * (track - height)

      thumb!.style.height = `${height}px`
      thumb!.style.transform = `translateY(${offset}px)`
      show()
    }

    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(draw)
    }

    /** Maps a pointer's y to a scroll position, centring the thumb on it. */
    function scrollToPointer(clientY: number) {
      const track = rail!.clientHeight
      const height = thumb!.offsetHeight
      const top = rail!.getBoundingClientRect().top
      const span = scroller!.scrollHeight - scroller!.clientHeight
      const travel = track - height
      if (travel <= 0) return

      const ratio = (clientY - top - height / 2) / travel
      scroller!.scrollTop = Math.min(1, Math.max(0, ratio)) * span
    }

    function onPointerDown(event: PointerEvent) {
      dragging = true
      rail!.setPointerCapture(event.pointerId)
      scrollToPointer(event.clientY)
      show()
      event.preventDefault()
    }

    function onPointerMove(event: PointerEvent) {
      if (!dragging) return
      scrollToPointer(event.clientY)
    }

    function onPointerUp(event: PointerEvent) {
      if (!dragging) return
      dragging = false
      try {
        rail!.releasePointerCapture(event.pointerId)
      } catch {
        /* already released */
      }
      show()
    }

    position()
    draw()
    // Drawn once above, then hidden: arriving at a chapter should not flash a
    // rail nobody asked for.
    thumb.style.opacity = '0'

    scroller.addEventListener('scroll', onScroll, { passive: true })
    rail.addEventListener('pointerdown', onPointerDown)
    rail.addEventListener('pointermove', onPointerMove)
    rail.addEventListener('pointerup', onPointerUp)
    rail.addEventListener('pointercancel', onPointerUp)

    const observer = new ResizeObserver(() => {
      position()
      onScroll()
    })
    observer.observe(scroller)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(idle)
      scroller.removeEventListener('scroll', onScroll)
      rail.removeEventListener('pointerdown', onPointerDown)
      rail.removeEventListener('pointermove', onPointerMove)
      rail.removeEventListener('pointerup', onPointerUp)
      rail.removeEventListener('pointercancel', onPointerUp)
      observer.disconnect()
    }
  }, [containerRef, enabled])

  if (!enabled) return null

  return (
    <div
      ref={railRef}
      /*
       * 24px wide and transparent — the grab area, at the WCAG 2.5.8 floor.
       * Pinned to the viewport edge rather than to the text column, so it
       * reads as part of the window and never as a line beside the prose.
       */
      className="fixed right-0 z-10 w-6 cursor-default touch-none select-none"
      aria-hidden
    >
      <div
        ref={thumbRef}
        className="absolute top-0 right-[5px] w-[3px] rounded-full transition-opacity duration-300"
        style={{ background: color, opacity: 0 }}
      />
    </div>
  )
}
