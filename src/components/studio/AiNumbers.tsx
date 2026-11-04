'use client'

import { AlertTriangle, ArrowRight, Info, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import type { KindSpend, Projection, SpendSummary, ThroughputRow } from '@/lib/ai/insights'
import type { Finding } from '@/lib/production-findings'
import { convert, formatMoney, type CurrencyValue, type FxRates } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * 花費 / 產能 / 體檢 — the read-only half of 製片中心 (Z127).
 *
 * No state anywhere in this file. Everything is computed on the server from
 * `ai_jobs` and the content tables, so there is nothing here that could
 * disagree with the database — which matters more on this page than on most,
 * because the numbers are about money.
 *
 * Costs are stored and billed in USD. They are shown in USD with the display
 * currency beside the totals rather than converted outright: the provider's
 * invoice will say USD, and a page that only speaks 台幣 makes reconciling it
 * somebody's homework. The exchange date is always shown next to a converted
 * figure (`src/lib/money.ts`).
 */

/* -------------------------------------------------------------------------- */
/* 花費                                                                       */
/* -------------------------------------------------------------------------- */

export function AiSpend({
  spend,
  currency,
  fx,
}: {
  spend: SpendSummary
  currency: CurrencyValue
  fx: FxRates
}) {
  const hasAnything = spend.windows.some((window) => window.jobs > 0)

  if (!hasAnything) {
    return (
      <Empty>
        還沒有任何任務跑完並回報花費。跑過一筆之後，這裡會開始累積每種任務的單價、
        估算準不準，以及照這個速度做完 120 集大概要多少。
      </Empty>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ---- windows --------------------------------------------------- */}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {spend.windows.map((window) => (
          <li
            key={window.key}
            className="flex flex-col gap-0.5 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700/60"
          >
            <span className="text-[10px] text-ink-600">{window.label}</span>
            <span className="text-[15px] text-ink-50 tabular-nums">
              ${window.spent.toFixed(4)}
            </span>
            <span className="text-[10px] text-ink-700 tabular-nums">
              {window.jobs} 筆
              {window.key === 'all' && window.spent > 0 && (
                <>
                  {' · 約 '}
                  {formatMoney(convert(window.spent, 'USD', currency, fx), currency)}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      {spend.overallAccuracy !== null && (
        <Accuracy ratio={spend.overallAccuracy} />
      )}

      {/* ---- per kind --------------------------------------------------- */}
      {spend.byKind.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium text-ink-300">每種任務的單價</h3>
          <ul className="flex flex-col gap-1">
            {spend.byKind.map((row) => (
              <KindSpendRow key={row.kind} row={row} />
            ))}
          </ul>
        </section>
      )}

      {/* ---- projection ------------------------------------------------- */}
      {spend.projections.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-[11px] font-medium text-ink-300">
            <TrendingUp aria-hidden className="size-3" />
            照這個單價做完剩下的集數
          </h3>
          <p className="text-[10px] leading-relaxed text-ink-600">
            用已經跑過的集數的平均單價 × 還沒跑的集數。做過的集數越多，這個數字越可信——
            目前有些是從一兩集推出來的。
          </p>
          <ul className="flex flex-col gap-1">
            {spend.projections.map((row) => (
              <ProjectionRow
                key={`${row.projectId}:${row.kind}`}
                row={row}
                currency={currency}
                fx={fx}
              />
            ))}
          </ul>
          <p className="text-[10px] text-ink-700">匯率日期 {fx.asOf}（{fx.source}）</p>
        </section>
      )}
    </div>
  )
}

/**
 * 估得準不準，以及往哪邊不準.
 *
 * Direction is the whole point. An estimate that over-quotes is a nuisance; one
 * that under-quotes means every confirmation dialog in the app has been
 * telling the two of us a number smaller than the bill.
 */
function Accuracy({ ratio }: { ratio: number }) {
  const percent = Math.round(ratio * 100)
  const close = Math.abs(ratio - 1) < 0.1
  const under = ratio > 1

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg p-3 ring-1',
        close
          ? 'bg-emerald-500/10 ring-emerald-500/20'
          : under
            ? 'bg-amber-500/10 ring-amber-500/20'
            : 'bg-stage-900 ring-stage-700/60'
      )}
    >
      <p className="text-[11px] text-ink-100">
        實際花費是估算的{' '}
        <span className="tabular-nums">{percent}%</span>
      </p>
      <p className="text-[10px] leading-relaxed text-ink-500">
        {close
          ? '估算跟實際幾乎一樣，確認視窗上的數字可以信。'
          : under
            ? '估算偏低——確認視窗上看到的數字比實際帳單小，批次生成前要把這個差距算進去。'
            : '估算偏高，是因為估價抓的是輸出上限，而模型通常寫不到那麼長。偏高不會讓你多付錢。'}
      </p>
    </div>
  )
}

function KindSpendRow({ row }: { row: KindSpend }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg bg-stage-900 px-3 py-2 ring-1 ring-stage-700/60">
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-100">{row.label}</span>
      <span className="text-[11px] text-ink-300 tabular-nums">
        平均 ${row.avgSpent.toFixed(4)}
      </span>
      <span className="text-[10px] text-ink-600 tabular-nums">
        {row.jobs} 筆 · 共 ${row.spent.toFixed(4)}
      </span>
      {row.accuracy !== null && (
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[9px] tabular-nums',
            row.accuracy > 1.1
              ? 'bg-amber-500/15 text-amber-300'
              : 'bg-stage-800 text-ink-500'
          )}
          title={`${row.comparable} 筆同時有估算與實際`}
        >
          估準度 {Math.round(row.accuracy * 100)}%
        </span>
      )}
    </li>
  )
}

