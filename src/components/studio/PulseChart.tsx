'use client'

import { useState } from 'react'
import type { PulsePoint } from '@/lib/dashboard'
import { cn } from '@/lib/utils'

/**
 * 動態脈搏（Z191）。
 *
 * 一天一根，滑過（或用鍵盤走到）哪一根就把那天的數字讀出來。之所以是用戶端
 * 元件，就只為了這件事——儀表板其餘部分仍然在伺服器端算完才送出來。
 *
 * ## 為什麼不是「製作進度趨勢」
 *
 * 原本那張圖讀 `production_progress_events`，而那張表在正式庫裡是**零筆**，
 * 所以它從上線到現在沒畫出過任何東西。這張讀 `activities`，六百多筆帶時間的
 * 真紀錄。兩張都是量到的歷史，差別只在哪一張真的有東西可畫。
 */

/** 系列的順序＝堆疊由下往上的順序。 */
const SERIES = [
  { key: 'created', label: '新增', className: 'bg-emerald-500/80' },
  { key: 'updated', label: '修改', className: 'bg-accent-500/75' },
  { key: 'uploaded', label: '上傳', className: 'bg-sky-500/70' },
  { key: 'ai', label: 'AI', className: 'bg-gilt-400/70' },
] as const

export function PulseChart({ points, days }: { points: PulsePoint[]; days: number }) {
  const [active, setActive] = useState<number | null>(null)

  const max = Math.max(1, ...points.map((point) => point.total))
  const shown = active !== null ? points[active] : null
  const total = points.reduce((n, point) => n + point.total, 0)

  /*
   * 其餘動作（刪除、版本、還原、解鎖審核）不是自己一個系列——四個系列加起來
   * 跟 `total` 對不上的那一截畫成灰的。不這樣做的話長條會比它代表的數字短，
   * 而那是一張會說謊的圖。
   */
  const otherOf = (point: PulsePoint) =>
    Math.max(point.total - point.created - point.updated - point.uploaded - point.ai, 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm text-ink-100 tabular-nums">
          {shown ? (
            <>
              <span className="text-ink-400">{shown.label}</span>
              <span className="ml-2 font-semibold">{shown.total}</span>
              <span className="ml-1 text-xs font-normal text-ink-500">筆</span>
            </>
          ) : (
            <>
              <span className="text-ink-400">近 {days} 天</span>
              <span className="ml-2 font-semibold">{total.toLocaleString('en-US')}</span>
              <span className="ml-1 text-xs font-normal text-ink-500">筆動態</span>
            </>
          )}
        </p>

        <ul className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-ink-500">
          {SERIES.map((series) => (
            <li key={series.key} className="inline-flex items-center gap-1">
              <span aria-hidden className={cn('size-2 rounded-sm', series.className)} />
              {series.label}
              {shown && <span className="text-ink-300 tabular-nums">{shown[series.key]}</span>}
            </li>
          ))}
        </ul>
      </div>

      <div
        className="flex h-36 items-end gap-px"
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        {points.map((point, index) => {
          const other = otherOf(point)
          return (
            <button
              key={point.day}
              type="button"
              // 讀出來的是上面那一行，所以按鈕自己只需要一個說得清楚的名字。
              aria-label={`${point.label}：${point.total} 筆動態`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              className={cn(
                'group flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-sm outline-none',
                active === index ? 'bg-stage-800/70' : 'hover:bg-stage-800/40'
              )}
            >
              {point.total === 0 ? (
                /*
                 * 沒有動態的那一天畫一條細線，不是留白。
                 *
                 * 完全空白看起來像「圖畫壞了」，而一條貼著底的線看起來像
                 * 「這天沒做事」——後者才是事實。
                 */
                <span aria-hidden className="h-px w-full rounded-full bg-stage-700" />
              ) : (
                <span
                  aria-hidden
                  className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
                  style={{ height: `${(point.total / max) * 100}%` }}
                >
                  {SERIES.map((series) =>
                    point[series.key] > 0 ? (
                      <span
                        key={series.key}
                        className={cn('w-full', series.className)}
                        style={{ flex: `${point[series.key]} 1 0%` }}
                      />
                    ) : null
                  )}
                  {other > 0 && (
                    <span className="w-full bg-ink-700/70" style={{ flex: `${other} 1 0%` }} />
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/*
        軸只標首尾。七天時每一根都標還擠得下，九十天時標籤會疊成一團黑——而
        首尾兩個日期已經說完了「這張圖的範圍是哪裡到哪裡」。
      */}
      <div className="flex justify-between text-[10px] text-ink-700 tabular-nums">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  )
}
