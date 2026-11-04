'use client'

import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useToast } from '@/components/ui/Toast'
import type { InboxItem } from '@/lib/ai/insights'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn } from '@/lib/utils'

/**
 * 待確認收件匣 (Z127-5).
 *
 * A job in `AWAITING_REVIEW` is work already paid for that produces nothing
 * until a person accepts it — and before this there was **no screen anywhere
 * that listed them**. Two outlines had been sitting for a day. The queue tab
 * showed them, in a row among the finished and the cancelled, with no preview
 * and nothing to press.
 *
 * Three decisions shape this:
 *
 *  1. **Oldest first.** The queue is newest-first because a queue is about
 *     now; an inbox is about what has been ignored longest.
 *  2. **The text is here.** Expanding fetches the full candidate rather than
 *     sending you to the editor to find out what it says. Most of these get
 *     dismissed, and 「不要」 should not cost a page load.
 *  3. **採用 only claims what it does.** A job carrying a document target gets
 *     written back and snapshotted. One that does not is marked accepted and
 *     says plainly that nothing was written — because for a while the toast
 *     said 「已寫入新版本」 when nothing had been (Z123), and that is a worse
 *     failure than no button at all.
 */

export function AiInbox({ items, canRun }: { items: InboxItem[]; canRun: boolean }) {
  const router = useRouter()
  const toast = useToast()

  const [openId, setOpenId] = useState<string | null>(null)
  const [full, setFull] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  if (items.length === 0) {
    return (
      <p className="rounded-lg bg-stage-900 px-3 py-6 text-center text-[11px] leading-relaxed text-ink-600 ring-1 ring-stage-700/60">
        沒有等著確認的產出。AI 跑完的東西都會先停在這裡，等人看過才會寫進正文。
      </p>
    )
  }

  async function expand(item: InboxItem) {
    if (openId === item.jobId) {
      setOpenId(null)
      return
    }
    setOpenId(item.jobId)

    // Fetched once per job and kept — reopening should not re-download it.
    if (full[item.jobId] !== undefined) return

    try {
      const response = await apiFetch(`/api/ai/jobs/${item.jobId}`)
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as {
        job?: { result?: { candidates?: { content?: string }[] } | null }
      }
      const text = body.job?.result?.candidates?.[0]?.content ?? ''
      setFull((previous) => ({ ...previous, [item.jobId]: text }))
    } catch (cause) {
      toast.error('讀不到完整內容', cause instanceof Error ? cause.message : undefined)
      setFull((previous) => ({ ...previous, [item.jobId]: '' }))
    }
  }

  async function act(item: InboxItem, what: 'apply' | 'discard') {
    setBusy(item.jobId)
    try {
      const response = await apiFetch(`/api/ai/jobs/${item.jobId}/${what}`, {
        method: 'POST',
        ...(what === 'apply'
          ? {
              headers: { 'content-type': 'application/json' },
              /*
               * `acknowledge` is the server asking whether the person saw what
               * they are overwriting. 採用 is only enabled once the full text
               * has been opened, so by the time this is sent the answer is
               * actually true rather than a box ticked on their behalf.
               */
              body: JSON.stringify({ candidateIndex: 0, acknowledge: true }),
            }
          : {}),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      if (what === 'discard') {
        toast.success('已捨棄', '內容仍留在這筆任務的紀錄裡，沒有被刪掉。')
      } else if (item.writesTo === 'document') {
        toast.success('已採用', '原本的內容已存成版本，可在版本紀錄回溯。')
      } else {
        toast.warning(
          '已標記為採用',
          '這類產出不會自動寫回正文——內容請到對應頁面自行取用。'
        )
      }

      router.refresh()
    } catch (cause) {
      toast.error(
        what === 'apply' ? '採用失敗' : '捨棄失敗',
        cause instanceof Error ? cause.message : undefined
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => {
        const open = openId === item.jobId
        const text = full[item.jobId]
        /**
         * Whether the full text has been fetched at all, which is what makes
         * 採用's `acknowledge` honest. Kept once fetched, so collapsing the
         * preview again does not un-see it.
         */
        const seen = text !== undefined

        return (
          <li
            key={item.jobId}
            className={cn(
              'flex flex-col gap-1.5 rounded-lg p-3 ring-1',
              item.waitedHours >= 12
                ? 'bg-amber-500/10 ring-amber-500/20'
                : 'bg-stage-900 ring-stage-700/60'
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-100">
                {item.label}
              </span>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[9px] tabular-nums',
                  item.waitedHours >= 12
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-stage-800 text-ink-600'
                )}
              >
                等了 {waited(item.waitedHours)}
              </span>
            </div>

            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-600">
              {item.projectTitle && <span>《{item.projectTitle}》</span>}
              {item.episodeNumber !== null && (
                <span className="tabular-nums">
                  EP{String(item.episodeNumber).padStart(3, '0')}
                </span>
              )}
              {item.model && <span className="font-mono">{item.model}</span>}
              <span className="tabular-nums">
                {item.candidates} 份候選 · {item.chars.toLocaleString('zh-TW')} 字
              </span>
              {item.writesTo === null && (
                <span className="text-ink-700">採用不會自動寫回正文</span>
              )}
            </p>

            {/* ---- preview ------------------------------------------- */}
            <div className="rounded bg-stage-950/60 p-2">
              <p
                className={cn(
                  'text-[11px] leading-relaxed whitespace-pre-wrap text-ink-400',
                  !open && 'line-clamp-3'
                )}
              >
                {open ? (text ?? item.preview) : item.preview}
                {!open && item.chars > item.preview.length && '…'}
              </p>

              {open && text === undefined && (
                <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-600">
                  <Loader2 aria-hidden className="size-3 animate-spin" />
                  讀取完整內容…
                </p>
              )}
            </div>

            {/* ---- actions ------------------------------------------- */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => void expand(item)}
                className="tap inline-flex items-center gap-1 rounded-md bg-stage-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100"
              >
                {open ? (
                  <ChevronUp aria-hidden className="size-3" />
                ) : (
                  <ChevronDown aria-hidden className="size-3" />
                )}
                {open ? '收起' : '看全文'}
              </button>

              {item.href && (
                <Link
                  href={item.href}
                  className="tap inline-flex items-center gap-1 rounded-md bg-stage-800 px-2 py-1 text-[10px] text-ink-300 transition-colors hover:bg-stage-700 hover:text-ink-100"
                >
                  到編輯器處理
                  <ArrowRight aria-hidden className="size-3" />
                </Link>
              )}

              {canRun && (
                <>
                  <button
                    type="button"
                    onClick={() => void act(item, 'apply')}
                    disabled={busy === item.jobId || !seen}
                    title={seen ? undefined : '先看過全文才能採用'}
                    className="tap ml-auto inline-flex items-center gap-1 rounded-md bg-accent-600 px-2 py-1 text-[10px] text-white transition-colors hover:bg-accent-500 disabled:opacity-40"
                  >
                    {busy === item.jobId ? (
                      <Loader2 aria-hidden className="size-3 animate-spin" />
                    ) : (
                      <Check aria-hidden className="size-3" />
                    )}
                    採用
                  </button>

                  <button
                    type="button"
                    onClick={() => void act(item, 'discard')}
                    disabled={busy === item.jobId}
                    className="tap inline-flex items-center gap-1 rounded-md bg-stage-800 px-2 py-1 text-[10px] text-ink-500 transition-colors hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-50"
                  >
                    <Trash2 aria-hidden className="size-3" />
                    捨棄
                  </button>
                </>
              )}
            </div>

            {canRun && !seen && (
              /*
               * Said out loud rather than left as a dimmed button with a
               * `title` nobody on a phone can hover. 採用 sends
               * `acknowledge: true`, and that has to mean somebody looked.
               */
              <p className="text-[10px] text-ink-700">看過全文才能採用。</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** 「20 小時」 / 「2 天」 — hours stop being readable after a day or so. */
function waited(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分鐘`
  if (hours < 48) return `${Math.round(hours)} 小時`
  return `${Math.round(hours / 24)} 天`
}
