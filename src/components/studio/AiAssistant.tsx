'use client'

import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DiffViewer } from '@/components/ui/DiffViewer'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { AI_JOB_KIND_LABEL, type AiJobKindValue } from '@/lib/constants'
import { formatMoney, type CurrencyValue, type FxRates } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * AI 創作助手 (designs 38–49, the parts that actually run).
 *
 * The flow is deliberately four separate steps — estimate, run, compare,
 * adopt — because each is a decision the pair should get to make:
 *
 *   1. **Estimate before running.** Spec v3 §0:「生成前預估成本」. A button that
 *      silently spends money is the thing this project cannot afford.
 *   2. **Run** enqueues a durable job; the worker executes it. Nothing is
 *      generated in the request/response cycle, so a closed tab does not lose
 *      the work or leave it half-charged.
 *   3. **Compare.** Output arrives as candidates and the job sits in
 *      AWAITING_REVIEW. The diff is against the text currently in the editor.
 *   4. **Adopt** writes the chosen candidate as a new version, with the job id
 *      recorded on it, so every AI-written paragraph can be traced back.
 *
 * Nothing here ever edits the document directly.
 */

export type AiTask = {
  kind: AiJobKindValue
  label: string
  /** Shown under the button, so the pair know what they are about to pay for. */
  hint: string
}

export type AiAssistantProps = {
  projectId: string
  episodeId?: string | null
  /** The text the task operates on; also the left side of the diff. */
  sourceText: string
  /**
   * Per-task override of `sourceText`.
   *
   * Not every task on a surface operates on the same text. 依小說生成劇本 sits
   * in the script editor but must be handed the *novel* — it used to receive
   * the current scene, so the model was asked to adapt a novel it had never
   * been shown, and correctly refused to invent one.
   */
  sourceTextByTask?: Partial<Record<AiJobKindValue, string>>
  tasks: AiTask[]
  currency: CurrencyValue
  fx: FxRates
  /** Called when a candidate is adopted, so the editor can reload. */
  onAdopted?: () => void
  /** Null when no provider is configured; the panel then explains instead. */
  providerReady: boolean
  providerDetail?: string
  /**
   * Which task starts selected.
   *
   * Set by the editor's selection menu. The panel is remounted (keyed) when
   * that changes rather than syncing it into state from a prop, and the
   * estimate is deliberately *not* started automatically: auto-running it
   * would turn a mis-click in a floating menu into a request that costs
   * money. Preselecting the task and letting the writer press 估算成本 keeps
   * the decision explicit and costs one click.
   */
  initialTask?: AiJobKindValue
  /** What the task will run on, when it is narrower than the whole chapter. */
  scopeLabel?: string
}

type Phase = 'idle' | 'estimating' | 'estimated' | 'running' | 'review' | 'failed'

type Candidate = { label: string; content: string }

type JobView = {
  id: string
  status: string
  progress: number
  progressNote: string
  errorMessage: string
  result: { candidates?: Candidate[] } | null
  actualCost: string | null
  estimatedCost: string | null
}

const POLL_MS = 2000

