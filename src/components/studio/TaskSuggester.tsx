'use client'

import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { NotConfiguredState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { parseTaskSuggestions, type TaskSuggestion } from '@/lib/ai/task-suggestions'
import type { AiEstimateResponse } from '@/lib/ai/types'
import { TASK_PRIORITY_LABEL, TASK_PRIORITY_STYLE } from '@/lib/constants'
import { convert, formatMoney, type CurrencyValue, type FxRates } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * AI 任務建議 (Z153).
 *
 * 這個任務不走共用的 `AiTaskLauncher`，因為它的產出**有地方可以去**：看板上
 * 的卡片。其他五種回的是要人讀的散文，這一種回的是「可以建立的東西」，而
 * 「產出之後沒有任何地方能套用它」正是 Z70 角色設計那條踩過的坑。
 *
 * 四個步驟跟大綱生成同一套：估成本、跑、**逐條看過**、勾選建立。第三步是關
 * 鍵——模型會建議看板上已經有的事，也會建議不該現在做的事，而這兩種都只有
 * 人看得出來。
 */

type Phase = 'setup' | 'estimating' | 'estimated' | 'running' | 'review'

type JobView = {
  id: string
  status: string
  errorMessage: string
  result: { candidates?: { label: string; content: string }[] } | null
}

const POLL_MS = 2000

export function TaskSuggester({
  projects,
  sourceText,
  currency,
  fx,
  providerReady,
  providerDetail,
  onClose,
}: {
  projects: { id: string; title: string }[]
  /** 進度摘要，伺服器組好的。空字串代表沒東西可以看。 */
  sourceText: string
  currency: CurrencyValue
  fx: FxRates
  providerReady: boolean
  providerDetail?: string
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()

  const [phase, setPhase] = useState<Phase>('setup')
  const [instruction, setInstruction] = useState('')
  const [estimate, setEstimate] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const [rawReply, setRawReply] = useState('')
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [])

  function payload() {
    return {
      task: 'TASK_SUGGEST' as const,
      /*
       * 跨作品，所以不綁一部作品：`projectId` 是 nullable 的，而摘要裡每一
       * 部作品都在。綁了第一部的話，世界觀與角色設定會只送那一部的——而建議
       * 會因此偏向那一部。
       */
      projectId: null,
      sourceText,
      userInstruction: instruction.trim(),
      candidates: 1,
      includeWorld: false,
      includeCharacters: false,
    }
  }

  async function runEstimate() {
    setPhase('estimating')
    setError(null)
    try {
      const response = await apiFetch('/api/ai/estimate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as AiEstimateResponse
      setEstimate(body.estimate?.estimatedCostUsd ?? 0)
      setPhase('estimated')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '估算失敗')
      setPhase('setup')
    }
  }

  async function run() {
    setPhase('running')
    setError(null)
    try {
      const response = await apiFetch('/api/ai/jobs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload()),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const { job } = (await response.json()) as { job: { id: string } }

      // keepalive：worker 跑在這個請求裡，換頁不該把它砍掉 (Z126)。
      void apiFetch('/api/ai/worker', { method: 'POST', keepalive: true }).catch(() => {})

      poll(job.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '送出失敗')
      setPhase('estimated')
    }
  }

  function poll(jobId: string) {
    const tick = async () => {
      try {
        const response = await apiFetch(`/api/ai/jobs/${jobId}`)
        if (!response.ok) throw new Error(await readApiError(response))

        const { job } = (await response.json()) as { job: JobView }

        if (job.status === 'FAILED' || job.status === 'CANCELLED') {
          setError(job.errorMessage || '任務失敗')
          setPhase('estimated')
          return
        }

        if (job.status === 'AWAITING_REVIEW' || job.status === 'SUCCEEDED') {
          const content = job.result?.candidates?.[0]?.content ?? ''
          const parsed = parseTaskSuggestions(content, projects)

          setSuggestions(parsed.suggestions)
          setRejected(parsed.rejected)
          setChosen(new Set(parsed.suggestions.map((_, index) => index)))
          // 一條都讀不出來的時候，把模型實際說了什麼留著——那通常不是噪音。
          setRawReply(parsed.suggestions.length === 0 ? content : '')
          setPhase('review')
          return
        }

        pollTimer.current = setTimeout(() => void tick(), POLL_MS)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '查詢任務失敗')
        setPhase('estimated')
      }
    }

    void tick()
  }

  async function create() {
    const picked = suggestions.filter((_, index) => chosen.has(index))
    if (picked.length === 0) return

    setCreating(true)
    let made = 0
    const failures: string[] = []

    /*
     * 一張一張送，不做批次端點。
     *
     * `POST /api/tasks` 已經在那裡了，而且它會做作品權限檢查、寫 sortOrder、
     * 記 activity。為了省幾個往返另外開一支批次端點，就是把那三件事再實作一
     * 次——而第二份實作會漏掉其中一件。
     *
     * 失敗的不吞：建了三張、兩張失敗，就要說「建了三張，兩張沒建成，原因是
     * 這些」，而不是一句「建好了」。
     */
    for (const item of picked) {
      try {
        const response = await apiFetch('/api/tasks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId: item.projectId,
            title: item.title,
            description: item.reason ? `AI 建議的理由：${item.reason}` : '',
            priority: item.priority,
            ...(item.episodeNumber !== null ? { episodeNumber: item.episodeNumber } : {}),
          }),
        })
        if (!response.ok) throw new Error(await readApiError(response))
        made += 1
      } catch (cause) {
        failures.push(`${item.title}：${cause instanceof Error ? cause.message : '建立失敗'}`)
      }
    }

    setCreating(false)

    if (made > 0) {
      if (failures.length === 0) toast.success('已建立', `加了 ${made} 張卡片到看板。`)
      else toast.warning('部分建立', `建了 ${made} 張，${failures.length} 張失敗：${failures[0]}`)
      router.refresh()
      onClose()
      return
    }

    toast.error('一張都沒建成', failures[0])
  }

  const busy = phase === 'estimating' || phase === 'running' || creating

  return (
    <Dialog
      open
      onRequestClose={() => {
        if (!busy) onClose()
      }}
      title="AI 建議接下來做什麼"
      description="依目前進度與看板現況提出建議，逐條勾選後才會建立成卡片。"
      size="lg"
      busy={busy}
      footer={<Footer />}
    >
      {!providerReady ? (
        <NotConfiguredState
          title="尚未設定 AI 供應商"
          description={providerDetail ?? '在系統設定裡加入一組 API 金鑰後即可使用。'}
        />
      ) : phase === 'review' ? (
        <Review />
      ) : (
        <Setup />
      )}
    </Dialog>
  )

  /* ------------------------------------------------------------------ */

  function Setup() {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] text-ink-400">會送進去的現況摘要：</p>
          {/*
            把摘要攤開給人看。這是估價那一行的分母——看不到它的話，「為什麼要
            這個價錢」就只能靠信的。
          */}
          <pre className="max-h-56 overflow-y-auto rounded-lg bg-stage-950 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-ink-400 ring-1 ring-inset ring-stage-700">
            {sourceText || '（沒有任何進度資料）'}
          </pre>
        </div>

        <Field label="補充指示（選填）" description="例如：這週只想推進有聲書，分鏡先不要排。">
          <Textarea
            value={instruction}
            rows={3}
            maxLength={4000}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="留白就依目前進度自由判斷。"
          />
        </Field>

        {estimate !== null && phase === 'estimated' && (
          <p className="flex items-center gap-2 rounded-lg bg-stage-850/60 px-3 py-2 text-xs text-ink-300 ring-1 ring-inset ring-stage-700/70">
            <Sparkles aria-hidden className="size-3.5 text-accent-400" />
            預估成本約{' '}
            <strong className="text-ink-50">
              {formatMoney(convert(estimate, 'USD', currency, fx), currency)}
            </strong>
            （實際以供應商回報為準）
          </p>
        )}

        {error && (
          <p role="alert" className="text-[11px] text-rose-400">
            {error}
          </p>
        )}
      </div>
    )
  }

  function Review() {
    return (
      <div className="flex flex-col gap-3">
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300 ring-1 ring-inset ring-amber-500/30"
          >
            <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}

        {rejected.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-[11px] text-amber-400">
            {rejected.map((reason) => (
              <li key={reason}>讀不出來：{reason}</li>
            ))}
          </ul>
        )}

        {rawReply && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] text-ink-400">AI 實際回的內容：</p>
            <pre className="max-h-72 overflow-y-auto rounded-lg bg-stage-950 p-3 text-[11px] leading-relaxed whitespace-pre-wrap text-ink-300 ring-1 ring-inset ring-stage-700">
              {rawReply}
            </pre>
          </div>
        )}

        {suggestions.length > 0 && (
          <>
            <div className="flex items-center gap-2 text-[11px] text-ink-500">
              <span>
                {chosen.size} / {suggestions.length} 條已勾選
              </span>
              <button
                type="button"
                onClick={() => setChosen(new Set(suggestions.map((_, index) => index)))}
                className="rounded px-1.5 py-0.5 hover:bg-stage-800 hover:text-ink-200"
              >
                全選
              </button>
              <button
                type="button"
                onClick={() => setChosen(new Set())}
                className="rounded px-1.5 py-0.5 hover:bg-stage-800 hover:text-ink-200"
              >
                全不選
              </button>
            </div>

            <ul className="flex flex-col gap-2">
              {suggestions.map((item, index) => {
                const picked = chosen.has(index)
                return (
                  <li
                    key={`${item.projectId}-${item.title}`}
                    className={cn(
                      'rounded-lg bg-stage-900 p-3 ring-1',
                      picked ? 'ring-accent-500/40' : 'ring-stage-700'
                    )}
                  >
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() =>
                          setChosen((current) => {
                            const next = new Set(current)
                            if (next.has(index)) next.delete(index)
                            else next.add(index)
                            return next
                          })
                        }
                        className="mt-0.5 size-3.5 accent-accent-500"
                      />
                      <span className="flex min-w-0 flex-col gap-1">
                        <span className="text-xs text-ink-100">{item.title}</span>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-ink-600">
                          <span>《{item.projectTitle}》</span>
                          {item.episodeNumber !== null && (
                            <span className="font-mono">
                              EP{String(item.episodeNumber).padStart(3, '0')}
                            </span>
                          )}
                          <span
                            className={cn(
                              'rounded px-1 py-0.5 text-[9px]',
                              TASK_PRIORITY_STYLE[item.priority]
                            )}
                          >
                            {TASK_PRIORITY_LABEL[item.priority]}
                          </span>
                        </span>
                        {item.reason && (
                          <span className="text-[10px] leading-relaxed text-ink-500">
                            {item.reason}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    )
  }

  function Footer() {
    if (!providerReady) {
      return (
        <div className="flex w-full justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>
            關閉
          </Button>
        </div>
      )
    }

    return (
      <div className="flex w-full items-center justify-between gap-3">
        <span className="text-[11px] text-ink-600">
          {phase === 'running' && (
            <span className="flex items-center gap-1.5">
              <Loader2 aria-hidden className="size-3 animate-spin" />
              思考中…
            </span>
          )}
          {phase === 'review' && suggestions.length > 0 && '勾選後才會建立卡片'}
        </span>

        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            {phase === 'review' ? '不要建立' : '取消'}
          </Button>

          {phase === 'review' ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void create()}
              loading={creating}
              loadingText="建立中…"
              disabled={chosen.size === 0}
            >
              建立 {chosen.size} 張卡片
            </Button>
          ) : phase === 'estimated' ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void run()}
              leadingIcon={<Sparkles aria-hidden className="size-3.5" />}
            >
              開始建議
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void runEstimate()}
              loading={phase === 'estimating'}
              loadingText="估算中…"
              disabled={!sourceText}
            >
              估算成本
            </Button>
          )}
        </div>
      </div>
    )
  }
}
