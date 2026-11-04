'use client'

import {
  Check,
  FileText,
  History,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import type { AiSelectionAction } from '@/components/editor/AiSelectionMenu'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import { AiAssistant } from '@/components/studio/AiAssistant'
import { NovelExportMenu } from '@/components/studio/NovelExportMenu'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import type { AiJobKindValue } from '@/lib/constants'
import type { EditorModuleId } from '@/lib/editor/modules'
import type { CurrencyValue, FxRates } from '@/lib/money'
import { cn } from '@/lib/utils'
import { countText } from '@/lib/utils'

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
  /** From `?chapter=` — which chapter a search result wants opened. */
  initialChapterId?: string | null
  initialRevision: number
  lastEditorName: string | null
  /** Target characters per episode, from the project's settings. */
  targetChars: number
  /** Editor modules enabled for 小說, read from app_settings. */
  modules: EditorModuleId[]
  currency: CurrencyValue
  fx: FxRates
  /** Whether a provider key is configured; the AI panel explains when not. */
  providerReady: boolean
  providerDetail?: string
  /**
   * Every chapter in the book. The rail can show this episode's chapters or
   * the whole novel; without it the 章節目錄 was an index of one episode out
   * of a hundred and twenty.
   */
  toc: NovelTocEpisode[]
}