export function AiAssistant({
  projectId,
  episodeId,
  sourceText,
  sourceTextByTask,
  tasks,
  currency,
  fx,
  onAdopted,
  providerReady,
  providerDetail,
  initialTask,
  scopeLabel,
}: AiAssistantProps) {
  const toast = useToast()

  const [task, setTask] = useState<AiJobKindValue>(
    initialTask ?? tasks[0]?.kind ?? 'NOVEL_CONTINUE'
  )
  const [instruction, setInstruction] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [estimate, setEstimate] = useState<{ usd: number; tokens: number } | null>(null)
  const [job, setJob] = useState<JobView | null>(null)
  const [chosen, setChosen] = useState(0)
  const [applying, setApplying] = useState(false)

  /** What this task actually reads. */
  const activeSource = sourceTextByTask?.[task] ?? sourceText

  const body = useCallback(
    () => ({
      task,
      projectId,
      episodeId: episodeId ?? null,
      sourceText: activeSource,
      userInstruction: instruction.trim() || undefined,
      includeWorld: true,
      includeCharacters: true,
      candidates: 1,
    }),
    [task, projectId, episodeId, activeSource, instruction]
  )

  async function runEstimate() {
    setPhase('estimating')
    setEstimate(null)
    try {
      const response = await apiFetch('/api/ai/estimate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body()),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const data = (await response.json()) as {
        estimatedCostUsd: number | null
        estimatedInputTokens?: number
        estimatedOutputTokens?: number
      }

      setEstimate({
        usd: data.estimatedCostUsd ?? 0,
        tokens: (data.estimatedInputTokens ?? 0) + (data.estimatedOutputTokens ?? 0),
      })
      setPhase('estimated')
    } catch (error) {
      setPhase('idle')
      toast.error('無法估算成本', error instanceof Error ? error.message : undefined)
    }
  }

  async function run() {
    setPhase('running')
    setJob(null)
    try {
      const response = await apiFetch('/api/ai/jobs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Re-submitting the same request returns the existing job rather
          // than paying for it twice.
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify(body()),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const data = (await response.json()) as { job: { id: string } }
      setJob({
        id: data.job.id,
        status: 'QUEUED',
        progress: 0,
        progressNote: '已排入佇列',
        errorMessage: '',
        result: null,
        actualCost: null,
        estimatedCost: null,
      })

      /*
       * Nudge the worker. On the Hobby plan cron runs once a day, so without
       * this the job would sit in the queue until 03:00 — correct, but not
       * usable. The worker accepts a signed-in member for exactly this.
       */
      void apiFetch('/api/ai/worker', { method: 'POST' }).catch(() => {})
    } catch (error) {
      setPhase('failed')
      toast.error('無法送出任務', error instanceof Error ? error.message : undefined)
    }
  }

  // Poll while a job is in flight. Stops as soon as it leaves the running
  // states, so a finished job costs nothing to display.
  const jobId = job?.id ?? null
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!jobId || phase !== 'running') return

    let cancelled = false

    const poll = async () => {
      try {
        const response = await apiFetch(`/api/ai/jobs/${jobId}`)
        if (!response.ok) return

        const data = (await response.json()) as { job: JobView }
        if (cancelled) return

        setJob(data.job)

        if (data.job.status === 'AWAITING_REVIEW' || data.job.status === 'SUCCEEDED') {
          setPhase('review')
          return
        }
        if (data.job.status === 'FAILED' || data.job.status === 'CANCELLED') {
          setPhase('failed')
          return
        }

        timer.current = window.setTimeout(poll, POLL_MS)
      } catch {
        timer.current = window.setTimeout(poll, POLL_MS)
      }
    }

    timer.current = window.setTimeout(poll, POLL_MS)

    return () => {
      cancelled = true
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [jobId, phase])

  async function adopt() {
    if (!job || applying) return
    setApplying(true)
    try {
      const response = await apiFetch(`/api/ai/jobs/${job.id}/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateIndex: chosen }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已採用', '內容已寫入新版本，可在版本紀錄回溯')
      setPhase('idle')
      setJob(null)
      setEstimate(null)
      onAdopted?.()
    } catch (error) {
      toast.error('採用失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setApplying(false)
    }
  }

  if (!providerReady) {
    return (
      <EmptyState
        title="AI 尚未啟用"
        description={
          providerDetail ??
          '設定 ANTHROPIC_API_KEY 後才會開放。訂閱方案不等於 API 額度。'
        }
        icon={<Sparkles aria-hidden className="size-5 text-ink-500" />}
        className="py-8"
      />
    )
  }

  const candidates = job?.result?.candidates ?? []

  return (
    <div className="flex flex-col gap-3">
      {scopeLabel && (
        <p className="rounded-lg bg-accent-600/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-accent-200 ring-1 ring-inset ring-accent-500/30">
          {scopeLabel}
        </p>
      )}

      {/* ---- task picker ------------------------------------------------- */}
      <div className="flex flex-col gap-1.5">
        {tasks.map((option) => (
          <button
            key={option.kind}
            type="button"
            onClick={() => {
              setTask(option.kind)
              setPhase('idle')
              setEstimate(null)
            }}
            aria-pressed={task === option.kind}
            disabled={phase === 'running'}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors disabled:opacity-50',
              task === option.kind
                ? 'bg-accent-600/20 ring-1 ring-inset ring-accent-500/40'
                : 'hover:bg-stage-800'
            )}
          >
            <span className="text-[11px] font-medium text-ink-100">{option.label}</span>
            <span className="text-[10px] leading-relaxed text-ink-500">{option.hint}</span>
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-[11px] text-ink-400">
        補充指示（選填）
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          rows={2}
          placeholder="例：語氣再冷一點，保留梅花印記的伏筆"
          disabled={phase === 'running'}
          className="resize-none rounded-lg bg-stage-850 p-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 placeholder:text-ink-700 focus:ring-2 focus:ring-accent-500 focus:outline-none disabled:opacity-50"
        />
      </label>

      {/* ---- estimate / run ---------------------------------------------- */}
      {phase === 'idle' && (
        <button
          type="button"
          onClick={() => void runEstimate()}
          disabled={!activeSource.trim() && task !== 'PROJECT_PLAN'}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-stage-800 px-3 py-2 text-xs text-ink-200 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-50 disabled:opacity-50"
        >
          估算成本
        </button>
      )}

      {phase === 'estimating' && (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-500">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          估算中…
        </p>
      )}

      {phase === 'estimated' && estimate && (
        <div className="flex flex-col gap-2 rounded-lg bg-stage-850 p-3 ring-1 ring-inset ring-stage-700">
          <p className="text-[11px] text-ink-300">
            預估花費約{' '}
            <span className="font-medium text-ink-50">
              {formatMoney(estimate.usd, 'USD')}
            </span>
            {currency !== 'USD' && (
              <span className="text-ink-500">
                （約 {formatMoney(estimate.usd / (fx.rates.USD || 1) * (fx.rates[currency] || 1), currency)}）
              </span>
            )}
          </p>
          <p className="text-[10px] text-ink-600">
            估算約 {estimate.tokens.toLocaleString('en-US')} tokens。實際費用以供應商回報為準，
            跑完後會記進成本帳。
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void run()}
              className="bg-brand-gradient glow-accent-sm flex-1 rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              確認執行
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase('idle')
                setEstimate(null)
              }}
              className="rounded-lg px-3 py-2 text-xs text-ink-400 transition-colors hover:text-ink-100"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* ---- running ------------------------------------------------------ */}
      {phase === 'running' && job && (
        <div className="flex flex-col gap-2 rounded-lg bg-stage-850 p-3 ring-1 ring-inset ring-stage-700">
          <p className="flex items-center gap-1.5 text-[11px] text-ink-300">
            <Loader2 aria-hidden className="size-3.5 animate-spin text-accent-400" />
            {job.progressNote || '執行中…'}
          </p>
          <div className="h-1 overflow-hidden rounded-full bg-stage-800">
            <div
              className="bg-brand-gradient h-full rounded-full transition-all"
              style={{ width: `${Math.max(job.progress, 5)}%` }}
            />
          </div>
          <p className="text-[10px] text-ink-600">
            任務已排入佇列，關掉分頁也會繼續跑，回來看得到結果。
          </p>
        </div>
      )}

      {/* ---- failed -------------------------------------------------------- */}
      {phase === 'failed' && (
        <div className="flex flex-col gap-2 rounded-lg bg-rose-950/60 p-3 text-[11px] text-rose-300 ring-1 ring-inset ring-rose-800">
          <p className="flex items-center gap-1.5">
            <X aria-hidden className="size-3.5" />
            {job?.errorMessage || '任務失敗'}
          </p>
          <button
            type="button"
            onClick={() => {
              setPhase('idle')
              setJob(null)
            }}
            className="self-start rounded-lg px-2 py-1 text-[11px] text-ink-400 transition-colors hover:text-ink-100"
          >
            重新開始
          </button>
        </div>
      )}

      {/* ---- review -------------------------------------------------------- */}
      {phase === 'review' && candidates.length > 0 && (
        <div className="flex flex-col gap-2">
          {candidates.length > 1 && (
            <div className="flex gap-1">
              {candidates.map((candidate, index) => (
                <button
                  key={candidate.label}
                  type="button"
                  onClick={() => setChosen(index)}
                  aria-pressed={chosen === index}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1 text-[10px] transition-colors',
                    chosen === index
                      ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                      : 'text-ink-400 hover:bg-stage-800'
                  )}
                >
                  {candidate.label}
                </button>
              ))}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto rounded-lg bg-stage-850 p-2 ring-1 ring-inset ring-stage-700">
            <DiffViewer
              before={activeSource}
              after={candidates[chosen]?.content ?? ''}
              beforeLabel="目前內容"
              afterLabel={candidates[chosen]?.label ?? '候選'}
              mode="unified"
            />
          </div>

          {job?.actualCost && (
            <p className="text-[10px] text-ink-600">
              實際花費 {formatMoney(Number(job.actualCost), 'USD')}
              {job.estimatedCost && `（估算 ${formatMoney(Number(job.estimatedCost), 'USD')}）`}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void adopt()}
              disabled={applying}
              className="bg-brand-gradient glow-accent-sm inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <Check aria-hidden className="size-3.5" />
              {applying ? '採用中…' : '採用這份'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase('idle')
                setJob(null)
                setEstimate(null)
              }}
              className="rounded-lg px-3 py-2 text-xs text-ink-400 transition-colors hover:text-ink-100"
            >
              不採用
            </button>
          </div>

          <p className="text-[10px] text-ink-700">
            採用會寫成一個新版本，並記下是哪個 AI 任務產生的；原本的內容仍在版本紀錄裡。
          </p>
        </div>
      )}

      {phase === 'review' && candidates.length === 0 && (
        <p className="text-[11px] text-ink-500">任務完成但沒有產生候選內容。</p>
      )}

      <p className="text-[10px] text-ink-700">
        {AI_JOB_KIND_LABEL[task]}・AI 產出一律是候選稿，不會直接覆蓋你的文字。
      </p>
    </div>
  )
}
