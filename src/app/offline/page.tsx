'use client'

import { WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Served by the service worker when a navigation fails with no network.
 *
 * It deliberately shows nothing about the production: the worker never caches
 * authenticated content, so there is no work to display here, and pretending
 * otherwise would be worse than saying plainly that the device is offline.
 */
export default function OfflinePage() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])

  return (
    <main className="grid min-h-dvh place-items-center bg-stage-950 px-6 py-12">
      <div className="panel w-full max-w-sm rounded-2xl bg-stage-900 p-6 text-center ring-1 ring-stage-700">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-stage-800 text-ink-400 ring-1 ring-stage-700">
          <WifiOff aria-hidden className="size-5" />
        </span>

        <h1 className="text-base font-semibold text-ink-50">目前沒有網路連線</h1>
        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          製片資料全部存放在伺服器上，離線時無法讀取或編輯。
          <br />
          恢復連線後重新整理即可繼續。
        </p>

        <p className="mt-4 text-[11px] text-ink-500">
          連線狀態：
          <span className={online ? 'text-emerald-300' : 'text-amber-300'}>
            {online ? '已恢復' : '離線中'}
          </span>
        </p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-brand-gradient glow-accent-sm mt-5 w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          重新連線
        </button>
      </div>
    </main>
  )
}
