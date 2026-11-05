'use client'

import { Activity, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import type { HealthReport } from '@/lib/health'

/**
 * 系統健康，隨時看得到 (Z161).
 *
 * 這一顆按鈕有兩個理由：
 *
 *  1. **排程的那份報告，人要能自己叫一次。** 每天早上收到「有三個失敗任
 *     務」之後，第一個動作是重新看一眼現在怎麼樣——如果只有排程叫得到，那
 *     就只能等明天。
 *  2. **`/api/health` 要有介面叫得到。** `npm run check:api` 要求每一支 API
 *     在介面上都按得到，而那條規則存在的理由正是這個專案一再出現的「寫好了
 *     沒有人用」。一支只有排程打得到的端點，會在排程壞掉的那天變成沒有人知
 *     道它壞了。
 */
export function HealthPanel() {
  const toast = useToast()
  const [report, setReport] = useState<HealthReport | null>(null)
  const [busy, setBusy] = useState(false)

  async function check() {
    if (busy) return
    setBusy(true)
    try {
      const response = await apiFetch('/api/health')
      if (!response.ok) throw new Error(await readApiError(response))
      setReport((await response.json()) as HealthReport)
    } catch (cause) {
      toast.error('看不到狀態', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy}
          className="tap inline-flex items-center gap-1.5 rounded-lg bg-stage-800 px-3 py-1.5 text-[11px] text-ink-200 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-50 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Activity aria-hidden className="size-3.5 text-accent-400" />
          )}
          立刻檢查
        </button>
        <span className="text-[10px] text-ink-600">
          每天早上的排程打的是同一支，所以這裡看到的跟它回報的一樣
        </span>
      </div>

      {report && (
        <div className="flex flex-col gap-2 rounded-lg bg-stage-900 p-3 text-[11px] ring-1 ring-stage-700/60">
          <p className="text-[10px] text-ink-600">資料庫：{report.database}</p>

          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <Row label="AI 任務">
              失敗 {report.jobs.failed}、排隊 {report.jobs.queued}、執行中{' '}
              {report.jobs.running}、等確認 {report.jobs.awaitingReview}
              {report.jobs.stuck > 0 && (
                <span className="ml-1 text-rose-400">（{report.jobs.stuck} 個卡死）</span>
              )}
            </Row>
            <Row label="匯率">
              {report.fx.asOf}
              <span className="ml-1 text-ink-600">{report.fx.source}</span>
            </Row>
            <Row label="定稿鎖住">
              {report.locks.total} 份
              {report.locks.stale > 0 && (
                <span className="ml-1 text-amber-400">（{report.locks.stale} 份超過一週）</span>
              )}
            </Row>
            <Row label="本月花費">
              {report.spend.monthToDateUsd.toFixed(4)} USD
              <span className="ml-1 text-ink-600">{report.spend.since} 起</span>
            </Row>
          </dl>

          {report.jobs.recentFailures.length > 0 && (
            <ul className="flex flex-col gap-0.5 border-t border-stage-800 pt-2">
              {report.jobs.recentFailures.map((failure) => (
                <li key={`${failure.kind}-${failure.at}`} className="text-[10px] text-ink-500">
                  <span className="font-mono text-ink-400">{failure.kind}</span>
                  {failure.message}
                </li>
              ))}
            </ul>
          )}

          {report.problems.length === 0 && report.notes.length === 0 ? (
            <p className="inline-flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 aria-hidden className="size-3.5" />
              沒有需要處理的
            </p>
          ) : (
            <ul className="flex flex-col gap-1 border-t border-stage-800 pt-2">
              {report.notes.map((note) => (
                <li key={note} className="inline-flex items-start gap-1.5 text-ink-400">
                  <AlertTriangle aria-hidden className="mt-px size-3 shrink-0 text-ink-600" />
                  {note}
                </li>
              ))}
              {report.problems.map((problem) => (
                <li key={problem} className="inline-flex items-start gap-1.5 text-amber-300">
                  <AlertTriangle aria-hidden className="mt-px size-3 shrink-0" />
                  {problem}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="text-ink-600">{label}</dt>
      <dd className="text-ink-200">{children}</dd>
    </div>
  )
}
