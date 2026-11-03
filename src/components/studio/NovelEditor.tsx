'use client'

import { Check, FileText, History, Plus, Save, Search, Sparkles, Users } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn, countChars } from '@/lib/utils'

/**
 * 小說編輯器 (design 06).
 *
 * The text is plain prose with blank-line paragraphs, deliberately: a rich-text
 * model would need a schema, a serialiser and a migration path, and every one
 * of those is a way to lose somebody's writing. What this page owes the user is
 * that nothing they typed disappears — formatting can wait for M2's dedicated
 * editor work.
 *
 * Saving is optimistic-locked. Each save carries the document revision the
 * editor was opened on; the server refuses a stale one with 409 and this shows
 * the conflict rather than overwriting the other member.
 */

export type ChapterData = {
  id: string
  sortOrder: number
  title: string
  summary: string
  content: string
  charCount: number
  updatedAt: string
}

export type NovelEditorProps = {
  projectId: string
  documentId: string
  episodeId: string
  episodeNumber: number
  episodeTitle: string
  initialChapters: ChapterData[]
  initialRevision: number
  lastEditorName: string | null
  /** Target characters per episode, from the project's settings. */
  targetChars: number
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

const AUTOSAVE_DELAY_MS = 2500

export function NovelEditor({
  projectId,
  documentId,
  episodeId,
  episodeNumber,
  episodeTitle,
  initialChapters,
  initialRevision,
  lastEditorName,
  targetChars,
}: NovelEditorProps) {
  const toast = useToast()

  const [chapters, setChapters] = useState(initialChapters)
  const [activeId, setActiveId] = useState(initialChapters[0]?.id ?? null)
  const [revision, setRevision] = useState(initialRevision)
  const [state, setState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)

  const active = chapters.find((c) => c.id === activeId) ?? null

  const save = useCallback(
    async (chapterId: string, content: string, title: string) => {
      setState('saving')
      try {
        const response = await apiFetch(`/api/projects/${projectId}/chapters/${chapterId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content, title, expectedRevision: revision }),
        })

        if (response.status === 409) {
          setState('conflict')
          toast.error('無法儲存', await readApiError(response))
          return
        }
        if (!response.ok) throw new Error(await readApiError(response))

        const body = (await response.json()) as {
          chapter: ChapterData
          lockRevision: number
          savedAt: string
        }

        setRevision(body.lockRevision)
        setSavedAt(body.savedAt)
        setChapters((prev) => prev.map((c) => (c.id === chapterId ? body.chapter : c)))
        setState('saved')
      } catch (error) {
        setState('error')
        toast.error('儲存失敗', error instanceof Error ? error.message : undefined)
      }
    },
    [projectId, revision, toast]
  )

  // Leaving with unsaved text is the one thing this page must not allow
  // quietly.
  useEffect(() => {
    if (state !== 'dirty' && state !== 'saving') return

    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state])

  async function addChapter() {
    if (creating) return
    setCreating(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/documents/${documentId}/chapters`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: `第 ${chapters.length + 1} 章` }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { chapter: ChapterData; lockRevision: number }
      setChapters((prev) => [...prev, body.chapter])
      setActiveId(body.chapter.id)
      // Authoritative value from the server: creating a chapter advances the
      // revision, and a client guessing it would race.
      setRevision(body.lockRevision)
    } catch (error) {
      toast.error('新增章節失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setCreating(false)
    }
  }

  async function keepVersion() {
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/documents/${documentId}/versions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label: `EP${String(episodeNumber).padStart(3, '0')} 手動存檔` }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { version: number }
      toast.success('已儲存版本', `v${body.version} 已寫入版本紀錄`)
    } catch (error) {
      toast.error('儲存版本失敗', error instanceof Error ? error.message : undefined)
    }
  }

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return chapters
    return chapters.filter(
      (c) =>
        c.title.toLowerCase().includes(term) ||
        c.content.toLowerCase().includes(term) ||
        c.summary.toLowerCase().includes(term)
    )
  }, [chapters, filter])

  const documentChars = chapters.reduce((n, c) => n + c.charCount, 0)

  return (
    <div className="grid min-h-0 gap-4 p-3 sm:p-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:p-6 2xl:grid-cols-[16rem_minmax(0,1fr)_19rem]">
      {/* ---- chapter rail ------------------------------------------------ */}
      <aside className="panel flex min-h-0 flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
        <div className="flex flex-col gap-2 border-b border-stage-700/60 p-3">
          <button
            type="button"
            onClick={() => void addChapter()}
            disabled={creating}
            className="bg-brand-gradient glow-accent-sm inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Plus aria-hidden className="size-3.5" />
            {creating ? '新增中…' : '新增章節'}
          </button>

          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-600"
            />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="搜尋章節（標題或內容）"
              aria-label="搜尋章節"
              className="h-8 w-full rounded-lg bg-stage-850 pr-2 pl-8 text-[11px] text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <li className="px-2 py-6 text-center text-[11px] text-ink-600">
              {chapters.length === 0 ? '還沒有章節' : '沒有符合的章節'}
            </li>
          ) : (
            visible.map((chapter) => (
              <li key={chapter.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(chapter.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors',
                    chapter.id === activeId
                      ? 'bg-accent-600/20 text-ink-50 ring-1 ring-inset ring-accent-500/40'
                      : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
                  )}
                >
                  <span className="w-6 shrink-0 text-[10px] text-ink-600 tabular-nums">
                    {String(chapter.sortOrder).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {chapter.title || <span className="text-ink-600">未命名</span>}
                  </span>
                  {chapter.charCount > 0 && (
                    <Check aria-hidden className="size-3 shrink-0 text-emerald-400" />
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      {/* ---- editor ------------------------------------------------------ */}
      {active ? (
        /*
         * Keyed by chapter id so switching chapters remounts with fresh state.
         * Syncing props into state with an effect would leave a window where
         * the buffer belongs to one chapter and the id to another — which is
         * how an autosave lands on the wrong chapter.
         */
        <ChapterPane
          key={active.id}
          chapter={active}
          state={state}
          savedAt={savedAt}
          targetChars={targetChars}
          documentChars={documentChars}
          onDirty={() => setState('dirty')}
          onSave={(content, title) => save(active.id, content, title)}
          onKeepVersion={keepVersion}
        />
      ) : (
        <section className="panel flex min-h-0 min-w-0 flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <EmptyState
            title="還沒有章節"
            description="先新增一個章節，再開始寫。內容會自動儲存。"
            icon={<FileText aria-hidden className="size-5 text-ink-500" />}
            className="py-20"
          />
        </section>
      )}

      {/* ---- side panels -------------------------------------------------- */}
      <aside className="hidden min-w-0 flex-col gap-4 2xl:flex">
        <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <Sparkles aria-hidden className="size-3.5 text-accent-400" />
            <h3 className="flex-1 text-xs font-medium text-ink-200">AI 創作助手</h3>
          </header>
          <div className="p-4">
            <EmptyState
              title="尚未啟用"
              description="設定 ANTHROPIC_API_KEY 後，續寫、擴寫、潤飾等功能才會開放。訂閱方案不等於 API 額度。"
              icon={<Sparkles aria-hidden className="size-5 text-ink-500" />}
              className="py-6"
            />
          </div>
        </section>

        <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <FileText aria-hidden className="size-3.5 text-accent-400" />
            <h3 className="flex-1 text-xs font-medium text-ink-200">章節資訊</h3>
          </header>
          <dl className="flex flex-col gap-2 p-4 text-[11px]">
            <Row label="關聯集數">
              EP{String(episodeNumber).padStart(3, '0')}
              {episodeTitle && ` ${episodeTitle}`}
            </Row>
            <Row label="章節標題">{active?.title || '未命名'}</Row>
            <Row label="本章字數">{(active?.charCount ?? 0).toLocaleString('en-US')}</Row>
            <Row label="最後編輯">{lastEditorName ?? '—'}</Row>
            <Row label="文件版本">r{revision}</Row>
          </dl>
        </section>

        <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <Users aria-hidden className="size-3.5 text-accent-400" />
            <h3 className="flex-1 text-xs font-medium text-ink-200">備註與討論</h3>
            <span className="text-[10px] text-ink-700">M2</span>
          </header>
          <div className="p-4">
            <EmptyState
              title="尚未實作"
              description="審稿評論於 M2 的審核中心一併交付。"
              className="py-6"
            />
          </div>
        </section>

        <Link
          href={`/projects/${projectId}/episodes?ep=${episodeId}`}
          className="text-center text-[11px] text-ink-600 transition-colors hover:text-ink-300"
        >
          返回集數管理
        </Link>
      </aside>
    </div>
  )
}

/**
 * One chapter's buffer.
 *
 * Mounted with a `key` of the chapter id, so its state starts from that
 * chapter's text and the autosave timer dies with it. Nothing syncs props into
 * state, which is what keeps a pending save from landing on the chapter the
 * reader just switched away from.
 */
function ChapterPane({
  chapter,
  state,
  savedAt,
  targetChars,
  documentChars,
  onDirty,
  onSave,
  onKeepVersion,
}: {
  chapter: ChapterData
  state: SaveState
  savedAt: string | null
  targetChars: number
  documentChars: number
  onDirty: () => void
  onSave: (content: string, title: string) => void | Promise<void>
  onKeepVersion: () => void | Promise<void>
}) {
  const [content, setContent] = useState(chapter.content)
  const [title, setTitle] = useState(chapter.title)

  const charCount = countChars(content)

  // Autosave: the timer restarts on every keystroke and fires once typing
  // pauses. Unmounting (a chapter switch) clears it.
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (state !== 'dirty') return

    timer.current = window.setTimeout(() => {
      void onSave(content, title)
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [state, content, title, onSave])

  return (
    <section className="panel flex min-h-0 min-w-0 flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
      <header className="flex flex-wrap items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            onDirty()
          }}
          placeholder="章節標題"
          aria-label="章節標題"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink-50 placeholder:text-ink-600 focus:outline-none"
        />

        <SaveBadge state={state} savedAt={savedAt} />

        <button
          type="button"
          onClick={() => void onSave(content, title)}
          disabled={state === 'saving'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-300 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-50 disabled:opacity-60"
        >
          <Save aria-hidden className="size-3.5" />
          儲存草稿
        </button>

        <button
          type="button"
          onClick={() => void onKeepVersion()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-300 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-50"
        >
          <History aria-hidden className="size-3.5" />
          存成版本
        </button>
      </header>

      <textarea
        value={content}
        onChange={(event) => {
          setContent(event.target.value)
          onDirty()
        }}
        spellCheck={false}
        placeholder="在這裡寫。空一行分段。"
        aria-label="章節內容"
        className="min-h-[24rem] flex-1 resize-none bg-transparent px-5 py-4 text-sm leading-[2] text-ink-100 placeholder:text-ink-700 focus:outline-none"
      />

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stage-700/60 px-4 py-2.5 text-[11px] text-ink-500">
        <span className="tabular-nums">
          字數：<span className="text-ink-200">{charCount.toLocaleString('en-US')}</span>
        </span>
        <span className="tabular-nums">目標：{targetChars.toLocaleString('en-US')} 字</span>
        <span className="tabular-nums">
          本集合計：{documentChars.toLocaleString('en-US')} 字
        </span>
        <span className="ml-auto">
          自動儲存：已開啟（停筆 {AUTOSAVE_DELAY_MS / 1000} 秒後）
        </span>
      </footer>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-right text-ink-200">{children}</dd>
    </div>
  )
}

function SaveBadge({ state, savedAt }: { state: SaveState; savedAt: string | null }) {
  const text =
    state === 'saving'
      ? '儲存中…'
      : state === 'dirty'
        ? '尚未儲存'
        : state === 'conflict'
          ? '有衝突，請重新載入'
          : state === 'error'
            ? '儲存失敗'
            : savedAt
              ? `已儲存 ${new Intl.DateTimeFormat('zh-TW', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  hour12: false,
                  timeZone: 'Asia/Taipei',
                }).format(new Date(savedAt))}`
              : '尚無變更'

  return (
    <span
      role="status"
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset tabular-nums',
        state === 'conflict' || state === 'error'
          ? 'bg-rose-950 text-rose-300 ring-rose-800'
          : state === 'dirty'
            ? 'bg-amber-950 text-amber-300 ring-amber-800'
            : 'bg-stage-850 text-ink-500 ring-stage-700'
      )}
    >
      {text}
    </span>
  )
}
