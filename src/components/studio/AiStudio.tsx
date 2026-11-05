'use client'

import { AlertTriangle, Ban, CheckCircle2, Loader2, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { AddProvider, TestProvider } from '@/components/studio/ProviderForm'
import { useEffect, useState } from 'react'
import { Tabs } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { AiBatch, type BatchProject } from '@/components/studio/AiBatch'
import { AiInbox } from '@/components/studio/AiInbox'
import { AiFindings, AiSpend, AiThroughput } from '@/components/studio/AiNumbers'
import type { InboxItem, SpendSummary, ThroughputRow } from '@/lib/ai/insights'
import type { Finding } from '@/lib/production-findings'
import type { CurrencyValue, FxRates } from '@/lib/money'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import {
  AI_JOB_KIND_LABEL,
  AI_JOB_STATUSES,
  AI_JOB_STATUS_LABEL,
  type AiJobKindValue,
  type AiJobStatusValue,
} from '@/lib/constants'
import { cn } from '@/lib/utils'

/**
 * AI 製片中心 (Z88, rebuilt Z127).
 *
 * It started as two questions — what is the queue doing, is the provider
 * reachable — and 「只是一堆排程那沒必要特別做」 was a fair verdict on that.
 * A queue with statuses is a database client with rounded corners.
 *
 * What a production centre owes you is the things no single row can tell you,
 * so there are now five tabs:
 *
 * | 分頁 | 回答 |
 * |---|---|
 * | 待確認 | 已經付錢產出、但還沒人看的東西（最有感的一個） |
 * | 體檢 | 產出跟設定對不上的地方 |
 * | 批次 | 一次下一整段集數 |
 * | 花費 | 花了多少、估得準不準、120 集要多少 |
 * | 產能 | 每種任務多久、失敗率、哪個模型划算 |
 * | 佇列 | 原本的那兩個問題 |
 *
 * 待確認 is the default when anything is in it, because the whole point of
 * finding out two outlines had been waiting a day is not having to go looking
 * for the third.
 *
 * It refreshes itself while anything is still running, and stops when nothing
 * is. A queue page that polls forever is a page that keeps a laptop warm all
 * night to tell you the same thing.
 */

export type QueueJob = {
  id: string
  kind: AiJobKindValue
  status: AiJobStatusValue
  model: string
  projectId: string | null
  projectTitle: string
  episodeNumber: number | null
  attemptCount: number
  maxAttempts: number
  errorMessage: string
  estimatedCost: string | null
  actualCost: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type ProviderCard = {
  id: string
  name: string
  kind: string
  enabled: boolean
  defaultModel: string
  keyHint: string
  available: boolean
  detail: string
}

const LIVE: AiJobStatusValue[] = ['QUEUED', 'RUNNING', 'AWAITING_PROVIDER']

const STATUS_TONE: Record<AiJobStatusValue, string> = {
  QUEUED: 'bg-stage-800 text-ink-400',
  RUNNING: 'bg-accent-600/20 text-accent-300',
  AWAITING_PROVIDER: 'bg-accent-600/15 text-accent-300',
  AWAITING_REVIEW: 'bg-amber-500/15 text-amber-300',
  SUCCEEDED: 'bg-emerald-500/15 text-emerald-300',
  FAILED: 'bg-rose-500/15 text-rose-300',
  CANCELLED: 'bg-stage-800 text-ink-600',
}

export type AiStudioData = {
  jobs: QueueJob[]
  counts: Record<string, number>
  providers: ProviderCard[]
  inbox: InboxItem[]
  spend: SpendSummary
  throughput: { byKind: ThroughputRow[]; byModel: ThroughputRow[] }
  findings: Finding[]
  batchProjects: BatchProject[]
  currency: CurrencyValue
  fx: FxRates
  canRun: boolean
  /**
   * 能不能新增／測試供應商 (Z146).
   *
   * 分開一個旗標，不跟 `canRun` 共用：跑任務是日常，換金鑰不是。
   */
  canManageProviders: boolean
  /**
   * 可選的模型清單，從伺服器傳下來。
   *
   * 不在用戶端 import `lib/ai/anthropic`——那個檔案在模組層就 import 了
   * Anthropic SDK，拉進瀏覽器包裡是白白的幾十 KB，而我們只要一個字串陣列。
   */
  models: string[]
}

type PanelId = 'inbox' | 'findings' | 'batch' | 'spend' | 'throughput' | 'queue'

export function AiStudio({
  jobs,
  counts,
  providers,
  inbox,
  spend,
  throughput,
  findings,
  batchProjects,
  currency,
  fx,
  canRun,
  canManageProviders,
  models,
}: AiStudioData) {
  const router = useRouter()
  const toast = useToast()

  const [filter, setFilter] = useState<AiJobStatusValue | 'all'>('all')
  const [busy, setBusy] = useState<string | null>(null)

  /*
   * Lands on whatever is actually waiting for a person. Checked once on mount
   * rather than kept in step with the data: switching the tab out from under
   * somebody because a job finished is worse than a stale default.
   */
  const [panel, setPanel] = useState<PanelId>(() =>
    inbox.length > 0 ? 'inbox' : findings.some((f) => f.severity === 'warn') ? 'findings' : 'queue'
  )

  const running = jobs.filter((job) => LIVE.includes(job.status)).length

  /*
   * Polls only while something is actually in flight. `router.refresh()`
   * re-runs the server component, so the numbers come from the database
   * rather than from a client-side guess at what the worker is doing.
   */
  useEffect(() => {
    if (running === 0) return
    const timer = window.setInterval(() => router.refresh(), 4000)
    return () => window.clearInterval(timer)
  }, [running, router])

  /**
   * Runs the queue now (Z114).
   *
   * The worker is triggered by a signed-in member, not only by cron — cron
   * is once a day on this plan. A job stuck at 等待中 almost always means the
   * nudge from wherever it was started never landed, and this is that nudge.
   */
  async function wake() {
    setBusy('worker')
    try {
      const response = await apiFetch('/api/ai/worker', { method: 'POST', keepalive: true })
      if (!response.ok) throw new Error(await readApiError(response))
      const report = (await response.json()) as { claimed?: number }
      toast.success(
        report.claimed ? `開始執行 ${report.claimed} 筆` : '佇列裡沒有可以執行的任務'
      )
      router.refresh()
    } catch (cause) {
      toast.error('叫不動背景工作', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function act(jobId: string, what: 'cancel' | 'retry') {
    setBusy(jobId)
    try {
      const response = await apiFetch(`/api/ai/jobs/${jobId}/${what}`, { method: 'POST' })
      if (!response.ok) throw new Error(await readApiError(response))
      toast.success(what === 'cancel' ? '已取消' : '已重新排入佇列')
      router.refresh()
    } catch (cause) {
      toast.error(
        what === 'cancel' ? '取消失敗' : '重試失敗',
        cause instanceof Error ? cause.message : undefined
      )
    } finally {
      setBusy(null)
    }
  }

  const shown = filter === 'all' ? jobs : jobs.filter((job) => job.status === filter)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-medium text-ink-50">AI 製片中心</h1>
        <p className="text-[11px] text-ink-500">
          跨作品的花費、產能與待確認產出。單集的生成在那一集自己的頁面做，這裡只排隊、不寫正文。
        </p>
      </header>

      <Tabs
        appearance="pill"
        activeId={panel}
        onChange={(id) => setPanel(id as PanelId)}
        tabs={[
          { id: 'inbox', label: '待確認', badge: inbox.length > 0 ? inbox.length : undefined },
          {
            id: 'findings',
            label: '體檢',
            badge: findings.length > 0 ? findings.length : undefined,
          },
          { id: 'batch', label: '批次生成' },
          { id: 'spend', label: '花費' },
          { id: 'throughput', label: '產能' },
          { id: 'queue', label: '佇列', badge: running > 0 ? running : undefined },
        ]}
      />

      {panel === 'inbox' && <AiInbox items={inbox} canRun={canRun} />}

      {panel === 'findings' && <AiFindings findings={findings} />}

      {panel === 'batch' && (
        <AiBatch projects={batchProjects} currency={currency} fx={fx} canRun={canRun} />
      )}

      {panel === 'spend' && <AiSpend spend={spend} currency={currency} fx={fx} />}

      {panel === 'throughput' && (
        <AiThroughput byKind={throughput.byKind} byModel={throughput.byModel} />
      )}

      {panel === 'queue' && (
        <>
        {/* ---- providers --------------------------------------------------- */}
        <section className="flex flex-col gap-2">
          <h2 className="text-[11px] font-medium text-ink-300">供應商</h2>

          {providers.length === 0 ? (
            <p className="rounded-lg bg-stage-900 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500 ring-1 ring-stage-700/60">
              還沒有設定任何供應商。目前是用環境變數裡的{' '}
              <span className="font-mono text-ink-400">ANTHROPIC_API_KEY</span> 在跑——
              {canManageProviders
                ? '能用，但換金鑰要重新部署。在這裡新增一個就不用了。'
                : '能用，但換金鑰要重新部署。'}
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {providers.map((provider) => (
                <li
                  key={provider.id}
                  className="flex flex-col gap-1 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700/60"
                >
                  <div className="flex items-center gap-2">
                    {provider.available ? (
                      <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-emerald-400" />
                    ) : (
                      <AlertTriangle aria-hidden className="size-3.5 shrink-0 text-amber-400" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-100">
                      {provider.name}
                    </span>
                    {!provider.enabled && (
                      <span className="shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[9px] text-ink-600">
                        已停用
                      </span>
                    )}
                  </div>

                  <p className="text-[10px] leading-relaxed text-ink-500">
                    {provider.detail || (provider.available ? '可以用。' : '連不上。')}
                  </p>

                  <p className="flex flex-wrap gap-x-3 text-[10px] text-ink-700">
                    <span className="font-mono">{provider.kind}</span>
                    {provider.defaultModel && (
                      <span className="font-mono">{provider.defaultModel}</span>
                    )}
                    {provider.keyHint && <span className="font-mono">金鑰 ⋯{provider.keyHint}</span>}
                  </p>

                  {/*
                   * 測試連線 (Z146)。這支端點寫好很久了，介面上一直沒有地方
                   * 按得到——所以「這把金鑰到底還能不能用」只能靠排一個真的
                   * 任務下去試。
                   */}
                  {canManageProviders && <TestProvider providerId={provider.id} />}
                </li>
              ))}
            </ul>
          )}

          {canManageProviders && <AddProvider models={models} />}
        </section>

        {/* ---- queue ------------------------------------------------------- */}
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[11px] font-medium text-ink-300">任務佇列</h2>
            {running > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-accent-300">
                <Loader2 aria-hidden className="size-3 animate-spin" />
                {running} 個進行中，每 4 秒更新
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {canRun && (counts.QUEUED ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => void wake()}
                  disabled={busy === 'worker'}
                  className="tap inline-flex items-center gap-1 rounded-lg bg-accent-600 px-2 py-1 text-[10px] text-white transition-colors hover:bg-accent-500 disabled:opacity-50"
                >
                  {busy === 'worker' ? (
                    <Loader2 aria-hidden className="size-3 animate-spin" />
                  ) : (
                    <Play aria-hidden className="size-3" />
                  )}
                  執行佇列
                </button>
              )}
              <button
                type="button"
                onClick={() => router.refresh()}
                className="tap inline-flex items-center gap-1 rounded-lg bg-stage-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-stage-700"
              >
                <RefreshCw aria-hidden className="size-3" />
                重新整理
              </button>
            </div>
          </div>

          <ul className="flex flex-wrap gap-1.5">
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
              全部 {jobs.length}
            </Chip>
            {AI_JOB_STATUSES.filter((status) => (counts[status] ?? 0) > 0).map((status) => (
              <Chip key={status} active={filter === status} onClick={() => setFilter(status)}>
                {AI_JOB_STATUS_LABEL[status]} {counts[status]}
              </Chip>
            ))}
          </ul>

          {shown.length === 0 ? (
            <p className="rounded-lg bg-stage-900 px-3 py-6 text-center text-[11px] text-ink-600 ring-1 ring-stage-700/60">
              {jobs.length === 0 ? '還沒有任何 AI 任務。' : '這個狀態底下沒有任務。'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {shown.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-col gap-1.5 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700/60"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'shrink-0 rounded px-1.5 py-0.5 text-[9px]',
                        STATUS_TONE[job.status]
                      )}
                    >
                      {AI_JOB_STATUS_LABEL[job.status]}
                    </span>

                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-100">
                      {AI_JOB_KIND_LABEL[job.kind] ?? job.kind}
                    </span>

                    <span className="shrink-0 text-[10px] text-ink-600 tabular-nums">
                      {formatWhen(job.createdAt)}
                    </span>
                  </div>

                  <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-600">
                    {job.projectTitle && <span>{job.projectTitle}</span>}
                    {job.episodeNumber !== null && (
                      <span className="tabular-nums">
                        EP{String(job.episodeNumber).padStart(3, '0')}
                      </span>
                    )}
                    {job.model && <span className="font-mono">{job.model}</span>}
                    {job.attemptCount > 1 && (
                      <span>
                        第 {job.attemptCount} / {job.maxAttempts} 次
                      </span>
                    )}
                    <Cost estimated={job.estimatedCost} actual={job.actualCost} />
                  </p>

                  {job.errorMessage && (
                    <p className="rounded bg-rose-500/10 px-2 py-1 text-[10px] leading-relaxed text-rose-200">
                      {job.errorMessage}
                    </p>
                  )}

                  {canRun && (
                    <div className="flex items-center gap-1.5">
                      {LIVE.includes(job.status) && (
                        <button
                          type="button"
                          onClick={() => void act(job.id, 'cancel')}
                          disabled={busy === job.id}
                          className="tap inline-flex items-center gap-1 rounded-md bg-stage-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-50"
                        >
                          {busy === job.id ? (
                            <Loader2 aria-hidden className="size-3 animate-spin" />
                          ) : (
                            <Ban aria-hidden className="size-3" />
                          )}
                          取消
                        </button>
                      )}

                      {job.status === 'FAILED' && (
                        <button
                          type="button"
                          onClick={() => void act(job.id, 'retry')}
                          disabled={busy === job.id}
                          className="tap inline-flex items-center gap-1 rounded-md bg-stage-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100 disabled:opacity-50"
                        >
                          {busy === job.id ? (
                            <Loader2 aria-hidden className="size-3 animate-spin" />
                          ) : (
                            <RotateCcw aria-hidden className="size-3" />
                          )}
                          重試
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        </>
      )}

    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'tap rounded-full px-2.5 py-1 text-[10px] transition-colors',
          active ? 'bg-accent-600 text-white' : 'bg-stage-800 text-ink-400 hover:text-ink-100'
        )}
      >
        {children}
      </button>
    </li>
  )
}

/**
 * Estimate and actual, side by side.
 *
 * Shown together deliberately: the estimate is what the cost dialog promised
 * before the run, and the only way to find out the estimate is wrong is to see
 * them next to each other.
 */
function Cost({ estimated, actual }: { estimated: string | null; actual: string | null }) {
  const spent = actual ? Number(actual) : null
  const guess = estimated ? Number(estimated) : null

  if (spent === null && guess === null) return null

  return (
    <span className="tabular-nums">
      {spent !== null ? `$${spent.toFixed(4)}` : '—'}
      {guess !== null && (
        <span className="text-ink-700"> / 估 ${guess.toFixed(4)}</span>
      )}
    </span>
  )
}

/** Clock for today, date before that. A queue is mostly read on the day. */
function formatWhen(iso: string): string {
  const at = new Date(iso)
  const sameDay = new Date().toDateString() === at.toDateString()

  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    ...(sameDay
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }
      : { month: '2-digit', day: '2-digit' }),
  }).format(at)
}
