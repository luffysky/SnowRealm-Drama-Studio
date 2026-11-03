'use client'

import {
  BookOpen,
  Clapperboard,
  Film,
  Loader2,
  PenLine,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { isProjectId } from '@/lib/project-id'
import {
  MATCHED_BY_LABEL,
  SEARCH_KIND_LABEL,
  SEARCH_KINDS,
  type IndexStatus,
  type SearchHit,
  type SearchKind,
  type SearchResult,
} from '@/lib/search/view'
import { cn } from '@/lib/utils'

/**
 * Global search — RAG semantic retrieval (`docs/SEARCH.md`).
 *
 * Two signals, one box. The server runs a trigram match and a cosine match
 * over Voyage embeddings and merges them, so a description of a scene finds it
 * even when none of those words appear in the text. The footer states which
 * mode produced the list: with no embedding key configured this degrades to
 * keyword-only, and saying so is better than quietly returning less.
 *
 * Scope follows the URL. Inside a project workspace it searches that project
 * first — almost always what is meant — with one click to widen to every
 * project.
 */

const KIND_ICON: Record<SearchKind, LucideIcon> = {
  PROJECT: Clapperboard,
  EPISODE: Film,
  CHAPTER: BookOpen,
  SCENE: PenLine,
  WORLD_ENTRY: Sparkles,
  WORLD_EVENT: Sparkles,
  CHARACTER: Users,
}

/** Long enough that typing a phrase is one request, short enough to feel live. */
const DEBOUNCE_MS = 260

export function CommandPalette() {
  const [open, setOpen] = useState(false)

  // Cmd+K on macOS, Ctrl+K elsewhere. Bound while closed too: that is the point.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <Trigger onOpen={() => setOpen(true)} />
      {/* Remounted per opening, so each search starts clean. */}
      {open && <Palette onClose={() => setOpen(false)} />}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Trigger                                                                     */
/* -------------------------------------------------------------------------- */

function Trigger({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="hidden h-9 w-72 items-center gap-2 rounded-lg bg-stage-900/80 px-3 text-left text-xs text-ink-500 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-300 hover:ring-stage-600 md:flex xl:w-96"
      >
        <Search aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">搜尋作品、集數、小說、劇本、角色…</span>
        <Shortcut />
      </button>

      <button
        type="button"
        aria-label="搜尋"
        onClick={onOpen}
        className="rounded-lg p-2 text-ink-400 hover:bg-stage-800 hover:text-ink-100 md:hidden"
      >
        <Search aria-hidden className="size-4" />
      </button>
    </>
  )
}

/**
 * The shortcut hint.
 *
 * The right glyph depends on the platform, which the server cannot know.
 * `useSyncExternalStore` is the sanctioned way to read a client-only value:
 * the server snapshot renders first, the client swaps after hydration, and
 * neither a hydration mismatch nor a setState-in-effect is needed.
 */
function Shortcut() {
  const label = useSyncExternalStore(subscribeNever, readShortcut, () => 'Ctrl K')

  return (
    <kbd className="shrink-0 rounded bg-stage-800 px-1.5 py-0.5 font-sans text-[10px] text-ink-600 ring-1 ring-inset ring-stage-700">
      {label}
    </kbd>
  )
}

/** The platform never changes mid-session, so there is nothing to subscribe to. */
function subscribeNever() {
  return () => {}
}

function readShortcut(): string {
  return /mac|iphone|ipad/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'
}

/* -------------------------------------------------------------------------- */
/* Palette                                                                     */
/* -------------------------------------------------------------------------- */

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const pathname = usePathname()

  /** The project in the URL, when the member is inside a workspace. */
  const currentProjectId = useMemo(() => {
    const match = /^\/projects\/([^/]+)/.exec(pathname)
    const id = match?.[1]
    return id && isProjectId(id) ? id : null
  }, [pathname])

  const [query, setQuery] = useState('')
  const [scopeProject, setScopeProject] = useState(Boolean(currentProjectId))
  const [kinds, setKinds] = useState<SearchKind[]>([])
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // The page behind must not scroll while this is over it.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const scopedTo = scopeProject ? currentProjectId : null

  /*
   * Debounced fetch.
   *
   * Nothing is set synchronously here: `react-hooks/set-state-in-effect`
   * rightly objects, and the spinner belongs to the moment the request
   * actually starts rather than the keystroke. A cleared box is handled by
   * rendering, not by clearing state — the empty branch is checked first, so
   * stale results can never be shown.
   */
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) return

    const controller = new AbortController()

    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true)
        const params = new URLSearchParams({ q: trimmed, limit: '20' })
        for (const kind of kinds) params.append('kind', kind)

        const url = scopedTo
          ? `/api/projects/${scopedTo}/search?${params.toString()}`
          : `/api/search?${params.toString()}`

        try {
          const response = await fetch(url, { signal: controller.signal })
          if (!response.ok) throw new Error(await readApiError(response))
          setResult((await response.json()) as SearchResult)
          setError(null)
          setCursor(0)
        } catch (cause) {
          if (controller.signal.aborted) return
          setError(cause instanceof Error ? cause.message : '搜尋失敗')
          setResult(null)
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, kinds, scopedTo])

  const hits = result?.hits ?? []

  const go = useCallback(
    (hit: SearchHit | undefined) => {
      if (!hit) return
      onClose()
      router.push(hit.href)
    },
    [onClose, router]
  )

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (hits.length === 0) return
      const next =
        event.key === 'ArrowDown'
          ? (cursor + 1) % hits.length
          : (cursor - 1 + hits.length) % hits.length
      setCursor(next)
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      go(hits[cursor])
    }
  }

  function toggleKind(kind: SearchKind) {
    setKinds((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind]
    )
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade-in items-start justify-center bg-stage-990/80 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="全域搜尋"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        className="panel mt-[6vh] flex max-h-[80vh] w-full max-w-2xl animate-rise flex-col overflow-hidden rounded-2xl bg-stage-900 shadow-2xl shadow-stage-990/80 ring-1 ring-stage-700"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-stage-700/70 px-3 py-2.5">
          {loading && query.trim() ? (
            <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-accent-400" />
          ) : (
            <Search aria-hidden className="size-4 shrink-0 text-ink-500" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="用一句話描述你要找的內容，不用猜關鍵字"
            aria-label="搜尋"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-50 placeholder:text-ink-600 focus:outline-none"
          />
          <button
            type="button"
            aria-label="關閉"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-ink-500 hover:bg-stage-800 hover:text-ink-100"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <Filters
          currentProjectId={currentProjectId}
          scopeProject={scopeProject}
          onScopeChange={setScopeProject}
          kinds={kinds}
          onToggleKind={toggleKind}
        />

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <Empty title="搜尋失敗" detail={error} />
          ) : !query.trim() ? (
            <Empty
              title="輸入問題或片段"
              detail="語意檢索比對的是意思，不只是字面。描述一個情境，也找得到沒出現這些字的段落。"
            />
          ) : hits.length === 0 && !loading ? (
            <Empty
              title="沒有符合的內容"
              detail={
                result && !result.semantic
                  ? '目前只做關鍵字比對（尚未設定 VOYAGE_API_KEY），換個用詞可能有幫助。'
                  : '試著換個說法，或放寬上方的類型篩選。'
              }
            />
          ) : (
            <ul ref={listRef} role="listbox" aria-label="搜尋結果" className="p-1.5">
              {hits.map((hit, index) => (
                <li key={hit.id}>
                  <Hit
                    hit={hit}
                    active={index === cursor}
                    showProject={!scopedTo}
                    onHover={() => setCursor(index)}
                    onSelect={() => go(hit)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Keyed: switching scope remounts rather than clearing state in an
            effect, which `react-hooks/set-state-in-effect` forbids. */}
        <Footer
          key={scopedTo ?? 'all'}
          semantic={result?.semantic ?? null}
          semanticError={result?.semanticError ?? null}
          total={result?.total ?? 0}
          projectId={scopedTo}
        />
      </div>
    </div>
  )
}

function Filters({
  currentProjectId,
  scopeProject,
  onScopeChange,
  kinds,
  onToggleKind,
}: {
  currentProjectId: string | null
  scopeProject: boolean
  onScopeChange: (value: boolean) => void
  kinds: SearchKind[]
  onToggleKind: (kind: SearchKind) => void
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-stage-700/70 px-3 py-2">
      {currentProjectId && (
        <>
          <Chip active={scopeProject} onClick={() => onScopeChange(true)}>
            本作品
          </Chip>
          <Chip active={!scopeProject} onClick={() => onScopeChange(false)}>
            全部作品
          </Chip>
          <span aria-hidden className="mx-1 h-4 w-px bg-stage-700" />
        </>
      )}

      {SEARCH_KINDS.map((kind) => (
        <Chip key={kind} active={kinds.includes(kind)} onClick={() => onToggleKind(kind)}>
          {SEARCH_KIND_LABEL[kind]}
        </Chip>
      ))}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
          : 'text-ink-500 ring-1 ring-inset ring-stage-700 hover:bg-stage-800 hover:text-ink-200'
      )}
    >
      {children}
    </button>
  )
}

function Hit({
  hit,
  active,
  showProject,
  onHover,
  onSelect,
}: {
  hit: SearchHit
  active: boolean
  showProject: boolean
  onHover: () => void
  onSelect: () => void
}) {
  const Icon = KIND_ICON[hit.kind]

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
        active ? 'bg-stage-800' : 'hover:bg-stage-800/60'
      )}
    >
      <Icon
        aria-hidden
        className={cn('mt-0.5 size-4 shrink-0', active ? 'text-accent-400' : 'text-ink-600')}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-xs font-medium text-ink-50">{hit.title}</span>
          <span className="shrink-0 rounded bg-stage-850 px-1.5 py-0.5 text-[10px] text-ink-500 ring-1 ring-inset ring-stage-700">
            {SEARCH_KIND_LABEL[hit.kind]}
          </span>
          {showProject && (
            <span className="min-w-0 shrink truncate text-[10px] text-ink-600">
              {hit.projectTitle}
            </span>
          )}
        </span>
        {hit.snippet && (
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-ink-500">
            {hit.snippet}
          </span>
        )}
      </span>
      <span className="mt-0.5 shrink-0 text-[10px] text-ink-700">
        {MATCHED_BY_LABEL[hit.matchedBy]}
      </span>
    </button>
  )
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-xs font-medium text-ink-300">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[11px] leading-relaxed text-ink-600">{detail}</p>
    </div>
  )
}

