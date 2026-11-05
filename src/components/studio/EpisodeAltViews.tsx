'use client'

import type { StageColumn } from '@/lib/episode-view'
import type { EpisodeSegment } from '@/lib/episode-view'
import {
  PRODUCTION_STAGE_ABBR,
  PRODUCTION_STAGE_LABEL,
  PRODUCTION_STAGE_STATUS_DOT,
  PRODUCTION_STAGE_STATUS_LABEL,
  toPercent,
} from '@/lib/production'
import type { SerialisedEpisode } from '@/components/studio/EpisodeManager'
import { cn } from '@/lib/utils'

/**
 * 集數列表的另外兩種檢視 (Z37, design 05).
 *
 * 這兩個模式在檢視切換器上存在很久了，而且**是灰的**，掛著 `M1` 徽章——
 * `EPISODE_VIEWS` 裡有 `PROGRESS` 與 `SEGMENT`，`parseView()` 也收，只是
 * 沒有人畫出來。
 *
 * 兩個都回答同一個問題的不同切面，而那個問題是列表檢視答不出來的：**120 集
 * 做到哪裡了。** 列表一次只看得到二十筆。
 */

/* -------------------------------------------------------------------------- */
/* 進度總覽                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 集數 × 九階段的矩陣。
 *
 * 上面那一列是**跨全作品**的每階段完成度，不是這一頁的——「哪一個階段卡住
 * 了」是整體的問題，而答案常常是某一個階段整排空白。下面是這一頁的逐集明
 * 細，跟著分頁走（120 × 9 一次畫出來是一千多格，而且捲不完）。
 */
export function ProgressView({
  rows,
  columns,
  selectedId,
  onPick,
}: {
  rows: SerialisedEpisode[]
  columns: StageColumn[]
  selectedId: string | null
  onPick: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-medium text-ink-400">
          九大階段：整部作品
          <span className="ml-1.5 text-ink-600">分母是集數，階段列還沒建的算未開始</span>
        </h3>

        <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-9">
          {columns.map((column) => (
            <li
              key={column.key}
              className="flex flex-col gap-1 rounded-lg bg-stage-850/60 p-2 ring-1 ring-inset ring-stage-700/70"
              title={`${PRODUCTION_STAGE_LABEL[column.key]}：${column.done} / ${column.total} 集已完成`}
            >
              <span className="truncate text-[10px] text-ink-400">
                {PRODUCTION_STAGE_LABEL[column.key]}
              </span>
              <span className="text-xs font-medium text-ink-100 tabular-nums">
                {toPercent(column.progress)}%
              </span>
              <span className="h-1 overflow-hidden rounded-full bg-stage-800">
                <span
                  className="block h-full rounded-full bg-accent-500"
                  style={{ width: `${toPercent(column.progress)}%` }}
                />
              </span>
              <span className="text-[9px] text-ink-600 tabular-nums">
                {column.done} / {column.total} 集
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] text-ink-600">
            <tr className="border-b border-stage-700/60">
              <th scope="col" className="w-20 py-2 font-medium">
                集數
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="w-9 py-2 text-center font-medium"
                  title={PRODUCTION_STAGE_LABEL[column.key]}
                >
                  {PRODUCTION_STAGE_ABBR[column.key]}
                </th>
              ))}
              <th scope="col" className="w-14 py-2 text-right font-medium">
                完成率
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onPick(row.id)}
                className={cn(
                  'cursor-pointer border-b border-stage-800/70 transition-colors last:border-0',
                  row.id === selectedId ? 'bg-accent-600/10' : 'hover:bg-stage-850/60'
                )}
              >
                <td className="py-1.5 font-medium text-ink-300 tabular-nums">
                  EP{String(row.number).padStart(3, '0')}
                </td>
                {row.stages.map((cell) => (
                  <td key={cell.key} className="py-1.5 text-center">
                    <span
                      aria-hidden
                      title={`${PRODUCTION_STAGE_LABEL[cell.key]}：${PRODUCTION_STAGE_STATUS_LABEL[cell.status]}`}
                      className={cn(
                        'inline-block size-3 rounded-sm',
                        PRODUCTION_STAGE_STATUS_DOT[cell.status]
                      )}
                    />
                    <span className="sr-only">
                      {PRODUCTION_STAGE_LABEL[cell.key]}：
                      {PRODUCTION_STAGE_STATUS_LABEL[cell.status]}
                    </span>
                  </td>
                ))}
                <td className="py-1.5 text-right text-ink-400 tabular-nums">
                  {toPercent(row.progress)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 分段檢視                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 每十集一段。
 *
 * 120 集切成十二段之後，「哪一段卡住」一眼就看得出來——而這是列表檢視結構
 * 上答不出來的問題：它一次只顯示二十筆。
 *
 * 點一段就跳到那一段所在的頁，不是另外做一個篩選：集號是連續的，所以第幾段
 * 就是第幾頁（每頁十筆時），而多一個篩選狀態就多一個會跟網址不同步的東西。
 */
export function SegmentView({
  segments,
  perPage,
  onGoToPage,
}: {
  segments: EpisodeSegment[]
  perPage: number
  onGoToPage: (page: number) => void
}) {
  if (segments.length === 0) {
    return <p className="px-4 py-10 text-center text-xs text-ink-600">還沒有集數。</p>
  }

  return (
    <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
      {segments.map((segment) => {
        // 這一段的第一集落在第幾頁。每頁筆數由使用者選，所以要算不能寫死。
        const page = Math.floor((segment.from - 1) / perPage) + 1

        return (
          <li key={segment.from}>
            <button
              type="button"
              onClick={() => onGoToPage(page)}
              className="panel flex w-full flex-col gap-2 rounded-lg bg-stage-850 p-3 text-left ring-1 ring-stage-700 transition-all hover:ring-stage-600"
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs text-ink-100">
                  EP{String(segment.from).padStart(3, '0')} – EP
                  {String(segment.to).padStart(3, '0')}
                </span>
                <span className="text-xs font-medium text-ink-200 tabular-nums">
                  {toPercent(segment.progress)}%
                </span>
              </span>

              <span className="h-1.5 overflow-hidden rounded-full bg-stage-800">
                <span
                  className="block h-full rounded-full bg-accent-500"
                  style={{ width: `${toPercent(segment.progress)}%` }}
                />
              </span>

              <span className="flex flex-wrap items-center gap-x-3 text-[10px] text-ink-600">
                <span className="text-ink-400 tabular-nums">共 {segment.total} 集</span>
                {segment.done > 0 && (
                  <span className="text-emerald-400 tabular-nums">已完成 {segment.done}</span>
                )}
                {segment.inProgress > 0 && (
                  <span className="text-accent-300 tabular-nums">進行中 {segment.inProgress}</span>
                )}
                {segment.pending > 0 && (
                  <span className="tabular-nums">待處理 {segment.pending}</span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
