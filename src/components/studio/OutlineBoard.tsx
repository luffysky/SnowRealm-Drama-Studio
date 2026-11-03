'use client'

import {
  Check,
  ChevronRight,
  Loader2,
  PenLine,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { OutlineGenerator } from '@/components/studio/OutlineGenerator'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import type { ProjectReadiness } from '@/lib/ai/readiness'
import type { CurrencyValue, FxRates } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * 分集大綱 — the beat sheet (`docs/OUTLINE.md`).
 *
 * This is the page 小說編輯 should have been. What was here before listed all
 * 120 episodes as identical cards, which made it a second copy of 集數管理:
 * the writer clicked 小說編輯 and landed on something that looked like the
 * episode list, because it was one.
 *
 * An outline is a working surface, not a directory. Every line is editable in
 * place, the list stays on one screen, and the AI drafts into the same fields
 * a person types into — never into a separate "AI output" that has to be
 * copied across by hand.
 */

export type OutlineEpisode = {
  id: string
  number: number
  title: string
  logline: string
  synopsis: string
  status: string
  charCount: number
}

const PER_PAGE = 20

export function OutlineBoard({
  projectId,
  episodes,
  canWrite,
  currency,
  fx,
  providerReady,
  providerDetail,
  readiness,
}: {
  projectId: string
  episodes: OutlineEpisode[]
  canWrite: boolean
  currency: CurrencyValue
  fx: FxRates
  providerReady: boolean
  providerDetail?: string
  readiness: ProjectReadiness
}) {
  const [rows, setRows] = useState(episodes)
  const [query, setQuery] = useState('')
  const [onlyEmpty, setOnlyEmpty] = useState(false)
  const [page, setPage] = useState(1)
  const [generating, setGenerating] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return rows.filter((row) => {
      if (onlyEmpty && (row.logline.trim() || row.synopsis.trim())) return false
      if (!needle) return true

      return (
        String(row.number).padStart(3, '0').includes(needle) ||
        row.title.toLowerCase().includes(needle) ||
        row.logline.toLowerCase().includes(needle) ||
        row.synopsis.toLowerCase().includes(needle)
      )
    })
  }, [rows, query, onlyEmpty])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER_PAGE))
  const current = Math.min(page, pageCount)
  const visible = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE)

  const written = rows.filter((row) => row.logline.trim() || row.synopsis.trim()).length

  function replaceRow(next: OutlineEpisode) {
    setRows((all) => all.map((row) => (row.id === next.id ? next : row)))
  }

  function applyMany(updates: { episodeId: string; title?: string; logline?: string; synopsis?: string }[]) {
    setRows((all) =>
      all.map((row) => {
        const update = updates.find((entry) => entry.episodeId === row.id)
        if (!update) return row
        return {
          ...row,
          title: update.title ?? row.title,
          logline: update.logline ?? row.logline,
          synopsis: update.synopsis ?? row.synopsis,
        }
      })
    )
  }

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          <PenLine aria-hidden className="size-4 text-accent-400" />
          分集大綱
        </h3>
        <span className="text-[11px] text-ink-500">
          已寫 {written} / {rows.length} 集
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-600"
            />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="搜尋集數或大綱"
              aria-label="搜尋大綱"
              className="h-8 w-44 pl-8 text-xs sm:w-56"
            />
          </label>

          <button
            type="button"
            aria-pressed={onlyEmpty}
            onClick={() => {
              setOnlyEmpty((value) => !value)
              setPage(1)
            }}
            className={cn(
              'h-8 rounded-md px-2.5 text-[11px] font-medium transition-colors',
              onlyEmpty
                ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                : 'text-ink-500 ring-1 ring-inset ring-stage-700 hover:bg-stage-800 hover:text-ink-200'
            )}
          >
            只看未寫
          </button>

          {canWrite && (
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Sparkles aria-hidden className="size-3.5" />}
              onClick={() => setGenerating(true)}
            >
              AI 生成大綱
            </Button>
          )}
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="rounded-xl bg-stage-900 px-4 py-10 text-center text-xs text-ink-600 ring-1 ring-stage-700">
          {onlyEmpty && written === rows.length
            ? '每一集都有大綱了。'
            : '沒有符合的集數。'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((row) => (
            <li key={row.id}>
              <OutlineRow
                projectId={projectId}
                row={row}
                canWrite={canWrite}
                onSaved={replaceRow}
              />
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="flex items-center justify-center gap-1 pt-1" aria-label="分頁">
          <Button
            size="sm"
            variant="ghost"
            disabled={current <= 1}
            onClick={() => setPage(current - 1)}
          >
            上一頁
          </Button>
          <span className="px-2 text-[11px] text-ink-500">
            {current} / {pageCount}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={current >= pageCount}
            onClick={() => setPage(current + 1)}
          >
            下一頁
          </Button>
        </nav>
      )}

      {generating && (
        <OutlineGenerator
          projectId={projectId}
          episodes={rows}
          currency={currency}
          fx={fx}
          providerReady={providerReady}
          {...(providerDetail ? { providerDetail } : {})}
          readiness={readiness}
          onClose={() => setGenerating(false)}
          onApplied={applyMany}
        />
      )}
    </section>
  )
}

/* -------------------------------------------------------------------------- */