/**
 * Footer: the retrieval mode, and a reindex when one project is in scope.
 *
 * The reindex button lives here because this is where a stale index gets
 * noticed. It is cheap to re-run — unchanged chunks keep their embedding — so
 * it is safe to offer without a confirmation step.
 */
function Footer({
  semantic,
  semanticError,
  total,
  projectId,
}: {
  semantic: boolean | null
  /** Set when a key exists but the call failed — throttled, rejected, down. */
  semanticError: string | null
  total: number
  projectId: string | null
}) {
  const toast = useToast()
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [busy, setBusy] = useState(false)

  /** What the last search reported, falling back to what the index says. */
  const mode = semantic ?? status?.semantic ?? null

  useEffect(() => {
    if (!projectId) return

    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/search/reindex`, {
          signal: controller.signal,
        })
        if (response.ok) setStatus((await response.json()) as IndexStatus)
      } catch {
        // A missing status line is not worth an error message.
      }
    })()
    return () => controller.abort()
  }, [projectId])

  async function reindex() {
    if (!projectId || busy) return
    setBusy(true)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/search/reindex`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(await readApiError(response))
      const body = (await response.json()) as {
        indexed: number
        embedded: number
        skipped: number
        error: string | null
      }

      if (body.error) {
        // The keyword index is built; the vectors are not. Saying "done"
        // would leave the reader wondering why semantic search still misses.
        toast.warning(
          '索引已建立，但向量沒算完',
          `${body.indexed} 段內容已進索引，關鍵字搜尋可用。${body.error}`
        )
      } else {
        toast.success(
          '索引已更新',
          `${body.indexed} 段內容，其中 ${body.embedded} 段重新計算向量，${body.skipped} 段沿用舊的。`
        )
      }
      const fresh = await fetch(`/api/projects/${projectId}/search/reindex`)
      if (fresh.ok) setStatus((await fresh.json()) as IndexStatus)
    } catch (cause) {
      toast.error('索引更新失敗', cause instanceof Error ? cause.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-stage-700/70 bg-stage-900/80 px-3 py-2 text-[10px] text-ink-600">
      <span
        className={cn('flex items-center gap-1', semanticError && 'text-amber-400')}
        title={semanticError ?? undefined}
      >
        {semanticError ? (
          <TriangleAlert aria-hidden className="size-3" />
        ) : (
          <Sparkles aria-hidden className="size-3" />
        )}
        {/*
          Three different states, three different sentences. Reporting a
          throttled provider as "no key configured" sends the reader off to
          check an environment variable that is perfectly fine.
        */}
        {semanticError
          ? '語意檢索暫時不可用，以下只有關鍵字結果'
          : mode === null
            ? '語意檢索・輸入一句話或關鍵字'
            : mode
              ? '語意＋關鍵字混合檢索'
              : '僅關鍵字（尚未設定 VOYAGE_API_KEY）'}
      </span>

      {total > 0 && <span>共 {total} 筆來源</span>}

      <span className="hidden sm:inline">↑↓ 選擇・Enter 開啟・Esc 關閉</span>

      {projectId && (
        <div className="ml-auto flex items-center gap-2">
          {status && (
            <span className={cn(status.dirtySince && 'text-amber-400')}>
              {/*
                A stale index returns yesterday's results, which looks exactly
                like the text not existing. Saying so is the whole point of
                tracking it.
              */}
              {status.dirtySince
                ? '內容已變更，索引尚未更新'
                : `索引 ${status.rows} 段${status.rows > 0 ? `・已向量化 ${status.embedded} 段` : ''}`}
            </span>
          )}
          <button
            type="button"
            onClick={() => void reindex()}
            disabled={busy}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-500 transition-colors hover:bg-stage-800 hover:text-ink-200 disabled:opacity-50"
          >
            <RefreshCw aria-hidden className={cn('size-3', busy && 'animate-spin')} />
            {busy ? '重建中…' : '重建索引'}
          </button>
        </div>
      )}
    </div>
  )
}