export type NovelTocEpisode = {
  episodeId: string
  number: number
  title: string
  charCount: number
  chapters: { id: string; sortOrder: number; title: string; charCount: number }[]
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
  initialChapterId,
  initialRevision,
  lastEditorName,
  targetChars,
  modules,
  currency,
  fx,
  providerReady,
  providerDetail,
  toc,
}: NovelEditorProps) {
  const toast = useToast()
  const router = useRouter()
  const [enabledModules, setEnabledModules] = useState(modules)

  const [chapters, setChapters] = useState(initialChapters)
  /** 本集 or 全書 for the chapter rail. */
  const [scope, setScope] = useState<'episode' | 'book'>('episode')
  /*
   * A search result links straight to the chapter it matched
   * (`?chapter=<id>`), so the reader lands on the prose rather than on
   * whichever chapter happens to be first.
   */
  const [activeId, setActiveId] = useState(
    (initialChapterId && initialChapters.some((c) => c.id === initialChapterId)
      ? initialChapterId
      : initialChapters[0]?.id) ?? null
  )
  const [revision, setRevision] = useState(initialRevision)
  const [state, setState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  /** The chapter whose 刪除 is waiting for a second click. */
  /** The live editor, for inserting at the cursor (Z122). */
  const editorRef = useRef<import('@tiptap/react').Editor | null>(null)

  // Stable, so the editor does not re-publish itself on every render.
  const holdEditor = useCallback((editor: import('@tiptap/react').Editor | null) => {
    editorRef.current = editor
  }, [])

  const [confirming, setConfirming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  /*
   * What the AI panel should work on. Null means the whole chapter; a
   * selection from the editor's floating menu narrows it, which is both
   * cheaper and far more likely to come back usable — a 潤稿 of 4,000
   * characters mostly pays to re-read context it was not asked to change.
   */
  const [aiScope, setAiScope] = useState<{ text: string; nonce: number } | null>(null)
  const [aiRequest, setAiRequest] = useState<{ task: AiJobKindValue; nonce: number } | null>(
    null
  )

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

  /**
   * Deletes a chapter.
   *
   * Two clicks rather than a `confirm()` dialog: a browser dialog blocks the
   * page and reads as a warning from the browser, not a choice in this app.
   *
   * It is safe to do without a modal because it is not final — the server
   * snapshots the whole document into 版本紀錄 first, in the same
   * transaction, and the toast says so. That matters more than a scarier
   * dialog would.
   */
  async function removeChapter(chapterId: string) {
    setDeleting(chapterId)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/chapters/${chapterId}?revision=${revision}`,
        { method: 'DELETE' }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as {
        deletedId: string
        title: string
        lockRevision: number
        backupVersion: number
      }

      const remaining = chapters.filter((c) => c.id !== body.deletedId)
      /*
       * Renumbered server-side to close the gap, so the rail does not read
       * 01, 02, 04 until the next reload.
       */
      setChapters(
        remaining.map((c, index) => ({ ...c, sortOrder: index + 1 }))
      )
      setRevision(body.lockRevision)
      setConfirming(null)

      if (activeId === body.deletedId) setActiveId(remaining[0]?.id ?? null)

      toast.success(
        `已刪除「${body.title}」`,
        `原本的內容存成版本 v${body.backupVersion}，可以從版本紀錄還原`
      )
      router.refresh()
    } catch (error) {
      toast.error('刪不掉', error instanceof Error ? error.message : undefined)
    } finally {
      setDeleting(null)
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

  async function toggleModule(id: EditorModuleId, next: boolean) {
    const wanted = next
      ? [...enabledModules, id]
      : enabledModules.filter((module) => module !== id)

    const previous = enabledModules
    setEnabledModules(wanted) // optimistic

    try {
      const response = await apiFetch('/api/settings/editor', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ surface: 'NOVEL', modules: wanted }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      // The server normalises (locked modules forced on, unknown ids dropped),
      // so take its answer rather than assuming ours was valid.
      const body = (await response.json()) as { modules: EditorModuleId[] }
      setEnabledModules(body.modules)
    } catch (error) {
      setEnabledModules(previous)
      toast.error('模組設定未儲存', error instanceof Error ? error.message : undefined)
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

  /*
   * 全書 view. The open episode's chapters come from `chapters` rather than
   * from `toc`, so a title renamed a second ago is already right here — `toc`
   * was rendered on the server and does not know about it.
   */
  const bookToc = useMemo(() => {
    const term = filter.trim().toLowerCase()

    return toc
      .map((episode) =>
        episode.episodeId === episodeId
          ? {
              ...episode,
              chapters: chapters.map((c) => ({
                id: c.id,
                sortOrder: c.sortOrder,
                title: c.title,
                charCount: c.charCount,
              })),
              charCount: chapters.reduce((n, c) => n + c.charCount, 0),
            }
          : episode
      )
      .map((episode) => ({
        ...episode,
        chapters: term
          ? episode.chapters.filter(
              (c) =>
                c.title.toLowerCase().includes(term) ||
                String(episode.number).includes(term) ||
                episode.title.toLowerCase().includes(term)
            )
          : episode.chapters,
      }))
      .filter((episode) => episode.chapters.length > 0)
  }, [toc, chapters, episodeId, filter])

  const bookChars = bookToc.reduce((n, e) => n + e.charCount, 0)

  const documentChars = chapters.reduce((n, c) => n + c.charCount, 0)

  return (
    <div className="grid min-h-0 gap-4 p-3 sm:p-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:p-6 xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
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
              placeholder={scope === 'book' ? '搜尋全書章節' : '搜尋章節（標題或內容）'}
              aria-label="搜尋章節"
              className="h-8 w-full rounded-lg bg-stage-850 pr-2 pl-8 text-[11px] text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
          </div>

          {/*
            本集 / 全書. The rail used to be the open episode's chapters and
            nothing else, so a 120-episode novel had no table of contents
            anywhere — you could not reach a chapter you had already written
            without going back out to 集數管理.
          */}
          <div
            role="tablist"
            aria-label="章節目錄範圍"
            className="flex rounded-lg bg-stage-850 p-0.5 ring-1 ring-stage-700"
          >
            {(
              [
                ['episode', '本集'],
                ['book', '全書'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={scope === key}
                onClick={() => setScope(key)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1 text-[11px] transition-colors',
                  scope === key
                    ? 'bg-stage-700 font-medium text-ink-50'
                    : 'text-ink-500 hover:text-ink-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/*
            Export and copy sit with the chapter index rather than in the
            editor pane: they act on the whole book, and the pane acts on one
            chapter. `toc` already carries what has prose in it.
          */}
          <NovelExportMenu
            projectId={projectId}
            episodes={toc
              .filter((episode) => episode.charCount > 0)
              .map((episode) => ({
                episodeId: episode.episodeId,
                number: episode.number,
                title: episode.title,
                charCount: episode.charCount,
              }))}
          />
        </div>

        {scope === 'book' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <ul className="min-h-0 flex-1 overflow-y-auto p-2">
              {bookToc.length === 0 ? (
                <li className="px-2 py-6 text-center text-[11px] text-ink-600">
                  {filter.trim() ? '沒有符合的章節' : '全書還沒有章節'}
                </li>
              ) : (
                bookToc.map((episode) => (
                  <li key={episode.episodeId} className="mb-1">
                    <p className="flex items-baseline gap-1.5 px-2.5 pt-2 pb-1 text-[10px] text-ink-600">
                      <span className="tabular-nums">
                        EP{String(episode.number).padStart(3, '0')}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{episode.title}</span>
                      {episode.charCount > 0 && (
                        <span className="shrink-0 tabular-nums">
                          {episode.charCount.toLocaleString('en-US')}
                        </span>
                      )}
                    </p>

                    <ul>
                      {episode.chapters.map((chapter) => {
                        const here = episode.episodeId === episodeId
                        const current = here && chapter.id === activeId

                        const inner = (
                          <>
                            <span className="w-6 shrink-0 text-[10px] text-ink-600 tabular-nums">
                              {String(chapter.sortOrder).padStart(2, '0')}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {chapter.title || <span className="text-ink-600">未命名</span>}
                            </span>
                            {chapter.charCount > 0 && (
                              <Check aria-hidden className="size-3 shrink-0 text-emerald-400" />
                            )}
                          </>
                        )

                        const className = cn(
                          'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                          current
                            ? 'bg-accent-600/20 text-ink-50 ring-1 ring-inset ring-accent-500/40'
                            : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
                        )

                        /*
                          A chapter in this episode switches in place; one in
                          another episode is a navigation, because the editor
                          holds a single episode's document and its lock
                          revision. `?chapter=` lands on the right chapter
                          rather than on whichever is first.
                        */
                        return (
                          <li key={chapter.id}>
                            {here ? (
                              <button
                                type="button"
                                onClick={() => setActiveId(chapter.id)}
                                className={className}
                              >
                                {inner}
                              </button>
                            ) : (
                              <Link
                                href={`/projects/${projectId}/episodes/${episode.episodeId}/novel?chapter=${chapter.id}`}
                                className={className}
                              >
                                {inner}
                              </Link>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))
              )}
            </ul>

            <p className="border-t border-stage-700/60 px-3 py-2 text-[10px] text-ink-600">
              全書 {bookToc.length} 集・{bookChars.toLocaleString('en-US')} 字
            </p>
          </div>
        ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <li className="px-2 py-6 text-center text-[11px] text-ink-600">
              {chapters.length === 0 ? '還沒有章節' : '沒有符合的章節'}
            </li>
          ) : (
            visible.map((chapter) => (
              <li key={chapter.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setActiveId(chapter.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-left text-xs transition-colors',
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

                {/*
                  Revealed on hover or keyboard focus rather than always
                  shown: this is a list you click through all day, and a
                  delete button permanently parked next to every title is
                  one slip away from losing a chapter.
                */}
                <button
                  type="button"
                  onClick={() => setConfirming(chapter.id)}
                  disabled={deleting !== null}
                  aria-label={`刪除 ${chapter.title || '未命名'}`}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-ink-700 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-0"
                >
                  <Trash2 aria-hidden className="size-3" />
                </button>

                {confirming === chapter.id && (
                  <div className="mt-1 mb-1.5 flex items-center gap-1.5 rounded-lg bg-rose-500/10 px-2 py-1.5 ring-1 ring-rose-500/30">
                    <span className="min-w-0 flex-1 text-[10px] leading-tight text-rose-200">
                      刪掉這一章？內容會先存進版本紀錄，還原得回來。
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeChapter(chapter.id)}
                      disabled={deleting !== null}
                      className="inline-flex shrink-0 items-center gap-1 rounded bg-rose-500 px-1.5 py-1 text-[10px] font-medium text-white disabled:opacity-60"
                    >
                      {deleting === chapter.id && (
                        <Loader2 aria-hidden className="size-2.5 animate-spin" />
                      )}
                      刪
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="shrink-0 rounded px-1.5 py-1 text-[10px] text-ink-400 hover:text-ink-100"
                    >
                      不要
                    </button>
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
        )}
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
          enabledModules={enabledModules}
          onToggleModule={toggleModule}
          onDirty={() => setState('dirty')}
          onEditorReady={holdEditor}
          onSave={(content, title) => save(active.id, content, title)}
          onKeepVersion={keepVersion}
          onAiAction={(task, text) => {
            const nonce = Date.now()
            setAiScope({ text, nonce })
            setAiRequest({ task, nonce })
          }}
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
      <aside className="hidden min-w-0 flex-col gap-4 xl:flex">
        <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <Sparkles aria-hidden className="size-3.5 text-accent-400" />
            <h3 className="flex-1 text-xs font-medium text-ink-200">AI 創作助手</h3>
          </header>
          <div className="p-4">
            <AiAssistant
              /* A new selection action is a new run: remount rather than
                 sync a prop into state. */
              key={aiRequest?.nonce ?? 'whole-chapter'}
              {...(aiRequest ? { initialTask: aiRequest.task } : {})}
              projectId={projectId}
              episodeId={episodeId}
              /* The AI works on the chapter in front of the reader, not the
                 whole episode — a 4,000-character continuation prompt that
                 includes nine other chapters mostly pays for context. */
              sourceText={aiScope?.text ?? active?.content ?? ''}
              currency={currency}
              fx={fx}
              providerReady={providerReady}
              providerDetail={providerDetail}
              {...(aiScope
                ? {
                    scopeLabel: `只處理你選取的 ${aiScope.text.length} 字，不是整章。採用時仍會與整章比對。`,
                  }
                : {})}
              onAdopted={() => {
                setAiScope(null)
                setAiRequest(null)
                router.refresh()
              }}
              /*
               * 插入或覆蓋，由人決定 (Z122)。
               *
               * Insertion goes through the live editor so the cursor, the
               * selection and the undo stack all survive. Replacing goes to
               * the server, which snapshots the document before writing —
               * destroying a chapter is not something undo should be the
               * only way back from.
               */
              onAdopt={async (content, mode) => {
                if (!active) return

                if (mode === 'insert') {
                  const editor = editorRef.current
                  if (!editor) throw new Error('編輯器還沒準備好')
                  editor.chain().focus().insertContent(content).run()
                  setState('dirty')
                  return
                }

                const response = await apiFetch(
                  `/api/projects/${projectId}/chapters/${active.id}/replace`,
                  {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      content,
                      expectedRevision: revision,
                      label: 'AI 產出覆蓋',
                    }),
                  }
                )
                if (!response.ok) throw new Error(await readApiError(response))

                const body = (await response.json()) as {
                  backupVersion: number
                  lockRevision: number
                }
                setRevision(body.lockRevision)
                setChapters((prev) =>
                  prev.map((c) => (c.id === active.id ? { ...c, content } : c))
                )
                toast.success(
                  '已覆蓋這一章',
                  `原本的內容已存成版本 v${body.backupVersion}，可以從版本紀錄還原`
                )
              }}
              tasks={[
                {
                  kind: 'NOVEL_CONTINUE',
                  label: '續寫',
                  hint: '接著目前的章節往下寫，不重寫既有段落。',
                },
                {
                  kind: 'NOVEL_POLISH',
                  label: '潤稿',
                  hint: '修語病、統一用詞、加強畫面感；不動劇情事實。',
                },
                {
                  kind: 'NOVEL_REWRITE',
                  label: '改寫',
                  hint: '保留事件，換一種寫法。建議在補充指示說明方向。',
                },
                {
                  kind: 'NOVEL_REVIEW',
                  label: '審稿',
                  hint: '逐條指出節奏、動機與世界觀矛盾，只報告不改寫。',
                },
              ]}
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
  enabledModules,
  onToggleModule,
  onDirty,
  onEditorReady,
  onSave,
  onKeepVersion,
  onAiAction,
}: {
  chapter: ChapterData
  state: SaveState
  savedAt: string | null
  targetChars: number
  documentChars: number
  enabledModules: EditorModuleId[]
  onToggleModule: (id: EditorModuleId, next: boolean) => void
  onDirty: () => void
  /** The live editor, so the AI panel can insert at the cursor (Z122). */
  onEditorReady?: (editor: import('@tiptap/react').Editor | null) => void
  onSave: (content: string, title: string) => void | Promise<void>
  onKeepVersion: () => void | Promise<void>
  onAiAction: (task: AiSelectionAction, selectedText: string) => void
}) {
  const [content, setContent] = useState(chapter.content)
  const [title, setTitle] = useState(chapter.title)

  /*
   * 「字數」不是一個數字 (Z123)。
   *
   * 標點在這部戲的對白裡佔了兩成——「不夠。」五個字元裡有兩個是標點。
   * 只印一個數字，等於讓每個人自己猜目標是用哪一種算的。
   */
  const counts = countText(content)

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
          /*
            Real height, not a `.tap` pseudo-element: an input cannot carry
            one. At 20px this was under the 24px WCAG floor and awkward to
            hit on a phone; the negative margin keeps the header the same
            height as before.
          */
          className="-my-1 min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold text-ink-50 placeholder:text-ink-600 focus:outline-none"
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

      <RichTextEditor
        surface="NOVEL"
        enabledModules={enabledModules}
        initialContent={chapter.content}
        placeholder="在這裡寫。"
        onChange={(html) => {
          setContent(html)
          onDirty()
        }}
        onToggleModule={onToggleModule}
        onAiAction={onAiAction}
        onReady={onEditorReady}
      />

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stage-700/60 px-4 py-2.5 text-[11px] text-ink-500">
        <span className="tabular-nums" title="不含空白，含標點——目標與進度用的就是這個">
          字數：<span className="text-ink-200">{counts.withPunctuation.toLocaleString('en-US')}</span>
          <span className="text-ink-700">／目標 {targetChars.toLocaleString('en-US')}</span>
        </span>

        {/* 其餘三種並列，免得「字數」這個詞各自表述。 */}
        <span className="tabular-nums text-ink-600" title="不含標點也不含空白：真正寫出來的字">
          純文字 {counts.letters.toLocaleString('en-US')}
        </span>
        <span className="tabular-nums text-ink-600" title="標點與符號">
          標點 {counts.punctuation.toLocaleString('en-US')}
        </span>
        <span
          className="tabular-nums text-ink-600"
          title="全部字元，含標點也含空白與換行"
        >
          全部 {counts.all.toLocaleString('en-US')}
          <span className="text-ink-700">（空白 {counts.spaces.toLocaleString('en-US')}）</span>
        </span>
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
