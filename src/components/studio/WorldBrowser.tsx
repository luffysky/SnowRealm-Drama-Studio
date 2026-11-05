'use client'

import { BookOpen, Clock, Plus, Search, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import {
  WORLD_CATEGORIES,
  WORLD_CATEGORY_LABEL,
  WORLD_EVENT_SCOPE_LABEL,
  WORLD_EVENT_SCOPES,
  type WorldCategoryValue,
  type WorldEventScopeValue,
} from '@/lib/constants'
import { cn, formatRelativeZh } from '@/lib/utils'

/**
 * 世界觀設定 (design 09).
 *
 * Entries are standing facts; events are points on the story's timeline. The
 * page keeps them in separate columns because they answer different questions —
 * "how does the crossing work" and "when does she lose her memory" are not the
 * same kind of thing, and a single list would force one of them to pretend.
 *
 * The categories are the ones spec v3 §09 names. The design's 特殊能力 and
 * 生物圖鑑 tabs are absent on purpose: §09 says to drop the unsettled 修仙
 * material rather than build UI that invites inventing it.
 */

export type WorldEntryItem = {
  id: string
  category: WorldCategoryValue
  title: string
  summary: string
  body: string
  isCanon: boolean
  tags: string[]
  updatedAt: string
}

export type WorldEventItem = {
  id: string
  scope: WorldEventScopeValue
  title: string
  description: string
  eraLabel: string
  inUniverseOrder: number
  revealedInEpisode: number | null
  isCanon: boolean
}

export type WorldBrowserProps = {
  projectId: string
  entries: WorldEntryItem[]
  events: WorldEventItem[]
  countsByCategory: Record<string, number>
  totalEntries: number
  canonEntries: number
  /** 頁面在伺服器端組好的 AI 發動鈕，渲染在標題列右邊 (Z153)。 */
  ai?: ReactNode
}

export function WorldBrowser({
  projectId,
  entries,
  events,
  countsByCategory,
  totalEntries,
  canonEntries,
  ai,
}: WorldBrowserProps) {
  const router = useRouter()
  const toast = useToast()

  const [category, setCategory] = useState<WorldCategoryValue | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(entries[0]?.id ?? null)
  const [composing, setComposing] = useState<'entry' | 'event' | null>(null)
  const [removing, setRemoving] = useState<WorldEntryItem | null>(null)
  const [removingEvent, setRemovingEvent] = useState<WorldEventItem | null>(null)
  const [busy, setBusy] = useState(false)

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return entries.filter((entry) => {
      if (category !== 'ALL' && entry.category !== category) return false
      if (!term) return true
      return (
        entry.title.toLowerCase().includes(term) ||
        entry.summary.toLowerCase().includes(term) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(term))
      )
    })
  }, [entries, category, search])

  const selected = entries.find((e) => e.id === selectedId) ?? null

  async function remove(entry: WorldEntryItem) {
    setBusy(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/world/entries/${entry.id}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已移除', `「${entry.title}」已從世界觀移除`)
      setRemoving(null)
      setSelectedId(null)
      router.refresh()
    } catch (error) {
      toast.error('移除失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  async function removeEvent(event: WorldEventItem) {
    setBusy(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/world/events/${event.id}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success('已移除', `「${event.title}」已從時間線移除`)
      setRemovingEvent(null)
      router.refresh()
    } catch (error) {
      toast.error('移除失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  async function toggleCanon(entry: WorldEntryItem) {
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/world/entries/${entry.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isCanon: !entry.isCanon }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))
      router.refresh()
    } catch (error) {
      toast.error('更新失敗', error instanceof Error ? error.message : undefined)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
          <BookOpen aria-hidden className="size-4 text-accent-400" />
          世界觀設定
        </h2>
        <p className="text-[11px] text-ink-500">
          {totalEntries} 條設定（{canonEntries} 條正史）・{events.length} 個時間線事件
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/*
            世界觀生成與一致性檢查 (Z153)。由頁面在伺服器端組好再傳進來：
            一致性檢查要讀某一集的正文，而「有哪些集有正文」是一次查詢，
            不該在這個元件裡再問一次。
          */}
          {ai}
          <button
            type="button"
            onClick={() => setComposing('entry')}
            className="bg-brand-gradient glow-accent-sm inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus aria-hidden className="size-3.5" />
            新增設定
          </button>
          <button
            type="button"
            onClick={() => setComposing('event')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stage-800 px-3 py-2 text-xs text-ink-200 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-50"
          >
            <Clock aria-hidden className="size-3.5" />
            新增事件
          </button>
        </div>
      </header>

      {/* ---- category pills ---------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {(['ALL', ...WORLD_CATEGORIES] as const).map((option) => {
            const n = option === 'ALL' ? totalEntries : (countsByCategory[option] ?? 0)
            return (
              <button
                key={option}
                type="button"
                onClick={() => setCategory(option)}
                aria-pressed={category === option}
                className={cn(
                  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors',
                  category === option
                    ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                    : 'bg-stage-900 text-ink-400 ring-1 ring-inset ring-stage-700 hover:text-ink-100'
                )}
              >
                {option === 'ALL' ? '全部' : WORLD_CATEGORY_LABEL[option]}
                <span className="text-[10px] text-ink-600 tabular-nums">{n}</span>
              </button>
            )
          })}
        </div>

        <div className="relative w-full min-w-0 sm:ml-auto sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-600"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜尋標題、摘要或標籤"
            aria-label="搜尋世界觀"
            className="h-9 w-full rounded-lg bg-stage-900 pr-3 pl-9 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_18rem]">
        {/* ---- entries ---------------------------------------------------- */}
        <section className="panel flex flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <BookOpen aria-hidden className="size-3.5 text-accent-400" />
            <h3 className="flex-1 text-xs font-medium text-ink-200">設定條目</h3>
            <span className="text-[10px] text-ink-600">{visible.length}</span>
          </header>

          {visible.length === 0 ? (
            <EmptyState
              title={totalEntries === 0 ? '還沒有任何設定' : '沒有符合的設定'}
              description={
                totalEntries === 0
                  ? '王朝、地理、商路、制度、穿越規則與伏筆都寫在這裡。寫下來的設定會成為正史，AI 生成時以此為準。'
                  : '換個分類或關鍵字試試。'
              }
              icon={<BookOpen aria-hidden className="size-5 text-ink-500" />}
              className="py-14"
            />
          ) : (
            <ul className="max-h-[36rem] overflow-y-auto p-2">
              {visible.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors',
                      entry.id === selectedId
                        ? 'bg-accent-600/20 ring-1 ring-inset ring-accent-500/40'
                        : 'hover:bg-stage-800'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[9px] text-ink-400 ring-1 ring-inset ring-stage-700">
                        {WORLD_CATEGORY_LABEL[entry.category]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-100">
                        {entry.title}
                      </span>
                      {!entry.isCanon && (
                        <span className="shrink-0 rounded bg-stage-850 px-1.5 py-0.5 text-[9px] text-ink-500 ring-1 ring-inset ring-stage-700">
                          待定
                        </span>
                      )}
                    </div>
                    {entry.summary && (
                      <p className="truncate text-[10px] text-ink-500">{entry.summary}</p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- timeline ---------------------------------------------------- */}
        <section className="panel flex flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <Clock aria-hidden className="size-3.5 text-accent-400" />
            <h3 className="flex-1 text-xs font-medium text-ink-200">時間軸（歷史年表）</h3>
            <span className="text-[10px] text-ink-600">{events.length}</span>
          </header>

          {events.length === 0 ? (
            <EmptyState
              title="時間線還是空的"
              description="前世、穿越、失憶、梅花印記都是有先後的事件，不是設定。記在這裡才排得出伏筆回收的順序。"
              icon={<Clock aria-hidden className="size-5 text-ink-500" />}
              className="py-14"
            />
          ) : (
            <ol className="max-h-[36rem] overflow-y-auto p-4">
              {events.map((event, index) => (
                <li key={event.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1 size-2.5 shrink-0 rounded-full ring-2 ring-stage-900',
                        event.scope === 'MAIN_TIMELINE'
                          ? 'bg-accent-400'
                          : event.scope === 'FORESHADOWED'
                            ? 'bg-gilt-400'
                            : 'bg-stage-600'
                      )}
                    />
                    {index < events.length - 1 && (
                      <span aria-hidden className="w-px flex-1 bg-stage-700" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 pb-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      {event.eraLabel && (
                        <span className="text-[10px] text-ink-500 tabular-nums">
                          {event.eraLabel}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-100">
                        {event.title}
                      </span>
                      <span className="shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[9px] text-ink-400 ring-1 ring-inset ring-stage-700">
                        {WORLD_EVENT_SCOPE_LABEL[event.scope]}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRemovingEvent(event)}
                        aria-label={`\u79fb\u9664 ${event.title}`}
                        className="shrink-0 text-ink-700 transition-colors hover:text-rose-300"
                      >
                        <Trash2 aria-hidden className="size-3" />
                      </button>
                    </div>
                    {event.description && (
                      <p className="mt-0.5 text-[10px] leading-relaxed text-ink-500">
                        {event.description}
                      </p>
                    )}
                    {event.revealedInEpisode && (
                      <p className="mt-0.5 text-[10px] text-ink-600 tabular-nums">
                        於 EP{String(event.revealedInEpisode).padStart(3, '0')} 揭露
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ---- detail ------------------------------------------------------ */}
        <aside className="flex min-w-0 flex-col gap-4">
          <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
            <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
              <h3 className="flex-1 text-xs font-medium text-ink-200">條目詳情</h3>
            </header>

            {selected ? (
              <div className="flex flex-col gap-3 p-4">
                <h4 className="text-sm font-semibold text-ink-50">{selected.title}</h4>

                <dl className="flex flex-col gap-2 text-[11px]">
                  <Row label="分類">{WORLD_CATEGORY_LABEL[selected.category]}</Row>
                  <Row label="狀態">
                    <button
                      type="button"
                      onClick={() => void toggleCanon(selected)}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset transition-colors',
                        selected.isCanon
                          ? 'bg-gilt-400/15 text-gilt-300 ring-gilt-500/50'
                          : 'bg-stage-850 text-ink-500 ring-stage-700'
                      )}
                    >
                      {selected.isCanon ? '正史' : '待定'}
                    </button>
                  </Row>
                  <Row label="最後更新">{formatRelativeZh(selected.updatedAt)}</Row>
                </dl>

                {selected.summary && (
                  <p className="text-[11px] leading-relaxed text-ink-300">{selected.summary}</p>
                )}
                {selected.body && (
                  <p className="text-[11px] leading-relaxed whitespace-pre-wrap text-ink-400">
                    {selected.body}
                  </p>
                )}

                {selected.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-stage-800 px-1.5 py-0.5 text-[10px] text-ink-400 ring-1 ring-inset ring-stage-700"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setRemoving(selected)}
                  className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-stage-850 px-3 py-2 text-[11px] text-ink-500 ring-1 ring-inset ring-stage-700 transition-colors hover:text-rose-300"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                  移除此條目
                </button>
              </div>
            ) : (
              <EmptyState title="選一個條目以檢視" className="py-10" />
            )}
          </section>

          <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
            <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
              <h3 className="flex-1 text-xs font-medium text-ink-200">AI 世界觀助理</h3>
              <span className="text-[10px] text-ink-700">M2</span>
            </header>
            <div className="p-4">
              <EmptyState
                title="尚未啟用"
                description="設定 ANTHROPIC_API_KEY 後，「擴充世界設定」與「檢查設定一致性」才會開放。一致性檢查會以這裡的正史條目為準。"
                className="py-6"
              />
            </div>
          </section>
        </aside>
      </div>

      {composing && (
        <ComposeDialog
          kind={composing}
          projectId={projectId}
          onClose={() => setComposing(null)}
          onCreated={() => {
            setComposing(null)
            router.refresh()
          }}
        />
      )}

      <ConfirmDialog
        open={removing !== null}
        title="移除這個世界觀條目？"
        tone="danger"
        busy={busy}
        message={
          removing
            ? `「${removing.title}」會從世界觀移除。這是軟刪除，資料仍留在資料庫中，但不會再出現在設定與 AI 參考範圍內。`
            : ''
        }
        confirmLabel={busy ? '移除中…' : '確定移除'}
        onConfirm={() => {
          if (removing) void remove(removing)
        }}
        onCancel={() => setRemoving(null)}
      />

      <ConfirmDialog
        open={removingEvent !== null}
        title="\u79fb\u9664\u9019\u500b\u6642\u9593\u7dda\u4e8b\u4ef6\uff1f"
        tone="danger"
        busy={busy}
        message={
          removingEvent
            ? `\u300c${removingEvent.title}\u300d\u6703\u5f9e\u6642\u9593\u7dda\u79fb\u9664\u3002\u9019\u662f\u8edf\u522a\u9664\uff0c\u8cc7\u6599\u4ecd\u7559\u5728\u8cc7\u6599\u5eab\u4e2d\u3002`
            : ''
        }
        confirmLabel={busy ? '\u79fb\u9664\u4e2d\u2026' : '\u78ba\u5b9a\u79fb\u9664'}
        onConfirm={() => {
          if (removingEvent) void removeEvent(removingEvent)
        }}
        onCancel={() => setRemovingEvent(null)}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function ComposeDialog({
  kind,
  projectId,
  onClose,
  onCreated,
}: {
  kind: 'entry' | 'event'
  projectId: string
  onClose: () => void
  onCreated: () => void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [category, setCategory] = useState<WorldCategoryValue>('DYNASTY')
  const [scope, setScope] = useState<WorldEventScopeValue>('MAIN_TIMELINE')
  const [eraLabel, setEraLabel] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || busy) return

    setBusy(true)
    try {
      const path =
        kind === 'entry'
          ? `/api/projects/${projectId}/world/entries`
          : `/api/projects/${projectId}/world/events`

      const body =
        kind === 'entry'
          ? { category, title: title.trim(), summary: summary.trim() }
          : { scope, title: title.trim(), description: summary.trim(), eraLabel: eraLabel.trim() }

      const response = await apiFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      toast.success(kind === 'entry' ? '已新增設定' : '已新增事件', title.trim())
      onCreated()
    } catch (error) {
      toast.error('新增失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div aria-hidden className="absolute inset-0 bg-stage-990/80 backdrop-blur-sm" onClick={onClose} />

      <form
        onSubmit={submit}
        className="panel relative z-10 flex w-full max-w-md animate-rise flex-col gap-3 rounded-xl bg-stage-900 p-5 ring-1 ring-stage-700"
      >
        <h3 className="text-sm font-semibold text-ink-50">
          {kind === 'entry' ? '新增世界觀設定' : '新增時間線事件'}
        </h3>

        {kind === 'entry' ? (
          <label className="flex flex-col gap-1 text-[11px] text-ink-400">
            分類
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as WorldCategoryValue)}
              className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            >
              {WORLD_CATEGORIES.map((option) => (
                <option key={option} value={option}>
                  {WORLD_CATEGORY_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-[11px] text-ink-400">
              類型
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as WorldEventScopeValue)}
                className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
              >
                {WORLD_EVENT_SCOPES.map((option) => (
                  <option key={option} value={option}>
                    {WORLD_EVENT_SCOPE_LABEL[option]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-[11px] text-ink-400">
              紀年（例：永昌三年冬）
              <input
                value={eraLabel}
                onChange={(event) => setEraLabel(event.target.value)}
                className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
              />
            </label>
          </>
        )}

        <label className="flex flex-col gap-1 text-[11px] text-ink-400">
          {kind === 'entry' ? '標題' : '事件名稱'}
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            autoFocus
            required
            className="h-9 rounded-lg bg-stage-850 px-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-ink-400">
          {kind === 'entry' ? '摘要' : '說明'}
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            className="resize-none rounded-lg bg-stage-850 p-2 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </label>

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-xs text-ink-400 transition-colors hover:text-ink-100"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="bg-brand-gradient glow-accent-sm rounded-lg px-4 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? '新增中…' : '新增'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-right text-ink-200">{children}</dd>
    </div>
  )
}
