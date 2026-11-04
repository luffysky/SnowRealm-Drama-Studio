'use client'

import { useEffect, useRef } from 'react'

/**
 * Tells the floating widgets how tall this page's bottom bar is.
 *
 * The floating chat is `fixed` in the bottom-right corner, which is also where
 * a composer puts its send button. On the assistant page at phone width the
 * ball covered the send button almost entirely: the field accepted text and
 * the button could not be pressed. Hiding the ball is not the fix — it is
 * what rings for an incoming call, and a phone that only rings on the page you
 * are already looking at was the bug before this one.
 *
 * So the page publishes its dock height and the widgets ride above it. Live,
 * not measured once: the composer's textarea is resizable and grows with the
 * draft, and a number read at mount would be wrong a sentence later.
 *
 * Returns a ref to put on the bar.
 */
export function useBottomDock<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const root = document.documentElement
    const publish = () => root.style.setProperty('--dock-height', `${el.offsetHeight}px`)

    publish()

    const observer = new ResizeObserver(publish)
    observer.observe(el)

    return () => {
      observer.disconnect()
      // Cleared on the way out, or every later page inherits this page's bar.
      root.style.removeProperty('--dock-height')
    }
  }, [])

  return ref
}
