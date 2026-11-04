'use client'

import { useEffect, useState } from 'react'

/**
 * 畫面上真正看得到的那塊，以及現在有沒有人在打字 (P0-2).
 *
 * A fixed element in the bottom-right corner has three ways of ending up
 * somewhere useless, and none of them are about screen width:
 *
 *  1. **The notch and the home indicator.** `bottom: 0` on a phone is behind
 *     the gesture bar, where a tap is a system gesture rather than a press.
 *  2. **The keyboard.** It does not resize the window — it covers it. Nothing
 *     in CSS knows that happened; `visualViewport` is the only thing that
 *     does, and without it the ball sits underneath the keyboard, visible and
 *     untouchable.
 *  3. **Somebody typing.** Even clear of the keyboard, a bright circle beside
 *     the field you are writing in is in the way of reading what you wrote.
 *
 * All three apply on a tablet, and the last one applies on a desktop too — a
 * narrow window puts the composer and the ball in the same place. So none of
 * this is behind a breakpoint.
 */

export type ViewportFit = {
  /** Height of the part of the page not covered by the keyboard. */
  height: number
  /** How much the keyboard (or similar) covers, in pixels. 0 when closed. */
  obscured: number
  /** Someone is typing: the widget should get out of the way. */
  typing: boolean
}

/** Below this the keyboard is not open, it is just browser chrome moving. */
const KEYBOARD_THRESHOLD = 120

function editable(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false
  if (node.isContentEditable) return true
  const tag = node.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useViewportFit(): ViewportFit {
  const [fit, setFit] = useState<ViewportFit>(() => ({
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
    obscured: 0,
    typing: false,
  }))

  useEffect(() => {
    const viewport = window.visualViewport

    const measure = () => {
      const visible = viewport?.height ?? window.innerHeight
      /*
       * What the keyboard covers is the window height minus what is still
       * visible, minus how far the page was scrolled up to make room. On a
       * desktop this is always 0, which is the right answer there.
       */
      const covered = Math.max(0, window.innerHeight - visible - (viewport?.offsetTop ?? 0))

      setFit((current) => {
        const next = {
          height: visible,
          obscured: covered > KEYBOARD_THRESHOLD ? covered : 0,
          typing: current.typing,
        }
        return next.height === current.height && next.obscured === current.obscured
          ? current
          : next
      })
    }

    const onFocusIn = (event: FocusEvent) => {
      if (editable(event.target)) setFit((current) => ({ ...current, typing: true }))
    }

    const onFocusOut = () => {
      // Deferred: moving between two fields fires out then in, and reacting to
      // the gap makes the widget flash back and forth.
      window.setTimeout(() => {
        setFit((current) => ({ ...current, typing: editable(document.activeElement) }))
      }, 120)
    }

    measure()

    viewport?.addEventListener('resize', measure)
    viewport?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    return () => {
      viewport?.removeEventListener('resize', measure)
      viewport?.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return fit
}
