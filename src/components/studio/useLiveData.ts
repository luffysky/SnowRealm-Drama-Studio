'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * 讓畫面上的數字自己跟上，不用手動重新整理 (Z117).
 *
 * Every figure in this app is derived on the server, which makes it correct
 * when the page renders and stale from the second afterwards. Two people
 * working at once makes that worse: you write a chapter, the other one is
 * looking at 作品總覽, and it keeps showing the old word count until they
 * think to reload.
 *
 * Three triggers, in order of how much they matter:
 *
 *  1. **Coming back to the tab.** This is the one that fixes almost
 *     everything — write in one tab, switch to another, the numbers are
 *     already right. Free, instant, and it fires exactly when someone is
 *     about to look.
 *  2. **Regaining focus**, for a window that was never hidden, only behind
 *     another.
 *  3. **A slow poll**, so a screen left open on a shared display does not
 *     drift all afternoon. Off by default, because a page nobody is looking
 *     at should not be asking the database how things are going.
 *
 * It re-runs the server component rather than fetching JSON, so the numbers
 * come from the same code path that rendered them. There is no second
 * implementation to disagree with the first.
 */
export function useLiveData({
  /** Seconds between background refreshes. 0 disables polling. */
  intervalSec = 0,
  /** How long after the last refresh before another is worth doing. */
  minGapMs = 3000,
  enabled = true,
}: { intervalSec?: number; minGapMs?: number; enabled?: boolean } = {}) {
  const router = useRouter()
  const lastRef = useRef(0)

  useEffect(() => {
    if (!enabled) return

    /** Refuses to re-run more often than `minGapMs`. */
    const refresh = () => {
      const now = Date.now()
      if (now - lastRef.current < minGapMs) return
      lastRef.current = now
      router.refresh()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)

    const timer =
      intervalSec > 0
        ? window.setInterval(() => {
            // Not while hidden: a background tab polling is pure waste.
            if (document.visibilityState === 'visible') refresh()
          }, intervalSec * 1000)
        : 0

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
      if (timer) window.clearInterval(timer)
    }
  }, [router, intervalSec, minGapMs, enabled])
}
