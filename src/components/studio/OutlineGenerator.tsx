'use client'

import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { NotConfiguredState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { convert, formatMoney, type CurrencyValue, type FxRates } from '@/lib/money'
import {
  diffOutline,
  OUTLINE_FIELD_LABEL,
  parseOutline,
  type OutlineDiff,
} from '@/lib/outline'
import type { OutlineEpisode } from '@/components/studio/OutlineBoard'

/**
 * AI 分集大綱生成 (`docs/OUTLINE.md`).
 *
 * Four steps, the same contract as every other AI surface here: estimate what
 * it will cost, run it, **show exactly what would change**, then adopt.
 *
 * The third step is the one that matters and the one both reference projects
 * skip. A model asked for ten episodes will quietly restate episodes it was
 * not asked about, or overwrite a line the writer spent an afternoon on. So
 * nothing is written until the writer has seen it field by field and ticked
 * it — and a field the model left blank is never allowed to clear one that
 * has text in it (`diffOutline`).
 */

type Phase = 'setup' | 'estimating' | 'estimated' | 'running' | 'review'

type JobView = {
  id: string
  status: string
  progress: number
  errorMessage: string
  result: { candidates?: { label: string; content: string }[] } | null
  actualCost: string | null
}

const POLL_MS = 2000

export function OutlineGenerator({
  projectId,
  episodes,
  currency,
  fx,
  providerReady,
  providerDetail,
  onClose,
  onApplied,
}: {
  projectId: string
  episodes: OutlineEpisode[]
  currency: CurrencyValue
  fx: FxRates
  providerReady: boolean
  providerDetail?: string
  onClose: () => void
  onApplied: (
    updates: { episodeId: string; title?: string; logline?: string; synopsis?: string }[]
  ) => void
}) {
  const router = useRouter()
  const toast = useToast()

  const firstEmpty = episodes.find((row) => !row.logline.trim() && !row.synopsis.trim())
  const defaultFrom = firstEmpty?.number ?? episodes[0]?.number ?? 1

  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(Math.min(defaultFrom + 9, episodes.at(-1)?.number ?? defaultFrom))
  const [instruction, setInstruction] = useState('')

  const [phase, setPhase] = useState<Phase>('setup')
  const [estimate, setEstimate] = useState<{ cost: number; currency: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diffs, setDiffs] = useState<OutlineDiff[]>([])
  const [unparsed, setUnparsed] = useState<string[]>([])
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState(false)

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [])

  const inRange = episodes.filter((row) => row.number >= from && row.number <= to)

  /** Everything the model needs about the range, as plain text. */
  function sourceText(): string {
    const lines = [
      `請為第 ${from} 集到第 ${to} 集寫分集大綱，共 ${inRange.length} 集。`,
      '',
      '這個範圍目前的狀態：',
    ]

    for (const row of inRange) {
      const label = `EP${String(row.number).padStart(3, '0')}`
      const existing = [row.title, row.logline, row.synopsis].filter(Boolean).join('｜')
      lines.push(existing ? `${label} 已有：${existing}` : `${label} 尚未撰寫`)
    }

    // The episode before the range anchors continuity; without it the model
    // restarts the story at whatever episode it was handed first.
    const before = episodes.filter((row) => row.number < from).at(-1)
    if (before && (before.logline || before.synopsis)) {
      lines.push('', `前一集（EP${String(before.number).padStart(3, '0')}）的大綱，用來接續：`)
      lines.push(before.logline, before.synopsis)
    }

    return lines.filter(Boolean).join('\n')
  }

  function payload() {
    return {
      task: 'OUTLINE_GENERATE' as const,
      projectId,
      sourceText: sourceText(),
      userInstruction: instruction.trim(),
      candidates: 1,
      includeWorld: true,
      includeCharacters: true,
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

      const body = (await response.json()) as { cost?: number; currency?: string }
      setEstimate({ cost: Number(body.cost ?? 0), currency: body.currency ?? 'USD' })
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
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const { job } = (await response.json()) as { job: { id: string } }

      // Hobby's cron is daily, so the worker is nudged rather than waited for.
      void apiFetch('/api/ai/worker', { method: 'POST' }).catch(() => {})

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

        if (job.status === 'SUCCEEDED') {
          const content = job.result?.candidates?.[0]?.content ?? ''
          const parsed = parseOutline(content)

          const next = diffOutline(parsed.entries, episodes)
          setDiffs(next)
          setUnparsed(parsed.unparsed)
          setChosen(new Set(next.map((entry) => entry.number)))
          setPhase('review')

          if (next.length === 0) {
            setError(
              parsed.entries.length > 0
                ? '產出的大綱跟現有內容一樣，沒有要變更的地方。'
                : '讀不出任何集數大綱。可以再跑一次，或在補充指示裡要求照格式輸出。'
            )
          }
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

  async function adopt() {
    const updates = diffs
      .filter((entry) => chosen.has(entry.number))
      .map((entry) => {
        const fields: { episodeId: string; title?: string; logline?: string; synopsis?: string } = {
          episodeId: entry.episodeId,
        }
        for (const change of entry.changes) fields[change.field] = change.after
        return fields
      })

    if (updates.length === 0) return

    setApplying(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/outline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries: updates }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { applied: number }
      toast.success('大綱已採用', `套用了 ${body.applied} 集。`)
      onApplied(updates)
      router.refresh()
      onClose()
    } catch (cause) {
      toast.error('採用失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setApplying(false)
    }
  }

  const busy = phase === 'estimating' || phase === 'running' || applying

  return (
    <Dialog
      open
      onRequestClose={() => {
        if (!busy) onClose()
      }}
      title="AI 生成分集大綱"
      description="先估成本，再產生，採用前逐集確認。"
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
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="從第幾集" description="建議一次 10 集以內，方便逐集確認。">
            <Input
              type="number"
              value={from}
              min={1}
              onChange={(event) => setFrom(Number(event.target.value))}
            />
          </Field>
          <Field label="到第幾集">
            <Input
              type="number"
              value={to}
              min={from}
              onChange={(event) => setTo(Number(event.target.value))}
            />
          </Field>
        </div>

        <p className="rounded-lg bg-stage-850/60 px-3 py-2 text-[11px] leading-relaxed text-ink-500 ring-1 ring-inset ring-stage-700/70">
          這個範圍有 {inRange.length} 集，其中{' '}
          {inRange.filter((row) => row.logline.trim() || row.synopsis.trim()).length} 集已經有大綱。
          已有內容不會被直接覆蓋——產生後會逐集列出差異，你勾選才會寫入。
          作品大綱、世界觀與角色設定會一併送進去當作條件。
        </p>

        <Field
          label="補充指示（選填）"
          description="例如：這十集要把男主角的身分揭露分三次給。"
        >
          <Textarea
            value={instruction}
            rows={3}
            maxLength={4000}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="留白就依作品設定自由發揮。"
          />
        </Field>

        {estimate && phase === 'estimated' && (
          <p className="flex items-center gap-2 rounded-lg bg-stage-850/60 px-3 py-2 text-xs text-ink-300 ring-1 ring-inset ring-stage-700/70">
            <Sparkles aria-hidden className="size-3.5 text-accent-400" />
            預估成本約{' '}
            <strong className="text-ink-50">
              {formatMoney(
                convert(estimate.cost, estimate.currency as CurrencyValue, currency, fx),
                currency
              )}
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

        {unparsed.length > 0 && (
          <p className="text-[11px] text-amber-400">
            有 {unparsed.length} 段讀不出格式（{unparsed.join('、')}），已略過。
          </p>
        )}

        {diffs.length > 0 && (
          <>
            <div className="flex items-center gap-2 text-[11px] text-ink-500">
              <span>{chosen.size} / {diffs.length} 集已勾選</span>
              <button
                type="button"
                onClick={() => setChosen(new Set(diffs.map((entry) => entry.number)))}
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
              {diffs.map((entry) => {
                const picked = chosen.has(entry.number)
                return (
                  <li
                    key={entry.number}
                    className={`rounded-lg bg-stage-900 p-3 ring-1 ${
                      picked ? 'ring-accent-500/40' : 'ring-stage-700'
                    }`}
                  >
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked}
                        onChange={() =>
                          setChosen((current) => {
                            const next = new Set(current)
                            if (next.has(entry.number)) next.delete(entry.number)
                            else next.add(entry.number)
                            return next
                          })
                        }
                        className="size-3.5 accent-accent-500"
                      />
                      <span className="text-xs font-medium text-ink-100">
                        EP{String(entry.number).padStart(3, '0')}
                      </span>
                      <span className="text-[10px] text-ink-600">
                        {entry.changes.length} 個欄位會變更
                      </span>
                    </label>

                    <dl className="mt-2 flex flex-col gap-1.5 pl-5">
                      {entry.changes.map((change) => (
                        <div key={change.field} className="text-[11px]">
                          <dt className="text-ink-600">{OUTLINE_FIELD_LABEL[change.field]}</dt>
                          {change.before && (
                            <dd className="text-ink-600 line-through">{change.before}</dd>
                          )}
                          <dd className="whitespace-pre-wrap text-ink-200">{change.after}</dd>
                        </div>
                      ))}
                    </dl>
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
              產生中，可能需要一分鐘…
            </span>
          )}
          {phase === 'review' && diffs.length > 0 && '確認後才會寫入'}
        </span>

        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            {phase === 'review' ? '不採用' : '取消'}
          </Button>

          {phase === 'review' ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void adopt()}
              loading={applying}
              loadingText="寫入中…"
              disabled={chosen.size === 0}
            >
              採用 {chosen.size} 集
            </Button>
          ) : phase === 'estimated' ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void run()}
              leadingIcon={<Sparkles aria-hidden className="size-3.5" />}
            >
              開始產生
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => void runEstimate()}
              loading={phase === 'estimating' || phase === 'running'}
              loadingText={phase === 'running' ? '產生中…' : '估算中…'}
              disabled={inRange.length === 0 || to < from}
            >
              估算成本
            </Button>
          )}
        </div>
      </div>
    )
  }
}
