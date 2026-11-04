'use client'

import { AlertTriangle, Check, FileDiff, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn } from '@/lib/utils'

/**
 * 助理的修改提案 (Z100).
 *
 * The assistant never writes. This card is where a proposal becomes an edit,
 * and applying always snapshots what it replaces into 版本紀錄 first — so
 * 「取代」 and 「取代並備份原來的」 are one button, not two. There is no
 * version of this that overwrites without a way back.
 *
 * The diff is rendered here rather than described by the model, because a
 * model's account of its own edit is not evidence of what the edit is.
 */

export type Proposal = {
  id: string
  targetType: string
  targetId: string
  field: string
  beforeValue: string
  afterValue: string
  rationale: string
  state: string
  stale: boolean
}

const TARGET_LABEL: Record<string, string> = {
  chapter: '章節',
  episode_outline: '分集大綱',
  character: '角色',
  world_entry: '世界觀',
}

const FIELD_LABEL: Record<string, string> = {
  content: '正文',
  title: '標題',
  logline: '一句話',
  synopsis: '大綱',
  personality: '性格',
  background: '背景',
  appearance: '外觀',
  growth: '成長弧線',
  visualPrompt: '定妝提示詞',
  summary: '摘要',
  body: '內容',
}

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const router = useRouter()
  const toast = useToast()

  const [state, setState] = useState(proposal.state)
  const [busy, setBusy] = useState<'apply' | 'reject' | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [needsForce, setNeedsForce] = useState(false)

  async function decide(decision: 'apply' | 'reject', force = false) {
    setBusy(decision)
    try {
      const response = await apiFetch(`/api/chat/proposals/${proposal.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, force }),
      })

      if (response.status === 409) {
        // The target changed after the proposal was written. Say so and make
        // the override explicit rather than applying over unseen work.
        setNeedsForce(true)
        toast.error('內容已經被改過', await readApiError(response))
        return
      }
      if (!response.ok) throw new Error(await readApiError(response))

      setState(decision === 'apply' ? 'APPLIED' : 'REJECTED')
      setNeedsForce(false)
      toast.success(
        decision === 'apply' ? '已套用' : '已拒絕',
        decision === 'apply' ? '原本的內容已存成版本快照' : undefined
      )
      router.refresh()
    } catch (cause) {
      toast.error('操作失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  const label = `${TARGET_LABEL[proposal.targetType] ?? proposal.targetType}・${
    FIELD_LABEL[proposal.field] ?? proposal.field
  }`

  const decided = state !== 'PENDING'

  return (
    <div
      className={cn(
        'mt-1.5 flex flex-col gap-2 rounded-lg p-2.5 text-xs ring-1',
        state === 'APPLIED'
          ? 'bg-emerald-500/10 ring-emerald-500/30'
          : state === 'REJECTED'
            ? 'bg-stage-850 ring-stage-700'
            : 'bg-stage-850 ring-accent-500/40'
      )}
    >
      <div className="flex items-center gap-1.5">
        <FileDiff aria-hidden className="size-3.5 shrink-0 text-accent-400" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink-100">
          {label}
        </span>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[9px]',
            state === 'APPLIED'
              ? 'bg-emerald-500/20 text-emerald-300'
              : state === 'REJECTED'
                ? 'bg-stage-800 text-ink-600'
                : 'bg-accent-600/20 text-accent-300'
          )}
        >
          {state === 'APPLIED' ? '已套用' : state === 'REJECTED' ? '已拒絕' : '待決定'}
        </span>
      </div>

      {proposal.rationale && (
        <p className="text-[11px] leading-relaxed text-ink-400">{proposal.rationale}</p>
      )}

      <div className="flex items-center gap-2 text-[10px] text-ink-600 tabular-nums">
        <span>原本 {proposal.beforeValue.length} 字</span>
        <span>→</span>
        <span>改後 {proposal.afterValue.length} 字</span>
        <button
          type="button"
          onClick={() => setShowDiff((on) => !on)}
          className="tap ml-auto underline underline-offset-2 hover:text-ink-300"
        >
          {showDiff ? '收起' : '看內容'}
        </button>
      </div>

      {showDiff && (
        <div className="flex flex-col gap-1.5">
          <Side label="原本" text={proposal.beforeValue} tone="before" />
          <Side label="改後" text={proposal.afterValue} tone="after" />
        </div>
      )}

      {(proposal.stale || needsForce) && !decided && (
        <p className="flex items-start gap-1 text-[10px] leading-relaxed text-amber-300">
          <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
          這段內容在提案之後被改過。助理沒看過那些修改，套用會蓋掉它們。
        </p>
      )}

      {!decided && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void decide('apply', needsForce || proposal.stale)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-500 disabled:opacity-50"
          >
            {busy === 'apply' ? (
              <Loader2 aria-hidden className="size-3 animate-spin" />
            ) : (
              <Check aria-hidden className="size-3" />
            )}
            {needsForce || proposal.stale ? '仍要套用' : '套用'}
          </button>

          <button
            type="button"
            onClick={() => void decide('reject')}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-50"
          >
            <X aria-hidden className="size-3" />
            不要
          </button>

          <span className="ml-auto text-[9px] text-ink-700">套用會先備份原本的</span>
        </div>
      )}

      {state === 'APPLIED' && (
        <p className="text-[10px] text-ink-600">
          原本的內容已存進版本紀錄，可以從那裡還原。
        </p>
      )}
    </div>
  )
}

function Side({ label, text, tone }: { label: string; text: string; tone: 'before' | 'after' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] text-ink-600">{label}</span>
      <div
        className={cn(
          'max-h-40 overflow-y-auto rounded px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap',
          tone === 'before'
            ? 'bg-rose-500/5 text-ink-400 ring-1 ring-rose-500/20'
            : 'bg-emerald-500/5 text-ink-200 ring-1 ring-emerald-500/20'
        )}
      >
        {/*
          Plain text, never the editor's HTML. The prose is stored as markup
          and injecting it here would render it — in a bubble, from a model,
          with none of the editor's sanitising.
        */}
        {text || <span className="text-ink-700">（空白）</span>}
      </div>
    </div>
  )
}
