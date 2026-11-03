'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ASSET_TABS, assetTabHref } from '@/lib/asset-center-view'
import { cn } from '@/lib/utils'

/**
 * 素材資產中心的分頁 (designs 81–90).
 *
 * Only the pages that exist are links. The rest render disabled with the
 * milestone they are coming in — spec v2 §4 forbids a control that does
 * nothing and a link to a 404, and a tab strip is exactly where that
 * temptation is strongest because the strip looks wrong with gaps in it.
 */

export function AssetCenterNav({
  projectId,
  counts,
}: {
  projectId: string
  counts: Partial<Record<string, number>>
}) {
  const pathname = usePathname()

  // The tab list lives in `@/lib/asset-center-view` because the uploader needs
  // the same one to decide where to send you after a file lands.
  const tabs = ASSET_TABS.map((tab) => ({
    ...tab,
    count: tab.kinds?.reduce((total, kind) => total + (counts[kind] ?? 0), 0),
  }))

  return (
    <nav aria-label="素材資產中心" className="flex flex-wrap gap-1 border-b border-stage-700/60">
      {tabs.map((tab) => {
        const href = assetTabHref(projectId, tab)
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
