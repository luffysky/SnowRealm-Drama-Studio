'use client'

import { AlertTriangle, Layers, Loader2, Play, SearchCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { BATCH_TASKS, MAX_BATCH, type BatchPlan, type BatchTask } from '@/lib/ai/batch-view'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { AI_JOB_KIND_LABEL } from '@/lib/constants'
import { convert, formatMoney, type CurrencyValue, type FxRates } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * 批次生成 (Z127-3).
 *
 * 「EP006–EP020 全部產大綱」 — fifteen trips through the editor's dialog, for
 * a job the two of us will want at every stage of 120 episodes.
 *
 * This is the only screen in the app that can spend real money in one press,
 * which is the whole reason it is two presses:
 *
 *  - **先試算.** The plan comes from the server and lists every episode in
 *    range with either a reason it is in or a reason it is out, plus the sum
 *    of the real per-episode estimates. Never one episode's estimate
 *    multiplied up — the chapters are not the same length, and EP004 is three
 *    times EP001.
 *  - **再送出.** The server re-plans before queueing, because the list on
 *    screen is seconds old and in those seconds 暖寶 may have started the
 *    same job from her editor.
 *
 * Nothing is written to the novel or the script. Every job lands in 待確認,
 * which is the tab next to this one.
 */

export type BatchProject = { id: string; title: string; episodes: number }

export function AiBatch({
  projects,
  currency,
  fx,
  canRun,
}: {
  projects: BatchProject[]
  currency: CurrencyValue
  fx: FxRates
  canRun: boolean
}) {
  const router = useRouter()
  const toast = useToast()

  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [task, setTask] = useState<BatchTask>('NOVEL_TO_SCRIPT')
  const [from, setFrom] = useState('1')
  const [to, setTo] = useState('10')
  const [instruction, setInstruction] = useState('')

  const [plan, setPlan] = useState<BatchPlan | null>(null)
  const [busy, setBusy] = useState<'plan' | 'run' | null>(null)

  if (projects.length === 0) {
    return (
      <p className="rounded-lg bg-stage-900 px-3 py-6 text-center text-[11px] text-ink-600 ring-1 ring-stage-700/60">
        還沒有任何作品可以批次生成。
      </p>
    )
  }

  async function check() {
    setBusy('plan')
    setPlan(null)
    try {
      const params = new URLSearchParams({ projectId, task, from, to })
      const response = await apiFetch(`/api/ai/batch?${params.toString()}`)
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as { plan: BatchPlan }
      setPlan(body.plan)
    } catch (cause) {
      toast.error('試算失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function run() {
    if (!plan || plan.runnable === 0) return
    setBusy('run')
    try {
      const response = await apiFetch('/api/ai/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // keepalive: a batch of thirty takes a while, and navigating away
        // used to kill the request mid-flight (Z126).
        keepalive: true,
        body: JSON.stringify({
          projectId,
          task,
          from: Number(from),
          to: Number(to),
          userInstruction: instruction,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as {
        queued: { number: number }[]
        skipped: { number: number; reason: string }[]
      }

      toast.success(
        `排入 ${body.queued.length} 筆`,
        body.skipped.length > 0
          ? `跳過 ${body.skipped.length} 筆。到佇列按「執行佇列」開始跑。`
          : '到佇列按「執行佇列」開始跑。'
      )
      setPlan(null)
      router.refresh()
    } catch (cause) {
      toast.error('批次送出失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const project = projects.find((row) => row.id === projectId)

  return (
    <div className="flex flex-col gap-3">
      {/* ---- form -------------------------------------------------------- */}
      <div className="flex flex-col gap-2.5 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700/60">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-ink-500">作品</span>
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value)
                setPlan(null)
              }}
              className="rounded-lg bg-stage-800 px-2.5 py-2 text-[12px] text-ink-100 ring-1 ring-stage-700 focus:ring-accent-600 focus:outline-none"
            >
              {projects.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}（{row.episodes} 集）
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-ink-500">要做什麼</span>
            <select
              value={task}
              onChange={(event) => {
                setTask(event.target.value as BatchTask)
                setPlan(null)
              }}
              className="rounded-lg bg-stage-800 px-2.5 py-2 text-[12px] text-ink-100 ring-1 ring-stage-700 focus:ring-accent-600 focus:outline-none"
            >
              {BATCH_TASKS.map((kind) => (
                <option key={kind} value={kind}>
                  {AI_JOB_KIND_LABEL[kind]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-ink-500">從第幾集</span>
            <input
              type="number"
              min={1}
              max={project?.episodes ?? 9999}
              value={from}
              onChange={(event) => {
                setFrom(event.target.value)
                setPlan(null)
              }}
              className="w-20 rounded-lg bg-stage-800 px-2.5 py-2 text-[12px] text-ink-100 tabular-nums ring-1 ring-stage-700 focus:ring-accent-600 focus:outline-none"
            />
          </label>

          <span className="pb-2 text-[11px] text-ink-700">到</span>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-ink-500">第幾集</span>
            <input
              type="number"
              min={1}
              max={project?.episodes ?? 9999}
              value={to}
              onChange={(event) => {
                setTo(event.target.value)
                setPlan(null)
              }}
              className="w-20 rounded-lg bg-stage-800 px-2.5 py-2 text-[12px] text-ink-100 tabular-nums ring-1 ring-stage-700 focus:ring-accent-600 focus:outline-none"
            />
          </label>

          <p className="pb-2 text-[10px] text-ink-700">一次最多 {MAX_BATCH} 集</p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-ink-500">額外指示（選填，每一集都會帶上）</span>
          <input
            type="text"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="例：每集壓在 150 秒內，開場 3 秒要有鉤子"
            className="rounded-lg bg-stage-800 px-2.5 py-2 text-[12px] text-ink-100 ring-1 ring-stage-700 focus:ring-accent-600 focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={() => void check()}
          disabled={busy !== null || !canRun}
          className="tap inline-flex items-center justify-center gap-1.5 self-start rounded-lg bg-stage-800 px-3 py-2 text-[11px] text-ink-200 transition-colors hover:bg-stage-700 hover:text-ink-50 disabled:opacity-50"
        >
          {busy === 'plan' ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <SearchCheck aria-hidden className="size-3.5" />
          )}
          先試算，不送出
        </button>

        {!canRun && (
          <p className="text-[10px] text-ink-600">你的角色沒有執行 AI 任務的權限。</p>
        )}
      </div>

      {/* ---- plan -------------------------------------------------------- */}
      {plan && <PlanView plan={plan} currency={currency} fx={fx} />}

      {plan && plan.runnable > 0 && canRun && (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy !== null}
          className="bg-brand-gradient glow-accent-sm tap inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy === 'run' ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <Play aria-hidden className="size-3.5" />
          )}
          把這 {plan.runnable} 集排入佇列
          {plan.estimatedTotal !== null && `（估 $${plan.estimatedTotal.toFixed(4)}）`}
        </button>
      )}
    </div>
  )
}

function PlanView({
  plan,
  currency,
  fx,
}: {
  plan: BatchPlan
  currency: CurrencyValue
  fx: FxRates
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-stage-900 px-3 py-2.5 ring-1 ring-stage-700/60">
        <span className="flex items-center gap-1.5 text-[12px] text-ink-100">
          <Layers aria-hidden className="size-3.5 text-accent-400" />
          要跑 {plan.runnable} 集
        </span>
        {plan.skipped > 0 && (
          <span className="text-[11px] text-ink-500">跳過 {plan.skipped} 集</span>
        )}
        {plan.estimatedTotal !== null ? (
          <span className="ml-auto text-[12px] text-ink-50 tabular-nums">
            估 ${plan.estimatedTotal.toFixed(4)}
            <span className="ml-1.5 text-[10px] text-ink-600">
              ≈ {formatMoney(convert(plan.estimatedTotal, 'USD', currency, fx), currency)}
            </span>
          </span>
        ) : (
          plan.runnable > 0 && (
            <span className="ml-auto text-[10px] text-ink-600">這個供應商無法事先估價</span>
          )
        )}
      </div>

      {plan.capped && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-200 ring-1 ring-amber-500/20">
          <AlertTriangle aria-hidden className="mt-px size-3 shrink-0" />
          你選的範圍超過 {MAX_BATCH} 集，只會處理前 {MAX_BATCH} 集。剩下的再按一次。
        </p>
      )}

      <ul className="flex flex-col gap-0.5">
        {plan.candidates.map((row) => (
          <li
            key={row.episodeId}
            className={cn(
              'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded px-2.5 py-1.5 text-[11px]',
              row.skipReason === null ? 'bg-stage-900' : 'bg-stage-900/40'
            )}
          >
            <span
              className={cn(
                'tabular-nums',
                row.skipReason === null ? 'text-ink-100' : 'text-ink-700'
              )}
            >
              EP{String(row.number).padStart(3, '0')}
            </span>

            {row.title && (
              <span className="min-w-0 max-w-[12rem] truncate text-[10px] text-ink-600">
                {row.title}
              </span>
            )}

            {row.skipReason === null ? (
              <>
                <span className="text-[10px] text-ink-600 tabular-nums">
                  {row.novelChars > 0 && `小說 ${row.novelChars.toLocaleString('zh-TW')} 字`}
                  {row.scriptScenes > 0 && ` · 劇本 ${row.scriptScenes} 場`}
                </span>
                <span className="ml-auto text-[10px] text-accent-300">要跑</span>
              </>
            ) : (
              <span className="ml-auto text-[10px] text-ink-600">{row.skipReason}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