function OutlineRow({
  projectId,
  row,
  canWrite,
  onSaved,
}: {
  projectId: string
  row: OutlineEpisode
  canWrite: boolean
  onSaved: (row: OutlineEpisode) => void
}) {
  const router = useRouter()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(row.title)
  const [logline, setLogline] = useState(row.logline)
  const [synopsis, setSynopsis] = useState(row.synopsis)
  const [saving, setSaving] = useState(false)

  const dirty = title !== row.title || logline !== row.logline || synopsis !== row.synopsis
  const label = `EP${String(row.number).padStart(3, '0')}`

  async function save() {
    setSaving(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${row.id}/outline`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title, logline, synopsis }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      onSaved({ ...row, title, logline, synopsis })
      setOpen(false)
      // The workbench header counts written episodes on the server.
      router.refresh()
    } catch (cause) {
      toast.error('大綱儲存失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setTitle(row.title)
    setLogline(row.logline)
    setSynopsis(row.synopsis)
    setOpen(false)
  }

  /**
   * Saves the title alone, from the inline field on the row.
   *
   * Separate from `save()` so renaming an episode does not also write back
   * whatever is sitting in the collapsed logline and synopsis state — which,
   * if the panel was opened and abandoned, is not what is on the server.
   */
  async function saveTitle(next: string) {
    const value = next.trim()
    if (value === row.title) return

    setSaving(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${row.id}/outline`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: value }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      setTitle(value)
      onSaved({ ...row, title: value })
      router.refresh()
    } catch (cause) {
      setTitle(row.title)
      toast.error('集名儲存失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const empty = !row.logline.trim() && !row.synopsis.trim()

  return (
    <div
      className={cn(
        'rounded-lg bg-stage-900 ring-1 transition-colors',
        open ? 'ring-accent-500/40' : 'ring-stage-700 hover:ring-stage-600'
      )}
    >
      <div className="flex items-start gap-2.5 px-3 py-2">
        <span className="mt-0.5 w-12 shrink-0 text-[11px] font-medium text-ink-400 tabular-nums">
          {label}
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          {/*
            The title edits here, not only inside the expanded panel. 集名 is
            the field people fix in passing, and making them open a panel for
            one word is why every episode was still 「未命名」.
          */}
          <div className="flex items-center gap-2">
            <InlineTitle
              value={row.title}
              canWrite={canWrite}
              saving={saving}
              onCommit={(next) => void saveTitle(next)}
            />
            {row.charCount > 0 && (
              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
                已動筆 {row.charCount.toLocaleString('en-US')} 字
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => canWrite && setOpen((value) => !value)}
            aria-expanded={open}
            disabled={!canWrite}
            className={cn(
              'tap mt-0.5 line-clamp-1 block w-full text-left text-[11px] disabled:cursor-default',
              empty ? 'text-ink-700' : 'text-ink-500'
            )}
          >
            {row.logline || row.synopsis.split('\n')[0] || '尚未寫大綱'}
          </button>
        </div>

        <Link
          href={`/projects/${projectId}/episodes/${row.id}/novel`}
          className="mt-0.5 flex shrink-0 items-center gap-0.5 rounded-md px-2 py-1 text-[11px] text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-100"
        >
          寫這集
          <ChevronRight aria-hidden className="size-3" />
        </Link>
      </div>

      {open && (
        <div className="flex flex-col gap-2 border-t border-stage-700/70 px-3 py-2.5">
          <div className="flex flex-col gap-1.5 sm:flex-row">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-[10px] text-ink-600">標題</span>
              <Input
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="八個字以內"
                className="h-8 text-xs"
              />
            </label>
            <label className="flex min-w-0 flex-[2] flex-col gap-1">
              <span className="text-[10px] text-ink-600">一句話</span>
              <Input
                value={logline}
                maxLength={300}
                onChange={(event) => setLogline(event.target.value)}
                placeholder="一句話講完這集發生什麼"
                className="h-8 text-xs"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-ink-600">大綱</span>
            <Textarea
              value={synopsis}
              rows={4}
              maxLength={5000}
              onChange={(event) => setSynopsis(event.target.value)}
              placeholder="事件與轉折，最後一句是下一集的鉤子。"
              className="text-xs"
            />
          </label>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => void save()}
              loading={saving}
              loadingText="儲存中…"
              disabled={!dirty}
              leadingIcon={<Check aria-hidden className="size-3.5" />}
            >
              儲存
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={cancel}
              disabled={saving}
              leadingIcon={<X aria-hidden className="size-3.5" />}
            >
              取消
            </Button>
            {saving && <Loader2 aria-hidden className="size-3.5 animate-spin text-ink-500" />}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The episode title, editable where it is shown.
 *
 * Click to edit, Enter or blur to save, Escape to abandon. Uncontrolled and
 * keyed on the value, so the field picks up a title changed elsewhere — by the
 * expanded panel, or by the other member — without syncing state in an effect.
 */
function InlineTitle({
  value,
  canWrite,
  saving,
  onCommit,
}: {
  value: string
  canWrite: boolean
  saving: boolean
  onCommit: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)

  if (!canWrite) {
    return (
      <span
        className={cn(
          'min-w-0 truncate text-xs',
          value ? 'font-medium text-ink-100' : 'text-ink-600'
        )}
      >
        {value || '未命名'}
      </span>
    )
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="點一下改集名"
        className={cn(
          'tap min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-stage-800',
          value ? 'font-medium text-ink-100' : 'text-ink-600'
        )}
      >
        {value || '未命名'}
      </button>
    )
  }

  return (
    <input
      key={value}
      autoFocus
      defaultValue={value}
      maxLength={120}
      disabled={saving}
      placeholder="集名"
      aria-label="集名"
      onBlur={(event) => {
        setEditing(false)
        onCommit(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          // Reset before blurring, so the blur handler commits the old value
          // and the edit is genuinely abandoned.
          event.currentTarget.value = value
          event.currentTarget.blur()
        }
      }}
      className="min-w-0 flex-1 rounded bg-stage-850 px-1 py-0.5 text-xs font-medium text-ink-50 ring-1 ring-accent-500 outline-none"
    />
  )
}
