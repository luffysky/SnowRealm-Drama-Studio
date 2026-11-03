'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * 素材資產中心的分頁 (designs 81–90).
 *
 * Only the pages that exist are links. The rest render disabled with the
 * milestone they are coming in — spec v2 §4 forbids a control that does
 * nothing and a link to a 404, and a tab strip is exactly where that
 * temptation is strongest because the strip looks wrong with gaps in it.
 */

type Tab = {
  key: string
  label: string
  segment: string
  ready: boolean
  milestone?: string
  /** Counts are passed in; a tab never invents its own number. */
  count?: number
}

export function AssetCenterNav({
  projectId,
  counts,
}: {
  projectId: string
  counts: Partial<Record<string, number>>
}) {
  const pathname = usePathname()
  const base = `/projects/${projectId}/assets`

  const tabs: Tab[] = [
    { key: 'overview', label: '資產總覽', segment: '', ready: true },
    { key: 'all', label: '全部素材', segment: 'all', ready: false, milestone: 'M3' },
    { key: 'image', label: '圖片', segment: 'image', ready: false, milestone: 'M3', count: counts.IMAGE },
    { key: 'video', label: '影片', segment: 'video', ready: false, milestone: 'M3', count: counts.VIDEO },
    { key: 'music', label: '音樂', segment: 'music', ready: true, count: counts.MUSIC },
    { key: 'sfx', label: '音效', segment: 'sfx', ready: false, milestone: 'M3', count: counts.SFX },
    { key: 'voice', label: '配音', segment: 'voice', ready: false, milestone: 'M3', count: counts.VOICE },
    { key: 'licenses', label: '授權管理', segment: 'licenses', ready: false, milestone: 'M3' },
  ]

  return (
    <nav aria-label="素材資產中心" className="flex flex-wrap gap-1 border-b border-stage-700/60">
      {tabs.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base
        const active = pathname === href

        const label = (
          <>
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1 text-[10px] text-ink-600">{tab.count}</span>
            )}
          </>
        )

        if (!tab.ready) {
          return (
            <span
              key={tab.key}
              aria-disabled="true"
              title={`「${tab.label}」尚未實作，預計於 ${tab.milestone} 階段交付`}
              className="flex cursor-default items-center gap-1 border-b-2 border-transparent px-3 py-2 text-xs text-ink-600 select-none"
            >
              {label}
              <span className="rounded bg-stage-800 px-1 py-0.5 text-[9px] text-ink-700">
                {tab.milestone}
              </span>
            </span>
          )
        }

        return (
          <Link
            key={tab.key}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'border-b-2 px-3 py-2 text-xs transition-all',
              active
                ? 'border-accent-500 font-medium text-ink-50'
                : 'border-transparent text-ink-400 hover:text-ink-100'
            )}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
