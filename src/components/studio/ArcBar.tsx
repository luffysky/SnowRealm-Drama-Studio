'use client'

import { Check, FolderPlus, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import type { ArcRow } from '@/lib/arcs-view'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn } from '@/lib/utils'

/**
 * 卷 (Z128).
 *
 * 「卷就只是單純一個單位跟收納器」 — so this is deliberately small. A strip
 * of chips that filters the list, and one dialog that makes 卷, renames them,
 * refiles episodes and deletes them.
 *
 * What it carefully does **not** have is any notion of order within a 卷, or
 * any renumbering. 集號 is the project's, not the 卷's: 小說、劇本、分鏡 and
 * every 「第 007 集」 in the prose refer to it, so moving EP050 into 第二卷
 * leaves it EP050. A 卷 that renumbered what it contained would be an address,
 * and an address is exactly what this was asked not to be.
 *
 * The strip hides itself when there is only one 卷 and nobody has made a
 * second, because one container is not a filing system — it is just the work.
 */

export function ArcBar({
  projectId,
  arcs,
  activeArcId,
  canWrite,
  onFilter,
  /** Episodes on the current page, so 「搬到這一卷」 has something to move. */
  selectable,
}: {
  projectId: string
  arcs: ArcRow[]
  activeArcId: string
  canWrite: boolean
  onFilter: (arcId: string | null) => void
  selectable: { id: string; number: number; title: string }[]
}) {
  const [open, setOpen] = useState(false)

  // One 卷 and no appetite for a second: nothing to file, nothing to show.
  if (arcs.length <= 1 && !canWrite) return null

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-600">卷</span>

        <button
          type="button"
          onClick={() => onFilter(null)}
          aria-pressed={activeArcId === ''}
          className={cn(
            'tap rounded-full px-2.5 py-1 text-[10px] transition-colors',
            activeArcId === ''
              ? 'bg-accent-600 text-white'
              : 'bg-stage-800 text-ink-400 hover:text-ink-100'
          )}
        >
          全部
        </button>

        {arcs.map((arc) => (
          <button
            key={arc.id}
            type="button"
            onClick={() => onFilter(arc.id)}
            aria-pressed={activeArcId === arc.id}
            className={cn(
              'tap rounded-full px-2.5 py-1 text-[10px] transition-colors',
              activeArcId === arc.id
                ? 'bg-accent-600 text-white'
                : 'bg-stage-800 text-ink-400 hover:text-ink-100'
            )}
          >
            {arc.title}
            <span className="ml-1 text-[9px] opacity-70 tabular-nums">
              {arc.episodeCount === 0
                ? '空的'
                : arc.firstNumber === arc.lastNumber
                  ? `EP${pad(arc.firstNumber!)}`
                  : `EP${pad(arc.firstNumber!)}–EP${pad(arc.lastNumber!)}`}
            </span>
          </button>
        ))}

        {canWrite && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="tap ml-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
          >
            <FolderPlus aria-hidden className="size-3" />
            管理卷
          </button>
        )}
      </div>

      {open && (
        <ArcDialog
          projectId={projectId}
          arcs={arcs}
          selectable={selectable}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function ArcDialog({
  projectId,
  arcs,
  selectable,
  onClose,
}: {
  projectId: string
  arcs: ArcRow[]
  selectable: { id: string; number: number; title: string }[]
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()

  const [busy, setBusy] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [moveTarget, setMoveTarget] = useState<string>(arcs[0]?.id ?? '')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  async function call(label: string, run: () => Promise<Response>) {
    setBusy(label)
    try {
      const response = await run()
      if (!response.ok) throw new Error(await readApiError(response))
      router.refresh()
      return true
    } catch (cause) {
      toast.error(label, cause instanceof Error ? cause.message : undefined)
      return false
    } finally {
      setBusy(null)
    }
  }

  async function create() {
    const title = newTitle.trim()
    if (!title) return
    const ok = await call('新增卷失敗', () =>
      apiFetch(`/api/projects/${projectId}/arcs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      })
    )
    if (ok) {
      setNewTitle('')
      toast.success('已新增一卷', '它現在是空的，把集數搬進去就好。')
    }
  }

  async function rename(arcId: string) {
    const title = renameTo.trim()
    if (!title) return
    const ok = await call('改名失敗', () =>
      apiFetch(`/api/projects/${projectId}/arcs/${arcId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      })
    )
    if (ok) setRenaming(null)
  }

  async function remove(arc: ArcRow) {
    if (arcs.length <= 1) return

    /*
     * Where its episodes go, chosen here rather than guessed at. The server
     * refuses a delete that would strand them — `episodes.arc_id` cascades,
     * so a careless delete takes the episodes with it.
     */
    const fallback = arcs.find((row) => row.id !== arc.id)
    if (arc.episodeCount > 0 && !fallback) return

    const query = arc.episodeCount > 0 ? `?moveTo=${fallback!.id}` : ''
    const ok = await call('刪除卷失敗', () =>
      apiFetch(`/api/projects/${projectId}/arcs/${arc.id}${query}`, { method: 'DELETE' })
    )
    if (ok) {
      toast.success(
        '已刪除這一卷',
        arc.episodeCount > 0
          ? `${arc.episodeCount} 集已搬到「${fallback!.title}」，一集都沒有刪掉。`
          : undefined
      )
    }
  }

  async function move() {
    if (picked.size === 0 || !moveTarget) return
    const ok = await call('搬動失敗', () =>
      apiFetch(`/api/projects/${projectId}/arcs/${moveTarget}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ episodeIds: [...picked] }),
      })
    )
    if (ok) {
      const target = arcs.find((row) => row.id === moveTarget)
      toast.success(
        `已把 ${picked.size} 集搬到「${target?.title ?? '這一卷'}」`,
        '集號沒有變,劇本、分鏡和正文裡的集數都還對得上。'
      )
      setPicked(new Set())
    }
  }

  return (
    <Dialog
      open
      onRequestClose={onClose}
      title="管理卷"
      description="卷只是個收納器：把集數分組，不會改動集號，也不影響劇本對接或任何統計。"
      size="lg"
      busy={busy !== null}
    >
      <div className="flex flex-col gap-4">
        {/* ---- existing arcs ------------------------------------------- */}
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium text-ink-300">現有的卷</h3>
          <ul className="flex flex-col gap-1">
            {arcs.map((arc) => (
              <li
                key={arc.id}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-stage-900 px-3 py-2 ring-1 ring-stage-700/60"
              >
                {renaming === arc.id ? (
                  <>
                    <input
                      autoFocus
                      value={renameTo}
                      onChange={(event) => setRenameTo(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void rename(arc.id)
                        if (event.key === 'Escape') setRenaming(null)
                      }}
                      className="min-w-0 flex-1 rounded bg-stage-800 px-2 py-1 text-[12px] text-ink-100 ring-1 ring-stage-700 focus:ring-accent-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void rename(arc.id)}
                      aria-label="確定改名"
                      className="tap grid size-6 place-items-center rounded text-emerald-400 hover:bg-stage-800"
                    >
                      <Check aria-hidden className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(null)}
                      aria-label="取消"
                      className="tap grid size-6 place-items-center rounded text-ink-500 hover:bg-stage-800"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-100">
                      {arc.title}
                    </span>
                    <span className="text-[10px] text-ink-600 tabular-nums">
                      {arc.episodeCount === 0
                        ? '還沒有集數'
                        : `${arc.episodeCount} 集 · EP${pad(arc.firstNumber!)}–EP${pad(arc.lastNumber!)}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setRenaming(arc.id)
                        setRenameTo(arc.title)
                      }}
                      aria-label={`重新命名「${arc.title}」`}
                      className="tap grid size-6 place-items-center rounded text-ink-500 hover:bg-stage-800 hover:text-ink-100"
                    >
                      <Pencil aria-hidden className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(arc)}
                      disabled={arcs.length <= 1 || busy !== null}
                      aria-label={`刪除「${arc.title}」`}
                      title={
                        arcs.length <= 1
                          ? '這是最後一卷，刪掉就沒有地方放集數了'
                          : arc.episodeCount > 0
                            ? `裡面的 ${arc.episodeCount} 集會搬到其他卷，不會被刪掉`
                            : undefined
                      }
                      className="tap grid size-6 place-items-center rounded text-ink-500 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-30"
                    >
                      <Trash2 aria-hidden className="size-3" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* ---- new ------------------------------------------------------ */}
        <section className="flex items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[10px] text-ink-500">新增一卷</span>
            <input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void create()
              }}
              placeholder="例：第二卷《潮起》"
              className="rounded-lg bg-stage-800 px-2.5 py-2 text-[12px] text-ink-100 ring-1 ring-stage-700 focus:ring-accent-600 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!newTitle.trim() || busy !== null}
            className="tap inline-flex items-center gap-1 rounded-lg bg-stage-800 px-3 py-2 text-[11px] text-ink-200 hover:bg-stage-700 hover:text-ink-50 disabled:opacity-50"
          >
            {busy === '新增卷失敗' ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <FolderPlus aria-hidden className="size-3.5" />
            )}
            新增
          </button>
        </section>

        {/* ---- move ------------------------------------------------------ */}
        {arcs.length > 1 && selectable.length > 0 && (
          <section className="flex flex-col gap-2 border-t border-stage-700/60 pt-3">
            <h3 className="text-[11px] font-medium text-ink-300">把集數搬到另一卷</h3>
            <p className="text-[10px] leading-relaxed text-ink-600">
              只會改這一集屬於哪一卷。集號、小說、劇本、分鏡、進度全都不動。
              這裡列的是目前這一頁的集數——要搬別頁的，先翻到那一頁。
            </p>

            <div className="max-h-48 overflow-y-auto rounded-lg bg-stage-950/60 p-1.5">
              <ul className="flex flex-wrap gap-1">
                {selectable.map((episode) => {
                  const on = picked.has(episode.id)
                  return (
                    <li key={episode.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setPicked((previous) => {
                            const next = new Set(previous)
                            if (on) next.delete(episode.id)
                            else next.add(episode.id)
                            return next
                          })
                        }
                        className={cn(
                          'tap rounded px-1.5 py-1 text-[10px] tabular-nums transition-colors',
                          on
                            ? 'bg-accent-600 text-white'
                            : 'bg-stage-800 text-ink-400 hover:text-ink-100'
                        )}
                      >
                        EP{pad(episode.number)}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-ink-500">搬到</span>
                <select
                  value={moveTarget}
                  onChange={(event) => setMoveTarget(event.target.value)}
                  className="rounded-lg bg-stage-800 px-2.5 py-2 text-[12px] text-ink-100 ring-1 ring-stage-700 focus:ring-accent-600 focus:outline-none"
                >
                  {arcs.map((arc) => (
                    <option key={arc.id} value={arc.id}>
                      {arc.title}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => void move()}
                disabled={picked.size === 0 || busy !== null}
                className="tap rounded-lg bg-accent-600 px-3 py-2 text-[11px] text-white transition-colors hover:bg-accent-500 disabled:opacity-40"
              >
                {busy === '搬動失敗' ? '搬動中…' : `搬 ${picked.size} 集過去`}
              </button>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  )
}

function pad(n: number): string {
  return String(n).padStart(3, '0')
}
