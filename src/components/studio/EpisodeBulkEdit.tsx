'use client'

import { X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { EPISODE_STATUSES, EPISODE_STATUS_LABEL, type EpisodeStatusValue } from '@/lib/constants'
import {
  PRODUCTION_STAGE_KEYS,
  PRODUCTION_STAGE_LABEL,
  PRODUCTION_STAGE_STATUSES,
  PRODUCTION_STAGE_STATUS_LABEL,
  type ProductionStageKey,
  type ProductionStageStatus,
} from '@/lib/production'

/**
 * 批次編輯選取的集數 (Z67, designs 33–37).
 *
 * `episodeBulkUpdateSchema` 寫好很久、零個呼叫端——跟 Z66 同一批。
 *
 * ## 一次只改一件事
 *
 * 這一條列上每個欄位各自有一顆「套用」，而不是填好幾格再一起送。因為批次
 * 修改沒有預覽也沒有復原：一次改一件事，改錯了至少知道是哪一件。
 *
 * ## 階段狀態要兩個值才動
 *
 * 「把這幾集的分鏡階段改成…」少了後半句是沒有意義的，所以兩個下拉都選了才
 * 會亮起套用鈕——而不是預設一個狀態替人決定。
 */
export function EpisodeBulkEdit({
  projectId,
  selected,
  onClear,
}: {
  projectId: string
  selected: string[]
  onClear: () => void
}) {
  const router = useRouter()
  const toast = useToast()

  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<EpisodeStatusValue | ''>('')
  const [targetSec, setTargetSec] = useState('')
  const [stage, setStage] = useState<ProductionStageKey | ''>('')
  const [stageState, setStageState] = useState<ProductionStageStatus | ''>('')

  async function apply(
    key: string,
    patch: Record<string, unknown>,
    describe: (result: { updated: number; stagesUpdated: number }) => string
  ) {
    if (busy) return
    setBusy(key)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/episodes/bulk`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ episodeIds: selected, ...patch }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const result = (await response.json()) as { updated: number; stagesUpdated: number }
      toast.success('改好了', describe(result))
      router.refresh()
    } catch (cause) {
      toast.error('改不動', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const seconds = Number(targetSec)
  const secondsOk = Number.isInteger(seconds) && seconds >= 10 && seconds <= 3600

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-600/10 px-3 py-2 ring-1 ring-inset ring-accent-500/30">
      <span className="text-[11px] text-ink-100">
        選了 <strong className="tabular-nums">{selected.length}</strong> 集
      </span>

      <button
        type="button"
        onClick={onClear}
        className="tap inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100"
      >
        <X aria-hidden className="size-3" />
        取消選取
      </button>

      <span className="h-4 w-px bg-stage-700" aria-hidden />

      {/* ---- 製作狀態 ---------------------------------------------------- */}
      <label className="flex items-center gap-1.5 text-[10px] text-ink-500">
        狀態
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as EpisodeStatusValue | '')}
          className="h-7 rounded-lg bg-stage-850 px-1.5 text-[10px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        >
          <option value="">不改</option>
          {EPISODE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {EPISODE_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <Button
        size="sm"
        variant="ghost"
        disabled={!status}
        loading={busy === 'status'}
        onClick={() =>
          void apply('status', { status }, (r) => `${r.updated} 集改成「${status && EPISODE_STATUS_LABEL[status]}」`)
        }
      >
        套用
      </Button>

      <span className="h-4 w-px bg-stage-700" aria-hidden />

      {/* ---- 目標片長 ---------------------------------------------------- */}
      <label className="flex items-center gap-1.5 text-[10px] text-ink-500">
        片長
        <input
          type="number"
          min={10}
          max={3600}
          value={targetSec}
          placeholder="秒"
          onChange={(event) => setTargetSec(event.target.value)}
          className="h-7 w-16 rounded-lg bg-stage-850 px-1.5 text-[10px] text-ink-100 tabular-nums ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        />
      </label>
      <Button
        size="sm"
        variant="ghost"
        disabled={!secondsOk}
        loading={busy === 'targetSec'}
        onClick={() =>
          void apply('targetSec', { targetSec: seconds }, (r) => `${r.updated} 集的目標片長改成 ${seconds} 秒`)
        }
      >
        套用
      </Button>

      <span className="h-4 w-px bg-stage-700" aria-hidden />

      {/* ---- 九大階段 ---------------------------------------------------- */}
      <label className="flex items-center gap-1.5 text-[10px] text-ink-500">
        階段
        <select
          value={stage}
          onChange={(event) => setStage(event.target.value as ProductionStageKey | '')}
          className="h-7 rounded-lg bg-stage-850 px-1.5 text-[10px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        >
          <option value="">不改</option>
          {PRODUCTION_STAGE_KEYS.map((value) => (
            <option key={value} value={value}>
              {PRODUCTION_STAGE_LABEL[value]}
            </option>
          ))}
        </select>
        <select
          value={stageState}
          onChange={(event) => setStageState(event.target.value as ProductionStageStatus | '')}
          className="h-7 rounded-lg bg-stage-850 px-1.5 text-[10px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
        >
          <option value="">選狀態</option>
          {PRODUCTION_STAGE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {PRODUCTION_STAGE_STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <Button
        size="sm"
        variant="ghost"
        /* 兩個都選了才動：少了後半句的「把分鏡階段改成…」沒有意義。 */
        disabled={!stage || !stageState}
        loading={busy === 'stage'}
        onClick={() =>
          void apply('stage', { stage, stageState }, (r) => `${r.stagesUpdated} 筆階段紀錄已更新`)
        }
      >
        套用
      </Button>
    </div>
  )
}
