'use client'

import { Clapperboard, History, Plus, Save, Search, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { countHtmlChars } from '@/components/editor/extensions'
import { RichTextEditor } from '@/components/editor/RichTextEditor'
import type { AiSelectionAction } from '@/components/editor/AiSelectionMenu'
import { AiAssistant } from '@/components/studio/AiAssistant'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import type { AiJobKindValue } from '@/lib/constants'
import type { EditorModuleId } from '@/lib/editor/modules'
import type { CurrencyValue, FxRates } from '@/lib/money'
import { cn, formatDurationZh, judgeDuration } from '@/lib/utils'

/**
 * 劇本編輯器 (design 07).
 *
 * A script is a list of scenes, each with its own heading, location and time —
 * unlike a novel, where a chapter is just prose. That shape is what the
 * storyboard reads later, so the editor keeps it rather than flattening the
 * whole episode into one document and parsing it back out.
 *
 * Saving carries the same optimistic lock as the novel editor; the runtime
 * estimate is recomputed on the server, because it decides whether an episode
 * fits its 120–180 second target and a client-supplied figure could be wished
 * into range.
 */

export type SceneData = {
  id: string
  sortOrder: number
  code: string
  heading: string
  location: string
  timeOfDay: string
  content: string
  estimatedSec: number
  updatedAt: string
}

export type ScriptEditorProps = {
  projectId: string
  documentId: string
  episodeId: string
  episodeNumber: number
  episodeTitle: string
  initialScenes: SceneData[]
  /** From `?scene=` — which scene a search result wants opened. */
  initialSceneId?: string | null
  /** Which episodes have a novel to adapt from (Z113). */
  novelSources?: { id: string; number: number; title: string; charCount: number }[]
  initialRevision: number
  lastEditorName: string | null
  /** The project's per-episode runtime window, in seconds. */
  targetMinSec: number
  targetMaxSec: number
  modules: EditorModuleId[]
  currency: CurrencyValue
  fx: FxRates
  providerReady: boolean
  providerDetail?: string
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

const AUTOSAVE_DELAY_MS = 2500

export function ScriptEditor({
  projectId,
  documentId,
  episodeId,
  episodeNumber,
  episodeTitle,
  initialScenes,
  initialSceneId,
  novelSources = [],
  initialRevision,
  lastEditorName,
  targetMinSec,
  targetMaxSec,
  modules,
  currency,
  fx,
  providerReady,
  providerDetail,
}: ScriptEditorProps) {
  const toast = useToast()
  const router = useRouter()

  const [scenes, setScenes] = useState(initialScenes)
  /* `?scene=<id>` from a search result; see NovelEditor for the reasoning. */
  /*
   * What the AI panel works on. Null means the whole scene; a selection from
   * the editor's floating menu narrows it. See NovelEditor for the reasoning.
   */
  const [aiScope, setAiScope] = useState<{ text: string; nonce: number } | null>(null)
  const [aiRequest, setAiRequest] = useState<{ task: AiJobKindValue; nonce: number } | null>(
    null
  )

  const [activeId, setActiveId] = useState(
    (initialSceneId && initialScenes.some((s) => s.id === initialSceneId)
      ? initialSceneId
      : initialScenes[0]?.id) ?? null
  )
  const [revision, setRevision] = useState(initialRevision)
  const [state, setState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [enabledModules, setEnabledModules] = useState(modules)

  const active = scenes.find((s) => s.id === activeId) ?? null

  const totalSeconds = scenes.reduce((n, s) => n + s.estimatedSec, 0)
  const totalChars = scenes.reduce((n, s) => n + countHtmlChars(s.content), 0)
  const duration = judgeDuration(totalSeconds, targetMinSec, targetMaxSec)

  const save = useCallback(
    async (sceneId: string, content: string, heading: string) => {
      setState('saving')
      try {
        const response = await apiFetch(`/api/projects/${projectId}/scenes/${sceneId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content, heading, expectedRevision: revision }),
        })

        if (response.status === 409) {
          setState('conflict')
          toast.error('無法儲存', await readApiError(response))
          return
        }
        if (!response.ok) throw new Error(await readApiError(response))

        const body = (await response.json()) as {
          scene: SceneData
          lockRevision: number
          savedAt: string
        }

        setRevision(body.lockRevision)
        setSavedAt(body.savedAt)
        setScenes((prev) => prev.map((s) => (s.id === sceneId ? body.scene : s)))
        setState('saved')
      } catch (error) {
        setState('error')
        toast.error('儲存失敗', error instanceof Error ? error.message : undefined)
      }
    },
    [projectId, revision, toast]
  )

  useEffect(() => {
    if (state !== 'dirty' && state !== 'saving') return

    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [state])

  async function addScene() {
    if (creating) return
    setCreating(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/documents/${documentId}/scenes`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ heading: '' }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { scene: SceneData; lockRevision: number }
      setScenes((prev) => [...prev, body.scene])
      setActiveId(body.scene.id)
      setRevision(body.lockRevision)
    } catch (error) {
      toast.error('新增場次失敗', error instanceof Error ? error.message : undefined)
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
          body: JSON.stringify({ label: `EP${String(episodeNumber).padStart(3, '0')} 劇本存檔` }),
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
    const wanted = next ? [...enabledModules, id] : enabledModules.filter((m) => m !== id)
    const previous = enabledModules
    setEnabledModules(wanted)

    try {
      const response = await apiFetch('/api/settings/editor', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ surface: 'SCRIPT', modules: wanted }),
      })
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { modules: EditorModuleId[] }
      setEnabledModules(body.modules)
    } catch (error) {
      setEnabledModules(previous)
      toast.error('模組設定未儲存', error instanceof Error ? error.message : undefined)
    }
  }

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return scenes
    return scenes.filter(
      (s) =>
        s.code.toLowerCase().includes(term) ||
        s.heading.toLowerCase().includes(term) ||
        s.location.toLowerCase().includes(term) ||
        s.content.toLowerCase().includes(term)
    )
  }, [scenes, filter])

  return (
    <div className="grid min-h-0 gap-4 p-3 sm:p-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:p-6 xl:grid-cols-[15rem_minmax(0,1fr)_18rem]">
      {/* ---- scene rail --------------------------------------------------- */}
      <aside className="panel flex min-h-0 flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
        <div className="flex flex-col gap-2 border-b border-stage-700/60 p-3">
          <button
            type="button"
            onClick={() => void addScene()}
            disabled={creating}
            className="bg-brand-gradient glow-accent-sm inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Plus aria-hidden className="size-3.5" />
            {creating ? '新增中…' : '新增場次'}
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
              placeholder="搜尋場次（例：S03 或 宮城）"
              aria-label="搜尋場次"
              className="h-8 w-full rounded-lg bg-stage-850 pr-2 pl-8 text-[11px] text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
            />
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <li className="px-2 py-6 text-center text-[11px] text-ink-600">
              {scenes.length === 0 ? '還沒有場次' : '沒有符合的場次'}
            </li>
          ) : (
            visible.map((scene) => (
              <li key={scene.id}>
                <button
                  type="button"
                  onClick={() => setActiveId(scene.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    scene.id === activeId
                      ? 'bg-accent-600/20 text-ink-50 ring-1 ring-inset ring-accent-500/40'
                      : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] font-medium tabular-nums">{scene.code}</span>
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {scene.heading || <span className="text-ink-600">未命名場次</span>}
                    </span>
                  </span>
                  <span className="text-[10px] text-ink-600 tabular-nums">
                    {scene.estimatedSec > 0 ? `約 ${scene.estimatedSec} 秒` : '尚未估算'}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </aside>

      {/* ---- editor -------------------------------------------------------- */}
      {active ? (
        <ScenePane
          key={active.id}
          scene={active}
          state={state}
          savedAt={savedAt}
          totalChars={totalChars}
          totalSeconds={totalSeconds}
          durationVerdict={duration.verdict}
          targetMinSec={targetMinSec}
          targetMaxSec={targetMaxSec}
          enabledModules={enabledModules}
          onToggleModule={toggleModule}
          onDirty={() => setState('dirty')}
          onSave={(content, heading) => save(active.id, content, heading)}
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
            title="還沒有場次"
            description="先新增一個場次。角色名、對白、動作與轉場各有專用樣式與快速鍵。"
            icon={<Clapperboard aria-hidden className="size-5 text-ink-500" />}
            className="py-20"
          />
        </section>
      )}

      {/* ---- side panels ---------------------------------------------------- */}
      <aside className="hidden min-w-0 flex-col gap-4 xl:flex">
        <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <Sparkles aria-hidden className="size-3.5 text-accent-400" />
            <h3 className="flex-1 text-xs font-medium text-ink-200">AI 劇本助手</h3>
          </header>
          <div className="p-4">
            <AiAssistant
              /* A new selection action is a new run: remount rather than
                 sync a prop into state. */
              key={aiRequest?.nonce ?? 'whole-scene'}
              {...(aiRequest ? { initialTask: aiRequest.task } : {})}
              projectId={projectId}
              episodeId={episodeId}
              sourceText={aiScope?.text ?? active?.content ?? ''}
              /*
               * 依小說生成劇本 reads the novel, not the scene being edited.
               * Everything else on this surface works on the scene.
               */
              novelSources={novelSources}
              currency={currency}
              fx={fx}
              providerReady={providerReady}
              providerDetail={providerDetail}
              {...(aiScope
                ? {
                    scopeLabel: `只處理你選取的 ${aiScope.text.length} 字，不是整場。採用時仍會與整場比對。`,
                  }
                : {})}
              onAdopted={() => {
                setAiScope(null)
                setAiRequest(null)
                router.refresh()
              }}
              tasks={[
                {
                  kind: 'NOVEL_TO_SCRIPT',
                  label: '依小說生成劇本',
                  hint: '把本集小說改編成場次、動作與對白；不改動原著劇情。',
                },
                {
                  kind: 'SCRIPT_ANALYZE',
                  label: '劇本分析',
                  hint: '估算片長（含動作與停頓）、指出對白過長與可刪減處。',
                },
              ]}
            />
          </div>
        </section>

        <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <Clapperboard aria-hidden className="size-3.5 text-accent-400" />
            <h3 className="flex-1 text-xs font-medium text-ink-200">
              本集資訊（EP{String(episodeNumber).padStart(3, '0')}）
            </h3>
          </header>
          <dl className="flex flex-col gap-2 p-4 text-[11px]">
            <Row label="標題">{episodeTitle || '未命名'}</Row>
            <Row label="場次數">{scenes.length}</Row>
            <Row label="劇本字數">{totalChars.toLocaleString('en-US')}</Row>
            <Row label="預估片長">
              <span
                className={cn(
                  duration.verdict === 'ok'
                    ? 'text-emerald-300'
                    : duration.verdict === 'over'
                      ? 'text-rose-300'
                      : 'text-amber-300'
                )}
              >
                {formatDurationZh(totalSeconds)}
              </span>
            </Row>
            <Row label="目標區間">
              {targetMinSec}–{targetMaxSec} 秒
            </Row>
            <Row label="最後編輯">{lastEditorName ?? '—'}</Row>
            <Row label="文件版本">r{revision}</Row>
          </dl>
          {duration.verdict !== 'ok' && totalSeconds > 0 && (
            <p className="px-4 pb-4 text-[10px] leading-relaxed text-ink-500">
              {duration.verdict === 'over'
                ? `超出上限 ${Math.abs(duration.deltaSec)} 秒，建議精簡對白或合併場次。`
                : `距離下限還差 ${Math.abs(duration.deltaSec)} 秒。`}
              估算只用來預警，實際片長以剪輯為準。
            </p>
          )}
        </section>

        <Link
          href={`/projects/${projectId}/episodes/${episodeId}/novel`}
          className="text-center text-[11px] text-ink-600 transition-colors hover:text-ink-300"
        >
          回到本集小說
        </Link>
      </aside>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

/** One scene's buffer. Keyed by scene id, so switching remounts it. */
function ScenePane({
  scene,
  state,
  savedAt,
  totalChars,
  totalSeconds,
  durationVerdict,
  targetMinSec,
  targetMaxSec,
  enabledModules,
  onToggleModule,
  onDirty,
  onSave,
  onKeepVersion,
  onAiAction,
}: {
  scene: SceneData
  state: SaveState
  savedAt: string | null
  totalChars: number
  totalSeconds: number
  durationVerdict: 'under' | 'ok' | 'over'
  targetMinSec: number
  targetMaxSec: number
  enabledModules: EditorModuleId[]
  onToggleModule: (id: EditorModuleId, next: boolean) => void
  onDirty: () => void
  onSave: (content: string, heading: string) => void | Promise<void>
  onKeepVersion: () => void | Promise<void>
  onAiAction: (task: AiSelectionAction, selectedText: string) => void
}) {
  const [content, setContent] = useState(scene.content)
  const [heading, setHeading] = useState(scene.heading)

  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (state !== 'dirty') return

    timer.current = window.setTimeout(() => {
      void onSave(content, heading)
    }, AUTOSAVE_DELAY_MS)

    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [state, content, heading, onSave])

  return (
    <section className="panel flex min-h-0 min-w-0 flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
      <header className="flex flex-wrap items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
        <span className="shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[11px] font-medium text-ink-200 ring-1 ring-inset ring-stage-700 tabular-nums">
          {scene.code}
        </span>

        <input
          value={heading}
          onChange={(event) => {
            setHeading(event.target.value)
            onDirty()
          }}
          placeholder="場次標題（例：宮城・夜・外）"
          aria-label="場次標題"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-ink-50 placeholder:text-ink-600 focus:outline-none"
        />

        <SaveBadge state={state} savedAt={savedAt} />

        <button
          type="button"
          onClick={() => void onSave(content, heading)}
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
        surface="SCRIPT"
        enabledModules={enabledModules}
        initialContent={scene.content}
        placeholder="動作、對白與轉場。Alt+1 到 Alt+5 可切換段落類型。"
        onChange={(html) => {
          setContent(html)
          onDirty()
        }}
        onToggleModule={onToggleModule}
        onAiAction={onAiAction}
      />

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stage-700/60 px-4 py-2.5 text-[11px] text-ink-500">
        <span className="tabular-nums">
          本場約 <span className="text-ink-200">{scene.estimatedSec}</span> 秒
        </span>
        <span className="tabular-nums">本集字數：{totalChars.toLocaleString('en-US')}</span>
        <span
          className={cn(
            'tabular-nums',
            durationVerdict === 'ok'
              ? 'text-emerald-300'
              : durationVerdict === 'over'
                ? 'text-rose-300'
                : 'text-amber-300'
          )}
        >
          本集預估 {formatDurationZh(totalSeconds)}（目標 {targetMinSec}–{targetMaxSec} 秒）
        </span>
        <span className="ml-auto">自動儲存：已開啟（停筆 {AUTOSAVE_DELAY_MS / 1000} 秒後）</span>
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
