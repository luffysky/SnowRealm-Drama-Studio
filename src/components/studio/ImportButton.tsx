'use client'

import { FileUp } from 'lucide-react'
import { useState } from 'react'
import { ImportDialog, type ImportEpisodeOption } from '@/components/studio/ImportDialog'
import type { ImportTargetKey } from '@/lib/import/targets'
import { cn } from '@/lib/utils'

/**
 * 「匯入」那顆按鈕，給伺服器元件的頁面用 (Z185).
 *
 * `ImportDialog` 是用戶端元件，而大部分要匯入的頁面是伺服器元件——所以中間要
 * 有一顆只負責「開關」的小東西。寫成共用的，不然每一頁都會長出一個自己的
 * `useState`。
 */
export function ImportButton({
  projectId,
  episodes,
  target,
  episodeId = null,
  label = '匯入',
  className,
}: {
  projectId: string
  episodes: ImportEpisodeOption[]
  /** 這一頁預設匯入哪一區；檔名認得出來的話以檔名為準。 */
  target: ImportTargetKey
  episodeId?: string | null
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100',
          className
        )}
      >
        <FileUp aria-hidden className="size-3.5" />
        {label}
      </button>

      {open && (
        <ImportDialog
          projectId={projectId}
          episodes={episodes}
          defaultTarget={target}
          defaultEpisodeId={episodeId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
