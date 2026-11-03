'use client'

import {
  AlertTriangle,
  LayoutGrid,
  List,
  Music,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { EmptyState } from '@/components/ui/StateViews'
import { assetUrl } from '@/lib/asset-url'
import {
  LICENSE_LABEL,
  LICENSE_STYLE,
  MUSIC_CATEGORY_LABEL,
  MUSIC_CATEGORY_ORDER,
  MUSIC_SORTS,
  MUSIC_SORT_LABEL,
  type MusicSort,
} from '@/lib/music-view'
import { cn, formatDurationZh, formatRelativeZh } from '@/lib/utils'

/**
 * 82 音樂素材庫 (Z5).
 *
 * Every control writes to the URL rather than to component state. The
 * acceptance test is 「搜尋/分頁重整仍有效」, and that only holds if a reload
 * can read the state back — which also makes a filtered view something you
 * can send to the other member.
 */

export type MusicItem = {
  assetId: string
  title: string
  name: string
  category: string
  genreTags: string[]
  moodTags: string[]
  artist: string
  language: string
  durationSec: number | null
  sizeBytes: number
  version: number
  sourcePlatform: string
  licenseStatus: string
  hasWaveform: boolean
  updatedAt: string
}


export function MusicLibrary({
  projectId,
  rows,
  matched,
  page,
  pageCount,
  categoryCounts,
  availableGenres,
  availableMoods,
  query,
}: {
  projectId: string
  rows: MusicItem[]
  matched: number
  page: number
  pageCount: number
  categoryCounts: Record<string, number>
  availableGenres: string[]
  availableMoods: string[]
  query: {
    q: string
    category: string
    mood: string
    genre: string
    license: string
    sort: MusicSort
    view: 'list' | 'card'
  }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const [draft, setDraft] = useState(query.q)

  /** Writes one parameter and resets paging, since the result set changed. */
  function set(key: string, value: string | null, keepPage = false) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    if (!keepPage) next.delete('page')
    router.push(`${pathname}?${next.toString()}`)
  }

  const total = Object.values(categoryCounts).reduce((sum, n) => sum + n, 0)

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Music aria-hidden className="size-4 text-accent-400" />
          音樂素材庫
        </h2>
        <span className="text-[11px] text-ink-500">共 {total} 首</span>

        <div className="ml-auto flex items-center gap-1">
          <ViewToggle current={query.view} onChange={(view) => set('view', view, true)} />
          <Link
            href={`/projects/${projectId}/assets/music/new`}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-500"
          >
            <Plus aria-hidden className="size-3.5" />
            新增音樂
          </Link>
        </div>
      </header>

      {/* ---- category chips ------------------------------------------- */}
      <div className="flex flex-wrap gap-1">
        <Chip active={!query.category} onClick={() => set('category', null)}>
          全部 <span className="text-ink-600">{total}</span>
        </Chip>
        {MUSIC_CATEGORY_ORDER.filter((key) => (categoryCounts[key] ?? 0) > 0).map((key) => (
          <Chip
            key={key}
            active={query.category === key}
            onClick={() => set('category', query.category === key ? null : key)}
          >
            {MUSIC_CATEGORY_LABEL[key]} <span className="text-ink-600">{categoryCounts[key]}</span>
          </Chip>
        ))}
      </div>

      {/* ---- filters ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            set('q', draft.trim() || null)
          }}
          className="relative"
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-600"
          />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="搜尋曲名、演唱者或描述"
            aria-label="搜尋音樂"
            className="h-8 w-56 rounded-md bg-stage-900 pr-2 pl-8 text-xs text-ink-50 ring-1 ring-inset ring-stage-700 placeholder:text-ink-600 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          />
        </form>

        <FilterSelect
          label="風格"
          value={query.genre}
          options={availableGenres}
          onChange={(value) => set('genre', value)}
        />
        <FilterSelect
          label="情緒"
          value={query.mood}
          options={availableMoods}
          onChange={(value) => set('mood', value)}
        />
        <FilterSelect
          label="授權"
          value={query.license}
          options={Object.keys(LICENSE_LABEL)}
          labels={LICENSE_LABEL}
          onChange={(value) => set('license', value)}
        />

        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-500">
          排序
          <select
            value={query.sort}
            onChange={(event) => set('sort', event.target.value)}
            className="h-8 rounded-md bg-stage-900 px-2 text-xs text-ink-200 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
          >
            {MUSIC_SORTS.map((value) => (
              <option key={value} value={value} className="bg-stage-850">
                {MUSIC_SORT_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ---- results ---------------------------------------------------- */}
      {rows.length === 0 ? (
        <EmptyState
          title={total === 0 ? '還沒有音樂' : '沒有符合的音樂'}
          description={
            total === 0
              ? '上傳第一首之後，分類、風格與授權狀態都會出現在這裡。'
              : '換個關鍵字，或放寬上面的篩選。'
          }
          icon={<Music aria-hidden className="size-5 text-ink-500" />}
          className="py-16"
        />
      ) : query.view === 'card' ? (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <li key={row.assetId}>
              <CardRow projectId={projectId} row={row} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.assetId}>
              <ListRow projectId={projectId} row={row} />
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav className="flex items-center justify-center gap-2 pt-1" aria-label="分頁">
          <PageButton disabled={page <= 1} onClick={() => set('page', String(page - 1), true)}>
            上一頁
          </PageButton>
          <span className="text-[11px] text-ink-500 tabular-nums">
            {page} / {pageCount}
            <span className="ml-2 text-ink-700">共 {matched} 首</span>
          </span>
          <PageButton
            disabled={page >= pageCount}
            onClick={() => set('page', String(page + 1), true)}
          >
            下一頁
          </PageButton>
        </nav>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function ListRow({ projectId, row }: { projectId: string; row: MusicItem }) {
  return (
    <article className="panel flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-stage-900 px-3 py-2.5 ring-1 ring-stage-700 transition-all hover:ring-stage-600">
      <span className="grid size-8 shrink-0 place-items-center rounded bg-stage-950">
        <Music aria-hidden className="size-3.5 text-accent-400" />
      </span>

      <span className="flex min-w-0 flex-[2] flex-col">
        {/* The title opens the waveform player (83); the pencil still edits. */}
        <Link
          href={`/projects/${projectId}/assets/music/${row.assetId}`}
          className="truncate text-xs font-medium text-ink-100 transition-colors hover:text-accent-300"
        >
          {row.title || row.name}
        </Link>
        <span className="truncate text-[10px] text-ink-600">
          {MUSIC_CATEGORY_LABEL[row.category]}
          {row.artist && `・${row.artist}`}
          {row.sourcePlatform && `・${row.sourcePlatform}`}
        </span>
      </span>

      <Tags row={row} className="hidden flex-1 lg:flex" />

      <span className="shrink-0 text-[10px] text-ink-500 tabular-nums">
        {row.durationSec !== null ? formatDurationZh(row.durationSec) : '—'}
      </span>

      <span className="shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[10px] text-ink-500">
        v{row.version}
      </span>

      <LicenseChip status={row.licenseStatus} />

      <audio
        src={assetUrl(row.assetId)}
        controls
        preload="none"
        className="h-8 w-full sm:w-52"
      />

      <Link
        href={`/projects/${projectId}/assets/music/${row.assetId}/edit`}
        className="shrink-0 rounded-md p-1.5 text-ink-600 transition-colors hover:bg-stage-800 hover:text-ink-100"
        aria-label={`編輯 ${row.title || row.name}`}
      >
        <Pencil aria-hidden className="size-3.5" />
      </Link>
    </article>
  )
}

function CardRow({ projectId, row }: { projectId: string; row: MusicItem }) {
  return (
    <article className="panel flex h-full flex-col gap-2 rounded-lg bg-stage-900 p-3 ring-1 ring-stage-700 transition-all hover:ring-stage-600">
      <div className="flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded bg-stage-950">
          <Music aria-hidden className="size-3.5 text-accent-400" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <Link
            href={`/projects/${projectId}/assets/music/${row.assetId}`}
            className="truncate text-xs font-medium text-ink-100 transition-colors hover:text-accent-300"
          >
            {row.title || row.name}
          </Link>
          <span className="truncate text-[10px] text-ink-600">
            {MUSIC_CATEGORY_LABEL[row.category]}
            {row.artist && `・${row.artist}`}
          </span>
        </span>
        <Link
          href={`/projects/${projectId}/assets/music/${row.assetId}/edit`}
          className="shrink-0 rounded-md p-1 text-ink-600 transition-colors hover:bg-stage-800 hover:text-ink-100"
          aria-label={`編輯 ${row.title || row.name}`}
        >
          <Pencil aria-hidden className="size-3" />
        </Link>
      </div>

      <Tags row={row} />

      <audio src={assetUrl(row.assetId)} controls preload="none" className="h-8 w-full" />

      <div className="mt-auto flex flex-wrap items-center gap-2 text-[10px] text-ink-600">
        <LicenseChip status={row.licenseStatus} />
        <span>v{row.version}</span>
        {row.durationSec !== null && <span>{formatDurationZh(row.durationSec)}</span>}
        {!row.hasWaveform && <span title="尚未計算波形">無波形</span>}
        <span className="ml-auto">{formatRelativeZh(row.updatedAt)}</span>
      </div>
    </article>
  )
}

function Tags({ row, className }: { row: MusicItem; className?: string }) {
  const tags = [...row.genreTags, ...row.moodTags].slice(0, 5)
  if (tags.length === 0) return <span className={className} />

  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded bg-stage-850 px-1.5 py-0.5 text-[10px] text-ink-500 ring-1 ring-inset ring-stage-700"
        >
          {tag}
        </span>
      ))}
    </span>
  )
}

