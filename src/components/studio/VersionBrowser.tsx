'use client'

import {
  ArrowLeftRight,
  Check,
  Download,
  FileText,
  GitBranch,
  History,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DiffViewer } from '@/components/ui/DiffViewer'
import { EmptyState } from '@/components/ui/StateViews'
import { useToast } from '@/components/ui/Toast'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { DOCUMENT_KIND_LABEL, type DocumentKindValue } from '@/lib/constants'
import { cn, formatRelativeZh } from '@/lib/utils'

/**
 * 版本紀錄 (design 08).
 *
 * Two versions are compared as text, not as HTML: a diff that reports a
 * changed class attribute as a changed sentence is worse than no diff. The
 * flattening happens on the server, where the snapshot lives.
 *
 * There is no delete. The design shows the button, but history here is
 * append-only by design — a version somebody else wrote is not one you get to
 * remove, and "restore" already covers wanting the old text back.
 */

export type VersionItem = {
  id: string
  documentId: string
  version: number
  label: string
  charCount: number
  charDelta: number
  authorName: string
  isApproved: boolean
  restoredFromVersionId: string | null
  aiJobId: string | null
  createdAt: string
  kind: DocumentKindValue
  episodeNumber: number
  episodeTitle: string
  /** Flattened text, for the diff. */
  text: string
}

export type VersionBrowserProps = {
  projectId: string
  versions: VersionItem[]
  stats: {
    total: number
    approved: number
    drafts: number
    restorePoints: number
    contributors: number
    lastUpdatedAt: string | null
  }
}

