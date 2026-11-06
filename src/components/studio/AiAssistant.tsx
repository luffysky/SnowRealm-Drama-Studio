'use client'

import { Check, CornerDownLeft, Loader2, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DiffViewer } from '@/components/ui/DiffViewer'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { AI_JOB_KIND_LABEL, type AiJobKindValue } from '@/lib/constants'
import { TASKS_READING_NOVEL, TASKS_WITHOUT_SOURCE } from '@/lib/ai/prompts'
import type { AiEstimateResponse } from '@/lib/ai/types'
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

/**
 * 每個任務各自的採用設定 (Z30).
 *
 * 為什麼是 record 而不是掛在 `AiTask` 上：`AiTask[]` 是一個 prop 陣列，而
 * React Compiler 不接受「對 prop 陣列做 `.find()` 再放進 `useCallback` 的
 * 相依陣列」——它無法證明那個陣列之後不會被改，於是整個元件的最佳化被跳
 * 過（`react-hooks/preserve-manual-memoization`，而那是 error 不是 warning）。
 * 用 key 查一個 record 它接受，而這個檔案裡 `sourceTextByTask` 早就是這個
 * 形狀了——同一個問題的同一個解法，不要在旁邊放第二種。
 */
export type TaskApply = {
  /**
   * 這一個任務採用時寫到哪裡去。
   *
   * 元件層級也有一個 `targetType`，但它對整個面板一視同仁——而一個面板上常
   * 常是「一個會寫入、一個只是分析」：劇本編輯器同時掛著 `NOVEL_TO_SCRIPT`
   * （要寫成場次）與 `SCRIPT_ANALYZE`（只該回報，不該碰任何東西）。
   * 在元件上給一個 targetType 會把分析那一個也標成有寫入目標。
   */
  targetType?: string
  /**
   * 一句話說出這份候選會變成什麼。
   *
   * 結構化輸出的候選內容是一段 JSON，而面板預設是拿它跟目前內容做 diff——
   * 那個 diff 是純雜訊。有這個函式就印摘要並原樣顯示內容，沒有就照舊 diff。
   */
  summarize?: (content: string) => string | null
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
  /**
   * Episodes whose novel 依小說生成劇本 can adapt (Z113).
   *
   * The list only — the prose is read server-side when the job runs. Only
   * episodes that actually have writing in them appear: an empty one is not
   * a source, and offering it is offering a button that spends money to be
   * told there is nothing to read.
   */
  novelSources?: { id: string; number: number; title: string; charCount: number }[]
  tasks: AiTask[]
  /** Per-task adopt settings; see `TaskApply`. */
  applyByTask?: Partial<Record<AiJobKindValue, TaskApply>>
  currency: CurrencyValue
  fx: FxRates
  /** Called when a candidate is adopted, so the editor can reload. */
  onAdopted?: () => void
  /**
   * Where the text should go, when the surface owns a document (Z122).
   *
   * Present: the panel offers 插在游標處 / 覆蓋整章 and hands the content
   * over. Absent: it falls back to the server-side apply, which is right for
   * surfaces whose output is not a document.
   */
  onAdopt?: (content: string, mode: 'insert' | 'replace') => Promise<void> | void
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
  /**
   * 採用時要寫到哪裡去 (Z71).
   *
   * 不給的話 `applyCandidate` 沒有目標，於是採用只會把任務標成已採用、一個
   * 字都沒改——而面板會照實說「還沒有自動寫回」。分鏡要的是
   * `episode_shots`，它有專屬的寫入分支。
   */
  targetType?: string
  targetId?: string | null
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

/**
 * How long a job may sit at QUEUED before the panel says something.
 *
 * The worker normally starts within a second of the nudge. Fifteen is long
 * enough that a slow cold start is not called a failure, and short enough
 * that nobody sits watching a spinner wondering.
 */
const STALL_MS = 15_000

export function AiAssistant({
  projectId,
  episodeId,
  sourceText,
  sourceTextByTask,
  novelSources,
  tasks,
  applyByTask,
  currency,
  fx,
  onAdopted,
  onAdopt,
  providerReady,
  providerDetail,
  initialTask,
  scopeLabel,
  targetType,
  targetId,
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
  /** The job was accepted but nothing has picked it up. */
  const [stalled, setStalled] = useState(false)
  const [waking, setWaking] = useState(false)

  /**
   * Which episode's novel to adapt. Defaults to the one being written, which
   * is right almost always — the picker is for the scene that carries over.
   */
  const [novelFrom, setNovelFrom] = useState<string>(
    () => novelSources?.find((source) => source.id === episodeId)?.id ?? novelSources?.[0]?.id ?? ''
  )

  /** Tasks that adapt a novel rather than the text on screen. */
  const readsNovel = TASKS_READING_NOVEL.has(task)
  const novelSource = novelSources?.find((source) => source.id === novelFrom) ?? null

  /** What this task actually reads. */
  const activeSource = sourceTextByTask?.[task] ?? sourceText

  /** This task's adopt settings, if it has any. */
  const activeApply = applyByTask?.[task]
  const activeTarget = activeApply?.targetType ?? targetType

  const body = useCallback(
    () => ({
      task,
      projectId,
      episodeId: episodeId ?? null,
      // The server reads the prose; the client only names the episode.
      ...(readsNovel ? { novelEpisodeId: novelFrom || null } : {}),
      sourceText: readsNovel ? '' : activeSource,
      userInstruction: instruction.trim() || undefined,
      includeWorld: true,
      includeCharacters: true,
      candidates: 1,
      ...(activeTarget ? { targetType: activeTarget } : {}),
      ...(targetId ? { targetId } : {}),
    }),
    [
      task,
      projectId,
      episodeId,
      activeSource,
      instruction,
      readsNovel,
      novelFrom,
      activeTarget,
      targetId,
    ]
  )

  /*
   * Whether there is anything to work on. Previously this was only
   * `activeSource`, and a novel task had no source on the client at all —
   * it is read on the server now, so readiness is 「選到了一集有字的」.
   */
  const ready = readsNovel
    ? Boolean(novelSource && novelSource.charCount > 0)
    : Boolean(activeSource.trim()) || TASKS_WITHOUT_SOURCE.has(task)

  /**
   * Asks the worker to run now, and says so when it cannot.
   *
   * Separate from the enqueue so 「立刻執行」 can call it again: a job that
   * is still QUEUED is almost always a nudge that did not land, and the one
   * thing that fixes it is another nudge.
   */
  /**
   * Hands the chosen candidate to the surface that owns the text (Z122).
   *
   * The panel does not know whether it is beside a novel chapter or a scene,
   * so it does not try to write: it passes the content and the choice up, and
   * the editor does what its own document needs.
   */
  async function adoptInto(mode: 'insert' | 'replace') {
    const content = candidates[chosen]?.content
    if (!content || !onAdopt || applying) return

    setApplying(true)
    try {
      await onAdopt(content, mode)
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

  async function nudge(): Promise<boolean> {
    try {
      /*
       * `keepalive` so the request survives the page (Z126).
       *
       * The worker runs *inside* this request. Without keepalive the browser
       * aborts it the moment you navigate — and the job it had already
       * claimed was left at 執行中 with a lock, looking busy, forever. That
       * is what「按了沒反應」actually was.
       */
      const response = await apiFetch('/api/ai/worker', { method: 'POST', keepalive: true })
      if (!response.ok) {
        setStalled(true)
        return false
      }
      return true
    } catch {
      setStalled(true)
      return false
    }
  }

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

      /*
       * 讀 `body.estimate`，不是讀最外層 (Z153).
       *
       * 這一支回的是 `{ estimate: { inputTokens, maxOutputTokens,
       * estimatedCostUsd, model } }`。這裡本來讀最外層的
       * `estimatedCostUsd` / `estimatedInputTokens` / `estimatedOutputTokens`
       * ——**三個欄位沒有一個存在**，於是「預估成本」永遠是 $0.00、token 永
       * 遠是 0。
       *
       * 整個流程最前面那一步叫「先估成本，再產生」，spec v3 §0 要求的就是
       * 它；而它一直在回答零。零不是錯誤訊息，所以沒有人會去查。
       */
      const data = (await response.json()) as AiEstimateResponse

      setEstimate({
        usd: data.estimate?.estimatedCostUsd ?? 0,
        tokens: (data.estimate?.inputTokens ?? 0) + (data.estimate?.maxOutputTokens ?? 0),
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
       *
       * The failure is **not** swallowed any more. It used to be
       * `.catch(() => {})`, and when the nudge did not land the panel polled
       * a QUEUED job forever: 「已排入佇列」, no progress, no error, nothing.
       * From the outside that is indistinguishable from the feature being
       * broken — which is exactly how it was reported.
       */
      setStalled(false)
      void nudge()
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
    const startedAt = Date.now()

    const poll = async () => {
      try {
        const response = await apiFetch(`/api/ai/jobs/${jobId}`)
        if (!response.ok) return

        const data = (await response.json()) as { job: JobView }
        if (cancelled) return

        setJob(data.job)

        /*
         * Still sitting in the queue long after it was accepted.
         *
         * The worker runs on a nudge from here (cron is once a day), so a job
         * that has not even started means the nudge did not land — the server
         * was restarting, the tab lost the network, something. Saying so beats
         * polling in silence, which is what this did before and which reads
         * as 「這功能壞了」.
         */
        if (data.job.status === 'QUEUED' && Date.now() - startedAt > STALL_MS) {
          setStalled(true)
        }

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
        /*
         * `acknowledge` 是必填的 (Z30 審出來).
         *
         * `aiApplySchema` 有 `acknowledge: z.literal(true)`，而這裡從來沒送
         * ——所以這顆「採用這份」**一直回 400**，錯誤訊息是「必須確認才能套
         * 用 AI 產出」。分鏡的採用走同一支，所以它也一樣壞著。
         *
         * 測試全綠是因為它們直接呼叫 `applyScript`，沒有經過這條路由。
         *
         * 送 true 是誠實的：這顆按鈕只在 `phase === 'review'` 出現，而上面就
         * 是完整的候選內容——不是替人勾一個他沒看過的框。
         */
        body: JSON.stringify({ candidateIndex: chosen, acknowledge: true }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      /*
       * 只有真的寫進去才說寫進去了 (P0-3).
       *
       * The apply route only writes when the job carries a target, and
       * nothing in this panel sets one — so every apply so far marked the
       * job 已採用 and changed no text at all, while the toast said the
       * content had been written and could be rolled back. A message that
       * confidently describes work that did not happen is worse than an
       * error, because nobody goes looking.
       */
      const applied = (await response.json().catch(() => null)) as {
        versionId?: string | null
        wrote?: string | null
      } | null

      /*
       * 照伺服器說的講 (Z71).
       *
       * 這裡本來用「有沒有 versionId」當判準，而分鏡、角色設計、對白歸屬都是
       * 有寫進去、沒有 version 快照的——照那個判準會對著一個剛建好 32 個鏡頭
       * 的任務說「還沒有自動寫回」。現在伺服器直接回一句它做了什麼。
       */
      if (applied?.wrote) {
        toast.success('已採用', applied.wrote)
      } else {
        toast.warning('已標記為採用', '這份產出還沒有自動寫回正文——請自行複製需要的段落。')
      }
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

  /*
   * 這份候選採用之後會變成什麼，一句話。
   *
   * `summarize` 回 null 代表這段讀不出結構（模型沒照格式回，或整段是散
   * 文）——那就不要印一句騙人的摘要，讓下面照舊顯示原文。採用時伺服器會再
   * 解析一次並擋下來，兩邊用的是同一支 parser。
   */
  const summary = activeApply?.summarize
    ? (activeApply.summarize(candidates[chosen]?.content ?? '') ?? null)
    : null

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

      {/*
        素材來源 (Z113).

        This task reads a novel, not the text on screen, and nothing used to
        say so. A disabled 估算成本 with no explanation is the thing spec v2
        §4 forbids — so the source is named, its length is shown, and when
        there is nothing to adapt it says that instead of going quiet.
      */}
      {readsNovel && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-400">
            改編哪一集的小說
            <span className="ml-1.5 text-ink-600">正文由伺服器讀，不經過瀏覽器</span>
          </span>

          {novelSources && novelSources.length > 0 ? (
            <>
              <select
                value={novelFrom}
                onChange={(event) => setNovelFrom(event.target.value)}
                disabled={phase === 'running'}
                className="rounded-lg bg-stage-850 px-2 py-1.5 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none disabled:opacity-50"
              >
                {novelSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    EP{String(source.number).padStart(3, '0')}
                    {source.title ? `・${source.title}` : ''}（
                    {source.charCount.toLocaleString('en-US')} 字）
                    {source.id === episodeId ? '　← 本集' : ''}
                  </option>
                ))}
              </select>

              {novelSource && novelSource.id !== episodeId && (
                <span className="text-[10px] text-amber-300">
                  這不是本集的小說。要改編別集的內容才選它。
                </span>
              )}
            </>
          ) : (
            <span className="rounded-lg bg-stage-850 px-2 py-1.5 text-[11px] leading-relaxed text-ink-500 ring-1 ring-inset ring-stage-700">
              這部作品還沒有任何一集寫了小說，所以沒有東西可以改編。
              先去小說編輯寫一些，這裡就會出現可以選的集數。
            </span>
          )}
        </label>
      )}

      {/* ---- estimate / run ---------------------------------------------- */}
      {phase === 'idle' && (
        <button
          type="button"
          onClick={() => void runEstimate()}
          disabled={!ready}
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
      {/*
        排了隊卻沒人跑 (Z114).

        The button that fixes it is the same nudge that should have happened
        automatically — so this is not a workaround bolted on, it is the one
        action that is actually missing when this state occurs.
      */}
      {stalled && phase === 'running' && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-amber-500/10 p-3 ring-1 ring-inset ring-amber-500/30">
          <p className="text-[11px] leading-relaxed text-amber-200">
            任務已經排進佇列，但還沒有開始跑。背景工作是靠這個頁面叫起來的
            （排程一天只跑一次），多半是那一下沒送到。
          </p>
          <button
            type="button"
            onClick={async () => {
              setWaking(true)
              const ok = await nudge()
              setWaking(false)
              if (ok) setStalled(false)
            }}
            disabled={waking}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-amber-500/20 px-2.5 py-1.5 text-[11px] text-amber-100 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
          >
            {waking && <Loader2 aria-hidden className="size-3 animate-spin" />}
            立刻執行
          </button>
          <p className="text-[10px] text-amber-200/70">
            還是不動的話，去「AI 製片中心」看佇列——那裡看得到每一筆任務的狀態。
          </p>
        </div>
      )}

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

          {summary && (
            <p className="rounded-lg bg-accent-600/10 px-2.5 py-2 text-[11px] leading-relaxed text-accent-200 ring-1 ring-inset ring-accent-500/30">
              採用會寫入：{summary}
            </p>
          )}

          <div className="max-h-80 overflow-y-auto rounded-lg bg-stage-850 p-2 ring-1 ring-inset ring-stage-700">
            {summary ? (
              /*
               * 結構化的候選不要做 diff。
               *
               * 左邊是目前這一場的正文、右邊是一整集的 JSON，逐行比對出來的
               * 東西沒有一行是有意義的——而一個看起來像壞掉的預覽，會讓人不
               * 敢按採用，或是更糟，養成不看就按的習慣。
               */
              <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-ink-400">
                {candidates[chosen]?.content ?? ''}
              </pre>
            ) : (
              <DiffViewer
                before={activeSource}
                after={candidates[chosen]?.content ?? ''}
                beforeLabel="目前內容"
                afterLabel={candidates[chosen]?.label ?? '候選'}
                mode="unified"
              />
            )}
          </div>

          {job?.actualCost && (
            <p className="text-[10px] text-ink-600">
              實際花費 {formatMoney(Number(job.actualCost), 'USD')}
              {job.estimatedCost && `（估算 ${formatMoney(Number(job.estimatedCost), 'USD')}）`}
            </p>
          )}

          {/*
            兩種採用法，各自說清楚會發生什麼 (Z122).

            They are not the same action wearing different labels: one adds
            text and the other destroys text. A single 「採用」 button has to
            guess which was meant, and the cost of guessing wrong is a
            chapter.
          */}
          <div className="flex flex-col gap-2">
            {onAdopt ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void adoptInto('insert')}
                  disabled={applying}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-stage-800 px-3 py-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 transition-colors hover:bg-stage-700 disabled:opacity-60"
                >
                  <CornerDownLeft aria-hidden className="size-3.5" />
                  插在游標處
                </button>
                <button
                  type="button"
                  onClick={() => void adoptInto('replace')}
                  disabled={applying}
                  className="bg-brand-gradient glow-accent-sm inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  <Check aria-hidden className="size-3.5" />
                  {applying ? '處理中…' : '覆蓋整章'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void adopt()}
                disabled={applying}
                className="bg-brand-gradient glow-accent-sm inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                <Check aria-hidden className="size-3.5" />
                {applying ? '採用中…' : '採用這份'}
              </button>
            )}

            {onAdopt && (
              <p className="text-[10px] leading-relaxed text-ink-600">
                插入不會動到原有的字，編輯器的復原鍵救得回來。
                覆蓋會先把整份文件存成版本再寫，可以從版本紀錄還原。
              </p>
            )}
          </div>

          <div className="flex gap-2">
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

          {/*
            這一段本來是無條件印的 (Z30 審出來).

            The old text promised a rollback that did not exist. Until the
            chapter-level write is wired (Z122), say what actually happens.

            ——而「會寫入」的那條路接上之後，它就跟上面那句「採用會寫入：12
            場、共 8,431 字」同時出現在一個畫面裡，而且說的是相反的事。兩句
            裡假的那一句，正好是「那件會毀資料的事不會發生」。
          */}
          <p className="text-[10px] text-ink-700">
            {activeTarget
              ? '採用會把上面這份寫進去，並把原本的內容存成版本——可以從版本紀錄還原。'
              : '這份產出目前不會自動覆蓋正文——請自行複製要用的段落。'}
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
