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
 *
 * ## 三個欄位，三條獨立的送出路徑 (Z166)
 *
 * 狀態、備註、指派各自只送自己那一個欄位。Z165 剛加備註的時候是讓它**順便把
 * 現在的狀態一起送回去**，於是每打一次備註就等於重新宣告一次「把這個階段設
 * 成已完成」：`completed_at` 被重蓋成今天、活動紀錄多一筆假的狀態變更、而介
 * 面還跳一個「已完成」的提示。
 */

export type StageCell = {
  key: ProductionStageKey
  status: ProductionStageStatus
  progressPercent: number
  note: string
  assigneeId: string | null
}

type Patch = {
  state?: ProductionStageStatus
  note?: string
  assigneeId?: string | null
}

export function EpisodeStageBoard({
  projectId,
  episodeId,
  stages,
  members,
  canWrite,
}: {
  projectId: string
  episodeId: string
  stages: StageCell[]
  /** 「指派給誰」的選項；`@/lib/members` 的 `studioMembers()`。 */
  members: { id: string; name: string }[]
  canWrite: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  /**
   * 送一個欄位。
   *
   * `patch` 只帶**真的要改的那一個**——API 那邊 `state` 是可選的，沒給就一個
   * 時間戳都不會動。
   */
  async function send(stage: ProductionStageKey, patch: Patch, said: string) {
    /*
     * 上一個還在飛就擋下來，而且**要說出來**。
     *
     * 本來是 `if (busy) return`，沒有提示也沒有錯誤：在請求回來之前點進備註
     * 框打字再失焦，整段輸入會被安靜丟掉，而輸入框裡還留著剛打的字，看起來
     * 像存好了。
     */
    if (busy) {
      toast.error('上一個還在存', '等一下再改這一個。')
      return
    }

    setBusy(stage)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/stages`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ episodeId, stage, ...patch }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success(
        `${PRODUCTION_STAGE_LABEL[stage]}：${said}`,
        patch.state === 'completed' && !stageCompletionSticks(stage)
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
          const assignee = members.find((member) => member.id === cell.assigneeId)

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
                備註 (Z165/Z166)。

                `key={cell.note}` 不是裝飾：這是個不受控的輸入框，而伺服器那
                邊 zod 會 `.trim()`。打「　等配音　」存成「等配音」之後，React
                不會更新已掛載節點的 `defaultValue`，DOM 裡還是帶空白的舊字
                串——於是之後每一次失焦 `!==` 都成立，每一次都再送一發。加上
                key，伺服器的值一變這個節點就重掛，`defaultValue` 重新生效。
              */}
              {canWrite ? (
                <input
                  key={cell.note}
                  defaultValue={cell.note}
                  placeholder="備註"
                  maxLength={1000}
                  disabled={busy !== null}
                  aria-label={`${PRODUCTION_STAGE_LABEL[cell.key]} 的備註`}
                  onBlur={(event) => {
                    // 比 trim 過的值——伺服器存進去的就是 trim 過的。
                    const next = event.target.value.trim()
                    if (next !== cell.note) {
                      void send(cell.key, { note: next }, next ? '備註已存' : '備註已清掉')
                    }
                  }}
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-[10px] text-ink-400 ring-1 ring-inset ring-transparent transition-colors hover:ring-stage-700 focus:bg-stage-850 focus:text-ink-100 focus:ring-accent-500 focus:outline-none disabled:opacity-40"
                />
              ) : (
                cell.note && (
                  <span className="min-w-0 flex-1 truncate text-[10px] text-ink-600">
                    {cell.note}
                  </span>
                )
              )}

              <span className="ml-auto flex items-center gap-1.5">
                {busy === cell.key && (
                  <Loader2 aria-hidden className="size-3 animate-spin text-ink-600" />
                )}

                {/*
                  指派給誰 (Z166)。

                  Z165 把寫入接到 DB 就停下來了——兩支查詢都沒有 select 它，畫
                  面上沒有任何地方看得到。指派完回 200、資料真的寫進去了，然後
                  誰也看不見。這個下拉是那條鏈缺的最後一截。
                */}
                {canWrite ? (
                  <select
                    value={cell.assigneeId ?? ''}
                    disabled={busy !== null}
                    aria-label={`${PRODUCTION_STAGE_LABEL[cell.key]} 的負責人`}
                    onChange={(event) => {
                      const id = event.target.value || null
                      const name = members.find((member) => member.id === id)?.name
                      void send(
                        cell.key,
                        { assigneeId: id },
                        name ? `指派給 ${name}` : '已取消指派'
                      )
                    }}
                    className="h-6 max-w-24 rounded bg-stage-850 px-1 text-[10px] text-ink-300 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none disabled:opacity-40"
                  >
                    <option value="">未指派</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  assignee && <span className="text-[10px] text-ink-500">{assignee.name}</span>
                )}

                {canWrite && (
                  <select
                    value={cell.status}
                    disabled={busy !== null}
                    aria-label={`${PRODUCTION_STAGE_LABEL[cell.key]} 的狀態`}
                    onChange={(event) => {
                      const state = event.target.value as ProductionStageStatus
                      void send(cell.key, { state }, PRODUCTION_STAGE_STATUS_LABEL[state])
                    }}
                    className="h-6 rounded bg-stage-850 px-1 text-[10px] text-ink-300 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none disabled:opacity-40"
                  >
                    {PRODUCTION_STAGE_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {PRODUCTION_STAGE_STATUS_LABEL[value]}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
