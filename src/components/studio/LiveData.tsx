'use client'

import { useLiveData } from '@/components/studio/useLiveData'

/**
 * Renders nothing; keeps the page's numbers current (Z117).
 *
 * A mount point, because the pages showing derived figures are server
 * components and a hook needs a client one. Dropping `<LiveData />` into a
 * server page is the whole integration.
 */
export function LiveData({ intervalSec = 0 }: { intervalSec?: number }) {
  useLiveData({ intervalSec })
  return null
}