function LicenseChip({ status }: { status: string }) {
  const pending = status === 'PENDING_REVIEW'
  const bad = status === 'EXPIRED' || status === 'REJECTED'

  return (
    <span
      title={
        pending
          ? '上傳不等於取得授權。到「授權管理」補上來源與條款證據才會轉成已授權。'
          : undefined
      }
      className={cn(
        'flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset',
        LICENSE_STYLE[status] ?? LICENSE_STYLE.PENDING_REVIEW
      )}
    >
      {pending || bad ? (
        <AlertTriangle aria-hidden className="size-2.5" />
      ) : (
        <ShieldCheck aria-hidden className="size-2.5" />
      )}
      {LICENSE_LABEL[status] ?? status}
    </span>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
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

function FilterSelect({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  labels?: Record<string, string>
  onChange: (value: string | null) => void
}) {
  // A filter with nothing to filter by is noise, not a disabled control.
  if (options.length === 0) return null

  return (
    <label className="flex items-center gap-1.5 text-[11px] text-ink-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value || null)}
        className="h-8 rounded-md bg-stage-900 px-2 text-xs text-ink-200 ring-1 ring-inset ring-stage-700 focus:ring-2 focus:ring-accent-500 focus:outline-none"
      >
        <option value="" className="bg-stage-850">
          全部
        </option>
        {options.map((option) => (
          <option key={option} value={option} className="bg-stage-850">
            {labels?.[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  )
}

function ViewToggle({
  current,
  onChange,
}: {
  current: 'list' | 'card'
  onChange: (view: 'list' | 'card') => void
}) {
  return (
    <span className="flex rounded-md ring-1 ring-inset ring-stage-700">
      {(
        [
          ['list', List, '列表檢視'],
          ['card', LayoutGrid, '卡片檢視'],
        ] as const
      ).map(([key, Icon, label]) => (
        <button
          key={key}
          type="button"
          aria-label={label}
          aria-pressed={current === key}
          onClick={() => onChange(key)}
          className={cn(
            'grid size-8 place-items-center first:rounded-l-md last:rounded-r-md transition-colors',
            current === key
              ? 'bg-accent-600/25 text-ink-50'
              : 'text-ink-500 hover:bg-stage-800 hover:text-ink-200'
          )}
        >
          <Icon aria-hidden className="size-3.5" />
        </button>
      ))}
    </span>
  )
}

function PageButton({
  disabled,
  onClick,
  children,
}: {
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-md px-2.5 py-1 text-[11px] text-ink-400 transition-colors hover:bg-stage-800 hover:text-ink-100 disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
