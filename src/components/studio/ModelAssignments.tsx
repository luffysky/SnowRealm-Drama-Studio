'use client'

import { Loader2, RotateCcw, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn } from '@/lib/utils'

/**
 * 哪個任務用哪個模型 (Z152).
 *
 * `model_assignments` 這張表一直都在、形狀也正好對，**零個呼叫端**——所以
 * 即使接了七家供應商，`adapterForTask()` 還是「挑第一個能用的」，等於只會
 * 用到一家。
 *
 * ## 沒設的也要列出來
 *
 * 只列「已經設過的」，畫面會是空的，而**還沒設的才是需要看見的那些**。
 * 十七個任務一次攤開，哪幾個還在自動挑選一眼就知道。
 *
 * ## 便宜的模型放在對的地方
 *
 * 對白歸屬是機械判斷（誰說的），一集 $0.13，120 集約 $15.8；審稿是品質最
 * 敏感的一環。這兩件事用同一個模型是浪費，而這張表就是把它們分開的地方。
 */

type Provider = {
  id: string
  label: string
  kind: string
  enabled: boolean
  models: string[]
}

type Assignment = {
  providerId: string
  model: string
  effort: string
  maxTokens: number
  candidates: number
  providerLabel: string
  providerEnabled: boolean
}

type Row = { task: string; label: string; assignment: Assignment | null }

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** 一列的草稿；null 代表沒有改過。 */
type Draft = { providerId: string; model: string; effort: string; candidates: number }

export function ModelAssignments({
  rows,
  providers,
}: {
  rows: Row[]
  providers: Provider[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const usable = providers.filter((provider) => provider.enabled)

  function draftFor(row: Row): Draft {
    return (
      drafts[row.task] ?? {
        providerId: row.assignment?.providerId ?? '',
        model: row.assignment?.model ?? '',
        effort: row.assignment?.effort ?? 'high',
        candidates: row.assignment?.candidates ?? 1,
      }
    )
  }

  function edit(task: string, patch: Partial<Draft>, base: Draft) {
    setDrafts((previous) => ({ ...previous, [task]: { ...base, ...patch } }))
  }

  async function save(row: Row) {
    const draft = draftFor(row)
    if (!draft.providerId || !draft.model.trim()) {
      toast.error('還不能存', '要同時選供應商與模型。')
      return
    }

    setBusy(row.task)
    try {
      const response = await apiFetch('/api/ai/assignments', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          task: row.task,
          providerId: draft.providerId,
          model: draft.model.trim(),
          effort: draft.effort,
          candidates: draft.candidates,
        }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success(`${row.label} 改用 ${draft.model.trim()}`)
      setDrafts((previous) => {
        const next = { ...previous }
        delete next[row.task]
        return next
      })
      router.refresh()
    } catch (cause) {
      toast.error('存不起來', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function clear(row: Row) {
    setBusy(row.task)
    try {
      const response = await apiFetch(`/api/ai/assignments?task=${row.task}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success(`${row.label} 回到自動挑選`)
      setDrafts((previous) => {
        const next = { ...previous }
        delete next[row.task]
        return next
      })
      router.refresh()
    } catch (cause) {
      toast.error('清不掉', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  if (usable.length === 0) {
    /*
     * 沒有可用的供應商就說清楚，不要給一排選不了東西的下拉。
     */
    return (
      <p className="rounded-lg bg-stage-900 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500 ring-1 ring-stage-700/60">
        還沒有啟用任何供應商，所以沒有東西可以指派。先到上面「供應商」那一段
        新增一個並啟用，這裡才有得選。
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] leading-relaxed text-ink-600">
        沒有指派的任務會自動挑第一個能用的供應商。便宜的模型放在機械性的任務上
        （例如對白歸屬），品質敏感的留給好模型（例如審稿）。
      </p>

      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const draft = draftFor(row)
          const dirty = Boolean(drafts[row.task])
          const provider = usable.find((p) => p.id === draft.providerId)
          const running = busy === row.task

          return (
            <li
              key={row.task}
              className={cn(
                'flex flex-col gap-1.5 rounded-lg p-2.5 ring-1 sm:flex-row sm:items-center',
                dirty ? 'bg-stage-850 ring-accent-500/40' : 'bg-stage-900 ring-stage-700/60'
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[11px] text-ink-100">{row.label}</span>
                <span className="font-mono text-[9px] text-ink-700">{row.task}</span>
              </div>

              <select
                value={draft.providerId}
                onChange={(event) =>
                  edit(row.task, { providerId: event.target.value, model: '' }, draft)
                }
                className="h-7 rounded-lg bg-stage-850 px-1.5 text-[10px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none sm:w-40"
              >
                <option value="">自動挑選</option>
                {usable.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>

              {/*
                * 有抓過模型清單就給下拉，沒有就給輸入框。
                *
                * Gemini 的相容層沒有 /models，所以它永遠是輸入框——與其給一個
                * 空下拉讓人以為壞了，不如直接讓他打。
                */}
              {provider && provider.models.length > 0 ? (
                <select
                  value={draft.model}
                  onChange={(event) => edit(row.task, { model: event.target.value }, draft)}
                  className="h-7 min-w-0 flex-1 rounded-lg bg-stage-850 px-1.5 font-mono text-[10px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none sm:max-w-56"
                >
                  <option value="">選一個模型</option>
                  {provider.models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={draft.model}
                  onChange={(event) => edit(row.task, { model: event.target.value }, draft)}
                  placeholder={provider ? '手動填模型名' : '先選供應商'}
                  disabled={!provider}
                  className="h-7 min-w-0 flex-1 rounded-lg bg-stage-850 px-1.5 font-mono text-[10px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none disabled:opacity-40 sm:max-w-56"
                />
              )}

              <select
                value={draft.effort}
                onChange={(event) => edit(row.task, { effort: event.target.value }, draft)}
                className="h-7 rounded-lg bg-stage-850 px-1.5 text-[10px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
              >
                {EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>

              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => void save(row)}
                  disabled={!dirty || running}
                  title="存起來"
                  className="tap grid size-7 place-items-center rounded-lg bg-accent-600 text-white transition-colors hover:bg-accent-500 disabled:opacity-30"
                >
                  {running ? (
                    <Loader2 aria-hidden className="size-3 animate-spin" />
                  ) : (
                    <Save aria-hidden className="size-3" />
                  )}
                  <span className="sr-only">存起來</span>
                </button>

                <button
                  type="button"
                  onClick={() => void clear(row)}
                  disabled={!row.assignment || running}
                  title="回到自動挑選"
                  className="tap grid size-7 place-items-center rounded-lg bg-stage-800 text-ink-400 transition-colors hover:text-ink-100 disabled:opacity-30"
                >
                  <RotateCcw aria-hidden className="size-3" />
                  <span className="sr-only">回到自動挑選</span>
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
