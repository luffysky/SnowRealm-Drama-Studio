'use client'

import { useEffect } from 'react'

/**
 * Registers `public/sw.js`, which is what makes the studio installable on a
 * tablet or phone.
 *
 * Production only. In development Next serves unhashed, frequently changing
 * bundles, and a worker sitting in front of them turns every edit into a
 * "why am I seeing the old file" hunt.
 *
 * Renders nothing.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    // Registration is not worth blocking paint for.
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // An unavailable worker only costs offline support; never surface it.
      })
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  return null
}
