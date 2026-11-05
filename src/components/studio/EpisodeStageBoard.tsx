'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { MEASURED_STAGES, stageCompletionSticks } from '@/lib/episode-stages-view'
import {
  PRODUCTION_STAGE_LABEL,
  PRODUCTION_STAGE_STATUS_LABEL,
  PRODUCTION_STAGE_STATUS_STYLE,
  PRODUCTION_STAGE_STATUSES,
  stageOrdinal,
  type ProductionStageKey,
  type ProductionStageStatus,
} from '@/lib/production'
import { cn } from '@/lib/utils'

/**
 * 一集的九大階段，可以手動改 (Z36).
 *
 * 在這之前完全沒有人工入口——只有 `stage-sync` 從內容推導。
 *
 * ## 自動量測的那四個要說清楚
 *
 * `novel`、`script`、`storyboard`、`assets` 會被 `resyncEpisodeStages` 重算，
 * 而那支在每一次章節／場次存檔之後都會跑。規則是只升不降，**除了小說**——
 * 它的完成是從正文裡的「第NNN集 完」推導的，所以刪掉那一行要能收回。
 *
 * 也就是說：手動把小說設成已完成，下一次存檔就會被改回去。這件事一定要寫在
 * 畫面上，不能讓人設了之後發現它自己變回去——那比不給設更讓人不信任系統。
 */

export type StageCell = {
  key: ProductionStageKey
  status: ProductionStageStatus
  progressPercent: number
  note: string
}

export function EpisodeStageBoard({
  projectId,
  episodeId,
  stages,
  canWrite,
}: {
  projectId: string
  episodeId: string
  stages: StageCell[]
  canWrite: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function change(
    stage: ProductionStageKey,
    state: ProductionStageStatus,
    note?: string
  ) {
    if (busy) return
    setBusy(stage)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/stages`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          // `note` 不給就是不動它——給空字串才是清掉。
          body: JSON.stringify({ episodeId, stage, state, ...(note !== undefined ? { note } : {}) }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success(
        `${PRODUCTION_STAGE_LABEL[stage]}：${PRODUCTION_STAGE_STATUS_LABEL[state]}`,
        state === 'completed' && !stageCompletionSticks(stage)
          ? '小說的完成是從正文推導的——下一次存檔如果沒有「完」的標記，這裡會被改回去。'
          : undefined
      )
      router.refresh()
    } catch (cause) {
      toast.error('改不動', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-xs font-semibold text-ink-100">九大階段</h3>
        <p className="text-[10px] leading-relaxed text-ink-600">
          標著「自動」的四個會依內容重算——只會往前推，不會倒退。
          小說是例外：它的完成是從正文裡的「完」推導的，所以也收得回去。
        </p>
      </header>

      <ul className="flex flex-col gap-1.5">
        {stages.map((cell) => {
          const measured = MEASURED_STAGES.includes(cell.key)

          return (
            <li
              key={cell.key}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-stage-900 px-3 py-2 ring-1 ring-stage-700/60"
            >
              <span className="w-5 shrink-0 text-[10px] text-ink-700 tabular-nums">
                {stageOrdinal(cell.key)}
              </span>
              <span className="min-w-20 text-[11px] text-ink-200">
                {PRODUCTION_STAGE_LABEL[cell.key]}
              </span>

              {measured && (
                <span
                  className="rounded bg-stage-800 px-1 py-0.5 text-[9px] text-ink-500 ring-1 ring-inset ring-stage-700"
                  title={
                    stageCompletionSticks(cell.key)
                      ? '依內容自動推進；手動設成已完成會留著。'
                      : '完全依正文推導：手動設成已完成，下一次存檔會被改回去。'
                  }
                >
                  自動
                </span>
              )}

              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[9px] ring-1 ring-inset',
                  PRODUCTION_STAGE_STATUS_STYLE[cell.status]
                )}
              >
                {PRODUCTION_STAGE_STATUS_LABEL[cell.status]}
              </span>

              {cell.progressPercent > 0 && cell.status !== 'completed' && (
                <span className="text-[10px] text-ink-600 tabular-nums">
                  {cell.progressPercent}%
                </span>
              )}

              {/*
                備註 (Z165)。
                這一條鏈本來三層都是死的：API 收 note、lib 寫 note、看板畫
                note，中間缺讀取（`EpisodeStageCell` 沒有這一欄）也缺輸入。
                補齊之後「等配音檔」「要等素材」這種話才有地方寫。

                失焦才送，不是每打一個字送一次。
              */}
              {canWrite ? (
                <input
                  defaultValue={cell.note}
                  placeholder="備註"
                  maxLength={1000}
                  aria-label={`${PRODUCTION_STAGE_LABEL[cell.key]} 的備註`}
                  onBlur={(event) => {
                    if (event.target.value !== cell.note) {
                      void change(cell.key, cell.status, event.target.value)
                    }
                  }}
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[10px] text-ink-400 ring-1 ring-inset ring-transparent transition-colors hover:ring-stage-700 focus:bg-stage-850 focus:text-ink-100 focus:ring-accent-500 focus:outline-none"
                />
              ) : (
                cell.note && (
                  <span className="min-w-0 flex-1 truncate text-[10px] text-ink-600">
                    {cell.note}
                  </span>
                )
              )}

              {canWrite && (
                <span className="ml-auto flex items-center gap-1.5">
                  {busy === cell.key && (
                    <Loader2 aria-hidden className="size-3 animate-spin text-ink-600" />
                  )}
                  <select
                    value={cell.status}
                    disabled={busy === cell.key}
                    aria-label={`${PRODUCTION_STAGE_LABEL[cell.key]} 的狀態`}
                    onChange={(event) =>
                      void change(cell.key, event.target.value as ProductionStageStatus)
                    }
                    className="h-6 rounded bg-stage-850 px-1 text-[10px] text-ink-300 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none disabled:opacity-40"
                  >
                    {PRODUCTION_STAGE_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {PRODUCTION_STAGE_STATUS_LABEL[value]}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