function ProjectionRow({
  row,
  currency,
  fx,
}: {
  row: Projection
  currency: CurrencyValue
  fx: FxRates
}) {
  /** One or two episodes is an anecdote, not an average. Say so. */
  const thin = row.episodesDone < 3

  return (
    <li className="flex flex-col gap-0.5 rounded-lg bg-stage-900 px-3 py-2 ring-1 ring-stage-700/60">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[12px] text-ink-100">{row.label}</span>
        <span className="text-[10px] text-ink-600">《{row.projectTitle}》</span>
        <span className="ml-auto text-[13px] text-ink-50 tabular-nums">
          ${row.projected.toFixed(2)}
        </span>
      </div>
      <p className="text-[10px] text-ink-600 tabular-nums">
        已跑 {row.episodesDone} / {row.episodesTotal} 集，平均 ${row.avgPerEpisode.toFixed(4)} 一集，
        剩 {row.remaining} 集 ≈ {formatMoney(convert(row.projected, 'USD', currency, fx), currency)}
        {thin && <span className="ml-1 text-amber-400">（只跑過 {row.episodesDone} 集，參考值）</span>}
      </p>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* 產能                                                                       */
/* -------------------------------------------------------------------------- */

export function AiThroughput({
  byKind,
  byModel,
}: {
  byKind: ThroughputRow[]
  byModel: ThroughputRow[]
}) {
  if (byKind.length === 0) {
    return <Empty>還沒有跑完的任務，所以沒有時間跟成功率可以統計。</Empty>
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-medium text-ink-300">每種任務</h3>
        <p className="text-[10px] leading-relaxed text-ink-600">
          時間取中位數而不是平均——一筆重試過的任務會把平均拉到完全不像下一次的體感。
          成功率不把「取消」算成失敗。
        </p>
        <ul className="flex flex-col gap-1">
          {byKind.map((row) => (
            <ThroughputItem key={row.key} row={row} />
          ))}
        </ul>
      </section>

      {byModel.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium text-ink-300">每個模型</h3>
          <ul className="flex flex-col gap-1">
            {byModel.map((row) => (
              <ThroughputItem key={row.key} row={row} mono />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function ThroughputItem({ row, mono = false }: { row: ThroughputRow; mono?: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg bg-stage-900 px-3 py-2 ring-1 ring-stage-700/60">
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[12px] text-ink-100',
          mono && 'font-mono text-[11px]'
        )}
      >
        {row.label}
      </span>

      {row.medianSec !== null && (
        <span className="text-[11px] text-ink-300 tabular-nums" title="中位數">
          {seconds(row.medianSec)}
        </span>
      )}

      {row.successRate !== null && (
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[9px] tabular-nums',
            row.successRate >= 0.9
              ? 'bg-emerald-500/15 text-emerald-300'
              : row.successRate >= 0.5
                ? 'bg-amber-500/15 text-amber-300'
                : 'bg-rose-500/15 text-rose-300'
          )}
        >
          成功 {Math.round(row.successRate * 100)}%
        </span>
      )}

      <span className="text-[10px] text-ink-600 tabular-nums">
        {row.attempts} 次
        {row.failed > 0 && ` · 失敗 ${row.failed}`}
        {row.cancelled > 0 && ` · 取消 ${row.cancelled}`}
        {row.avgCost !== null && ` · 均價 $${row.avgCost.toFixed(4)}`}
        {row.slowestSec !== null &&
          row.medianSec !== null &&
          row.slowestSec > row.medianSec * 2 &&
          ` · 最慢 ${seconds(row.slowestSec)}`}
      </span>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* 體檢                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 產出跟設定對不上的地方.
 *
 * Deliberately not a list of every episode that is too long. The first run of
 * this check produced eighteen rows that were really two facts, so the server
 * collapses by fact (`src/lib/production-findings.ts`) and this renders the
 * episode numbers inside the one finding.
 */
export function AiFindings({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <Empty>
        沒有發現對不上的地方。這裡檢查的是：作品的目標字數跟目標片長有沒有互相矛盾、
        已寫的字數離目標多遠、劇本預估片長有沒有偏離、小說收尾了劇本有沒有跟上、
        有沒有任務重試到底還是失敗、主角有沒有一集都沒出現。
      </Empty>
    )
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {findings.map((finding) => (
        <li
          key={finding.id}
          className={cn(
            'flex flex-col gap-1 rounded-lg p-3 ring-1',
            finding.severity === 'warn'
              ? 'bg-amber-500/10 ring-amber-500/20'
              : 'bg-stage-900 ring-stage-700/60'
          )}
        >
          <div className="flex items-start gap-2">
            {finding.severity === 'warn' ? (
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
            ) : (
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-ink-100">{finding.title}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ink-400">{finding.detail}</p>
            </div>
            <span className="shrink-0 rounded bg-stage-800/80 px-1.5 py-0.5 text-[9px] text-ink-600">
              {finding.check}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5.5">
            {finding.projectTitle && (
              <span className="text-[10px] text-ink-600">《{finding.projectTitle}》</span>
            )}
            {finding.href && (
              <Link
                href={finding.href}
                className="tap inline-flex items-center gap-1 text-[10px] text-accent-300 hover:text-accent-200"
              >
                去處理
                <ArrowRight aria-hidden className="size-3" />
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/* -------------------------------------------------------------------------- */

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-stage-900 px-3 py-6 text-center text-[11px] leading-relaxed text-ink-600 ring-1 ring-stage-700/60">
      {children}
    </p>
  )
}

/** 「82 秒」 / 「3 分 20 秒」 — a queue is read in both scales. */
function seconds(value: number): string {
  const total = Math.round(value)
  if (total < 60) return `${total} 秒`
  const m = Math.floor(total / 60)
  const s = total % 60
  return s === 0 ? `${m} 分` : `${m} 分 ${s} 秒`
}