export function VersionBrowser({ projectId, versions, stats }: VersionBrowserProps) {
  const router = useRouter()
  const toast = useToast()

  const [kind, setKind] = useState<DocumentKindValue | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(versions[0]?.id ?? null)
  const [compareId, setCompareId] = useState<string | null>(versions[1]?.id ?? null)
  const [mode, setMode] = useState<'split' | 'unified'>('split')
  const [restoring, setRestoring] = useState<VersionItem | null>(null)
  const [busy, setBusy] = useState(false)

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return versions.filter((version) => {
      if (kind !== 'ALL' && version.kind !== kind) return false
      if (!term) return true
      return (
        version.label.toLowerCase().includes(term) ||
        version.authorName.toLowerCase().includes(term) ||
        `ep${String(version.episodeNumber).padStart(3, '0')}`.includes(term)
      )
    })
  }, [versions, kind, search])

  const selected = versions.find((v) => v.id === selectedId) ?? null
  const compare = versions.find((v) => v.id === compareId) ?? null

  /** Only versions of the same document can be meaningfully diffed. */
  const comparable = selected
    ? versions.filter((v) => v.documentId === selected.documentId && v.id !== selected.id)
    : []

  async function restore(version: VersionItem) {
    setBusy(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/versions/${version.id}/restore`,
        { method: 'POST' }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      const body = (await response.json()) as { version: number }
      toast.success('已還原', `已建立 v${body.version}，還原前的內容也保留為一個版本`)
      setRestoring(null)
      router.refresh()
    } catch (error) {
      toast.error('還原失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  if (versions.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="還沒有任何版本"
          description="在小說或劇本編輯器按「存成版本」之後，這裡會列出每一次存檔，可以比對與還原。"
          icon={<History aria-hidden className="size-5 text-ink-500" />}
          className="py-24"
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4 lg:p-6">
      {/* ---- stats ------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="總版本" value={stats.total} icon={<FileText className="size-3.5" />} />
        <Stat label="草稿" value={stats.drafts} icon={<FileText className="size-3.5" />} />
        <Stat label="定稿" value={stats.approved} icon={<Check className="size-3.5" />} />
        <Stat
          label="回溯點"
          value={stats.restorePoints}
          icon={<RotateCcw className="size-3.5" />}
        />
        <Stat
          label="參與編輯"
          value={stats.contributors}
          icon={<GitBranch className="size-3.5" />}
        />
      </div>

      {/* ---- filters ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-stage-900 p-0.5 ring-1 ring-stage-700">
          {(['ALL', 'NOVEL', 'SCRIPT'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              aria-pressed={kind === option}
              className={cn(
                'rounded-md px-2.5 py-1 text-[11px] transition-colors',
                kind === option
                  ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                  : 'text-ink-400 hover:bg-stage-800 hover:text-ink-100'
              )}
            >
              {option === 'ALL' ? '全部版本' : `${DOCUMENT_KIND_LABEL[option]}版本`}
            </button>
          ))}
        </div>

        <div className="relative w-full min-w-0 sm:w-64">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-600"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜尋版本備註、成員或 EP 編號"
            aria-label="搜尋版本"
            className="h-9 w-full rounded-lg bg-stage-900 pr-3 pl-9 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </div>

        <span
          aria-disabled="true"
          title="分支功能尚未實作，預計於 M4 階段交付"
          className="inline-flex h-9 cursor-default items-center gap-1.5 rounded-lg bg-stage-900 px-3 text-xs text-ink-500 ring-1 ring-inset ring-stage-700 select-none"
        >
          <GitBranch aria-hidden className="size-3.5" />
          新建分支
          <span className="rounded bg-stage-850 px-1 text-[10px] text-ink-600">M4</span>
        </span>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[18rem_minmax(0,1fr)_16rem]">
        {/* ---- timeline -------------------------------------------------- */}
        <section className="panel flex flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <History aria-hidden className="size-3.5 text-accent-400" />
            <h2 className="flex-1 text-xs font-medium text-ink-200">版本時間軸</h2>
            <span className="text-[10px] text-ink-600">{visible.length}</span>
          </header>

          <ul className="max-h-[32rem] overflow-y-auto p-2">
            {visible.length === 0 ? (
              <li className="px-2 py-8 text-center text-[11px] text-ink-600">沒有符合的版本</li>
            ) : (
              visible.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(version.id)
                      const sibling = versions.find(
                        (v) => v.documentId === version.documentId && v.id !== version.id
                      )
                      setCompareId(sibling?.id ?? null)
                    }}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors',
                      version.id === selectedId
                        ? 'bg-accent-600/20 ring-1 ring-inset ring-accent-500/40'
                        : 'hover:bg-stage-800'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-ink-100 tabular-nums">
                        v{version.version}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-ink-300">
                        {version.label || '未命名版本'}
                      </span>
                      {version.isApproved && (
                        <span className="shrink-0 rounded bg-gilt-400/15 px-1.5 py-0.5 text-[9px] text-gilt-300 ring-1 ring-inset ring-gilt-500/50">
                          定稿
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-ink-600">
                      <span className="tabular-nums">
                        EP{String(version.episodeNumber).padStart(3, '0')}
                      </span>
                      <span>{DOCUMENT_KIND_LABEL[version.kind]}</span>
                      <span>・{version.authorName || '—'}</span>
                      <span className="ml-auto">{formatRelativeZh(version.createdAt)}</span>
                    </div>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* ---- diff ------------------------------------------------------- */}
        <section className="panel flex min-w-0 flex-col rounded-xl bg-stage-900 ring-1 ring-stage-700">
          <header className="flex flex-wrap items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
            <ArrowLeftRight aria-hidden className="size-3.5 text-accent-400" />
            <h2 className="text-xs font-medium text-ink-200">版本比較</h2>

            <div className="ml-auto flex gap-1 rounded-lg bg-stage-850 p-0.5">
              {(['split', 'unified'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setMode(option)}
                  aria-pressed={mode === option}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] transition-colors',
                    mode === option ? 'bg-accent-600/25 text-ink-50' : 'text-ink-500'
                  )}
                >
                  {option === 'split' ? '並排檢視' : '逐段檢視'}
                </button>
              ))}
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-2 border-b border-stage-700/60 px-4 py-2">
            <label className="flex items-center gap-1.5 text-[11px] text-ink-500">
              舊版本
              <select
                value={compareId ?? ''}
                onChange={(event) => setCompareId(event.target.value || null)}
                className="h-7 max-w-40 rounded-md bg-stage-850 px-1.5 text-[11px] text-ink-100 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
              >
                <option value="">（空白）</option>
                {comparable.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.version} {version.label || '未命名'}
                  </option>
                ))}
              </select>
            </label>

            <span className="text-[11px] text-ink-600">→</span>

            <span className="text-[11px] text-ink-300">
              新版本 v{selected?.version ?? '—'}
            </span>

            {comparable.length === 0 && selected && (
              <span className="text-[10px] text-ink-600">
                這份文件只有一個版本，沒有可比較的對象
              </span>
            )}
          </div>

          <div className="min-w-0 p-4">
            {selected ? (
              <DiffViewer
                before={compare?.text ?? ''}
                after={selected.text}
                beforeLabel={compare ? `v${compare.version}` : '（空白）'}
                afterLabel={`v${selected.version}`}
                mode={mode}
              />
            ) : (
              <EmptyState title="選一個版本以檢視內容" className="py-12" />
            )}
          </div>
        </section>

        {/* ---- detail ------------------------------------------------------ */}
        <aside className="flex min-w-0 flex-col gap-4">
          <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
            <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
              <FileText aria-hidden className="size-3.5 text-accent-400" />
              <h2 className="flex-1 text-xs font-medium text-ink-200">版本詳情</h2>
            </header>

            {selected ? (
              <dl className="flex flex-col gap-2 p-4 text-[11px]">
                <Row label="版本">v{selected.version}</Row>
                <Row label="類型">{DOCUMENT_KIND_LABEL[selected.kind]}</Row>
                <Row label="集數">
                  EP{String(selected.episodeNumber).padStart(3, '0')}
                </Row>
                <Row label="建立者">{selected.authorName || '—'}</Row>
                <Row label="建立時間">{formatRelativeZh(selected.createdAt)}</Row>
                <Row label="字數">
                  {selected.charCount.toLocaleString('en-US')}
                  {selected.charDelta !== 0 && (
                    <span
                      className={cn(
                        'ml-1',
                        selected.charDelta > 0 ? 'text-emerald-300' : 'text-rose-300'
                      )}
                    >
                      ({selected.charDelta > 0 ? '+' : ''}
                      {selected.charDelta})
                    </span>
                  )}
                </Row>
                {selected.restoredFromVersionId && (
                  <Row label="來源">還原自先前版本</Row>
                )}
                {selected.aiJobId && <Row label="產生方式">AI 生成後採用</Row>}
                <Row label="備註">{selected.label || '—'}</Row>
              </dl>
            ) : (
              <EmptyState title="未選擇版本" className="py-8" />
            )}
          </section>

          <section className="panel rounded-xl bg-stage-900 ring-1 ring-stage-700">
            <header className="flex items-center gap-2 border-b border-stage-700/60 px-4 py-2.5">
              <RotateCcw aria-hidden className="size-3.5 text-accent-400" />
              <h2 className="flex-1 text-xs font-medium text-ink-200">版本操作</h2>
            </header>

            <div className="flex flex-col gap-2 p-4">
              <button
                type="button"
                disabled={!selected || busy}
                onClick={() => selected && setRestoring(selected)}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-stage-800 px-3 py-2 text-xs text-ink-200 ring-1 ring-inset ring-stage-700 transition-colors hover:text-ink-50 disabled:opacity-50"
              >
                <RotateCcw aria-hidden className="size-3.5" />
                回溯此版本
              </button>

              <Gated label="設為定稿" milestone="M4" icon={<Check className="size-3.5" />} />
              <Gated label="建立分支" milestone="M4" icon={<GitBranch className="size-3.5" />} />
              <Gated label="下載匯出" milestone="M4" icon={<Download className="size-3.5" />} />

              {/*
                No delete. History is append-only: a version somebody else wrote
                is not one you get to remove, and 回溯 already covers wanting the
                older text back.
              */}
              <span
                aria-disabled="true"
                title="版本紀錄是唯寫的，不提供刪除。要取回舊內容請用「回溯此版本」。"
                className="inline-flex cursor-default items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs text-ink-700 select-none"
              >
                <Trash2 aria-hidden className="size-3.5" />
                不提供刪除版本
              </span>
            </div>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={restoring !== null}
        title="回溯到這個版本？"
        tone="default"
        busy={busy}
        message={
          restoring
            ? `EP${String(restoring.episodeNumber).padStart(3, '0')} 的${DOCUMENT_KIND_LABEL[restoring.kind]}會變回 v${restoring.version} 的內容。目前的內容會先自動存成一個版本，所以這個動作本身也可以再回溯。`
            : ''
        }
        confirmLabel={busy ? '回溯中…' : '確定回溯'}
        onConfirm={() => { if (restoring) void restore(restoring) }}
        onCancel={() => setRestoring(null)}
      />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <section className="panel flex flex-col rounded-xl bg-stage-900 p-3.5 ring-1 ring-stage-700">
      <h2 className="mb-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
        <span aria-hidden className="text-accent-400">
          {icon}
        </span>
        {label}
      </h2>
      <p className="text-2xl font-semibold text-ink-50 tabular-nums">{value}</p>
    </section>
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

function Gated({
  label,
  milestone,
  icon,
}: {
  label: string
  milestone: string
  icon: React.ReactNode
}) {
  return (
    <span
      aria-disabled="true"
      title={`「${label}」尚未實作，預計於 ${milestone} 階段交付`}
      className="inline-flex cursor-default items-center justify-center gap-1.5 rounded-lg bg-stage-850 px-3 py-2 text-xs text-ink-600 ring-1 ring-inset ring-stage-700 select-none"
    >
      {icon}
      {label}
      <span className="rounded bg-stage-900 px-1 text-[10px] text-ink-700">{milestone}</span>
    </span>
  )
}
