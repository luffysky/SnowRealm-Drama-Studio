'use client'

import {
  FileText,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Mic,
  Music,
  Package,
  Search,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AssetUploadButton } from '@/components/assets/AssetUploadButton'
import { EmptyState } from '@/components/ui/StateViews'
import { assetDownloadUrl, assetPreviewUrl, assetUrl } from '@/lib/asset-url'
import { ASSET_SORT_LABEL, ASSET_SORTS, formatBytes, type AssetSort } from '@/lib/asset-browser-view'
import { ASSET_KIND_LABEL, type AssetKindValue } from '@/lib/constants'
import { cn, formatDurationZh, formatRelativeZh } from '@/lib/utils'

/**
 * The per-kind asset tabs (81, 86, 87 and 全部素材).
 *
 * One component for six tabs: they differ in which kinds they list and what a
 * tile shows for a file, not in how they are searched, sorted or paged. A page
 * each would have been six copies of the same URL-state handling, and the
 * first bug fixed in one of them would have stayed in the other five.
 *
 * Every piece of state lives in the URL, so a reload or a pasted link lands on
 * the same view.
 */

export type AssetItem = {
  id: string
  kind: AssetKindValue
  title: string
  name: string
  mimeType: string
  sizeBytes: number
  durationSec: number | null
  width: number | null
  height: number | null
  version: number
  uploadedByName: string | null
  episodeNumber: number | null
  hasPreview: boolean
  hasWaveform: boolean
  createdAt: string
  updatedAt: string
}

const KIND_ICON: Partial<Record<AssetKindValue, LucideIcon>> = {
  IMAGE: ImageIcon,
  STICKER: ImageIcon,
  VIDEO: Film,
  MUSIC: Music,
  SFX: Volume2,
  VOICE: Mic,
  DOC: FileText,
  NOVEL_ATTACHMENT: FileText,
}

export function AssetBrowser({
  projectId,
  heading,
  kinds,
  uploadKind,
  rows,
  matched,
  page,
  pageCount,
  kindCounts,
  totalBytes,
  episodeOptions,
}: {
  projectId: string
  heading: string
  /** Empty means 全部素材. */
  kinds: AssetKindValue[]
  /** Which kind the tab's own upload button files things under. */
  uploadKind?: AssetKindValue
  rows: AssetItem[]
  matched: number
  page: number
  pageCount: number
  kindCounts: Record<string, number>
  totalBytes: number
  episodeOptions: { id: string; number: number; title: string }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const q = params.get('q') ?? ''
  const sort = (params.get('sort') ?? 'recent') as AssetSort
  const view = params.get('view') === 'list' ? 'list' : 'grid'
  const episodeId = params.get('episode') ?? ''


  function set(key: string, value: string | null, keepPage = false) {
    const next = new URLSearchParams(params.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    if (!keepPage) next.delete('page')
    router.push(`${pathname}?${next.toString()}`)
  }

  // 全部素材 passes no kinds, and `kinds[0]` then fell through to the image
  // icon, labelling the all-kinds tab as pictures.
  const first = kinds[0]
  const Icon = (first && KIND_ICON[first]) ?? Package
  const total = Object.values(kindCounts).reduce((sum, n) => sum + n, 0)

  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-100">
          <Icon aria-hidden className="size-4 text-accent-400" />
          {heading}
        </h2>
        <span className="text-[11px] text-ink-500">
          共 {total} 個檔案{totalBytes > 0 && `・${formatBytes(totalBytes)}`}
        </span>

        <div className="ml-auto flex items-start gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-stage-900 p-0.5 ring-1 ring-stage-700">
            <ViewButton active={view === 'grid'} label="格狀" onClick={() => set('view', 'grid', true)}>
              <LayoutGrid aria-hidden className="size-3.5" />
            </ViewButton>
            <ViewButton active={view === 'list'} label="列表" onClick={() => set('view', 'list', true)}>
              <List aria-hidden className="size-3.5" />
            </ViewButton>
          </div>
          <AssetUploadButton
            projectId={projectId}
            {...(uploadKind ? { kind: uploadKind } : {})}
            label={uploadKind ? `新增${ASSET_KIND_LABEL[uploadKind]}` : '新增檔案'}
          />
        </div>
      </header>

      {/* ---- filters --------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {/*
          Uncontrolled, keyed on `q`. The box has to follow the URL when it
          changes from elsewhere — the back button, or a pasted link — and
          keying it remounts with the new value instead of syncing state from
          an effect on every keystroke's render.
        */}
        <form
          key={q}
          className="relative min-w-48 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            const value = new FormData(event.currentTarget).get('q')
            set('q', String(value ?? '').trim() || null)
          }}
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-600"
          />
          <label className="sr-only" htmlFor="asset-search">
            搜尋檔名
          </label>
          <input
            id="asset-search"
            name="q"
            defaultValue={q}
            placeholder="搜尋檔名或標題⋯"
            className="w-full rounded-lg bg-stage-900 py-1.5 pr-2.5 pl-8 text-[11px] text-ink-100 ring-1 ring-stage-700 outline-none placeholder:text-ink-700 focus:ring-accent-500"
          />
        </form>

        {episodeOptions.length > 0 && (
          <>
            <label className="sr-only" htmlFor="asset-episode">
              集數
            </label>
            <select
              id="asset-episode"
              value={episodeId}
              onChange={(event) => set('episode', event.target.value || null)}
              className="rounded-lg bg-stage-900 px-2 py-1.5 text-[11px] text-ink-200 ring-1 ring-stage-700 outline-none focus:ring-accent-500"
            >
              <option value="">所有集數</option>
              {episodeOptions.map((episode) => (
                <option key={episode.id} value={episode.id}>
                  EP{String(episode.number).padStart(3, '0')}
                  {episode.title && `・${episode.title}`}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="sr-only" htmlFor="asset-sort">
          排序
        </label>
        <select
          id="asset-sort"
          value={sort}
          onChange={(event) => set('sort', event.target.value)}
          className="rounded-lg bg-stage-900 px-2 py-1.5 text-[11px] text-ink-200 ring-1 ring-stage-700 outline-none focus:ring-accent-500"
        >
          {ASSET_SORTS.map((key) => (
            <option key={key} value={key}>
              {ASSET_SORT_LABEL[key]}
            </option>
          ))}
        </select>
      </div>

      {/* ---- results --------------------------------------------------- */}
      {rows.length === 0 ? (
        <EmptyState
          title={q || episodeId ? '沒有符合的檔案' : '還沒有檔案'}
          description={
            q || episodeId
              ? '換個關鍵字，或把集數篩選清掉。'
              : '用右上角的按鈕上傳，或從集數的「本集素材」上傳。'
          }
          icon={<Icon aria-hidden className="size-5 text-ink-500" />}
          className="py-16"
        />
      ) : view === 'grid' ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((row) => (
            <li key={row.id}>
              <Card projectId={projectId} row={row} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="panel flex flex-col divide-y divide-stage-700/40 rounded-xl bg-stage-900 ring-1 ring-stage-700">
          {rows.map((row) => (
            <li key={row.id}>
              <Row projectId={projectId} row={row} />
            </li>
          ))}
        </ul>
      )}

      {/* ---- paging ---------------------------------------------------- */}
      {pageCount > 1 && (
        <nav aria-label="分頁" className="flex items-center justify-center gap-2">
          <PageButton disabled={page <= 1} onClick={() => set('page', String(page - 1), true)}>
            上一頁
          </PageButton>
          <span className="text-[11px] text-ink-500 tabular-nums">
            第 {page} / {pageCount} 頁・共 {matched} 筆
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

function Card({ projectId, row }: { projectId: string; row: AssetItem }) {
  const Icon = KIND_ICON[row.kind] ?? Package

  return (
    <article className="panel flex h-full flex-col gap-2 rounded-lg bg-stage-900 p-2 ring-1 ring-stage-700 transition-all hover:ring-stage-600">
      <div className="relative aspect-video overflow-hidden rounded bg-stage-950">
        {showsThumbnail(row) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetPreviewUrl(row.id)}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <Icon aria-hidden className="size-6 text-ink-700" />
          </span>
        )}

        {row.durationSec !== null && (
          <span className="absolute right-1 bottom-1 rounded bg-stage-990/80 px-1 py-0.5 text-[9px] text-ink-300 tabular-nums">
            {formatDurationZh(row.durationSec)}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col">
        <DetailLink projectId={projectId} row={row} className="truncate text-[11px] font-medium" />
        <span className="truncate text-[10px] text-ink-600">
          {ASSET_KIND_LABEL[row.kind]}
          {row.episodeNumber !== null && `・EP${String(row.episodeNumber).padStart(3, '0')}`}
          {`・${formatBytes(row.sizeBytes)}`}
        </span>
      </div>

      {isAudio(row.kind) && <Audio row={row} />}

      <div className="mt-auto flex items-center gap-2 text-[10px] text-ink-700">
        <span>v{row.version}</span>
        <span className="ml-auto">{formatRelativeZh(new Date(row.createdAt))}</span>
        <a
          href={assetDownloadUrl(row.id)}
          className="underline underline-offset-2 transition-colors hover:text-ink-300"
        >
          下載
        </a>
      </div>
    </article>
  )
}

function Row({ projectId, row }: { projectId: string; row: AssetItem }) {
  const Icon = KIND_ICON[row.kind] ?? Package

  return (
    <article className="flex flex-wrap items-center gap-2.5 px-3 py-2">
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded bg-stage-950">
        {showsThumbnail(row) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetPreviewUrl(row.id)}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <Icon aria-hidden className="size-3.5 text-ink-700" />
        )}
      </span>

      <span className="flex min-w-0 flex-[2] flex-col">
        <DetailLink projectId={projectId} row={row} className="truncate text-xs font-medium" />
        <span className="truncate text-[10px] text-ink-600">
          {ASSET_KIND_LABEL[row.kind]}
          {row.episodeNumber !== null && `・EP${String(row.episodeNumber).padStart(3, '0')}`}
          {row.uploadedByName && `・${row.uploadedByName}`}
        </span>
      </span>

      <span className="shrink-0 text-[10px] text-ink-500 tabular-nums">
        {row.durationSec !== null
          ? formatDurationZh(row.durationSec)
          : row.width && row.height
            ? `${row.width}×${row.height}`
            : '—'}
      </span>

      <span className="shrink-0 text-[10px] text-ink-500 tabular-nums">
        {formatBytes(row.sizeBytes)}
      </span>

      <span className="shrink-0 rounded bg-stage-800 px-1.5 py-0.5 text-[10px] text-ink-500">
        v{row.version}
      </span>

      {isAudio(row.kind) && <Audio row={row} className="w-full sm:w-52" />}

      <a
        href={assetDownloadUrl(row.id)}
        className="shrink-0 text-[10px] text-ink-600 underline underline-offset-2 transition-colors hover:text-ink-200"
      >
        下載
      </a>
    </article>
  )
}

/**
 * The title links to a detail page only where one exists — today that is music
 * (83). Linking every kind would be a link to a 404 for five of six tabs.
 */
function DetailLink({
  projectId,
  row,
  className,
}: {
  projectId: string
  row: AssetItem
  className: string
}) {
  const label = row.title || row.name

  if (row.kind === 'MUSIC') {
    return (
      <Link
        href={`/projects/${projectId}/assets/music/${row.id}`}
        className={cn(className, 'text-ink-100 transition-colors hover:text-accent-300')}
      >
        {label}
      </Link>
    )
  }

  return <span className={cn(className, 'text-ink-100')}>{label}</span>
}

function Audio({ row, className }: { row: AssetItem; className?: string }) {
  return (
    // `preload="none"`: a page of 24 tiles must not open 24 connections to R2
    // before anyone has pressed anything.
    <audio src={assetUrl(row.id)} controls preload="none" className={cn('h-8 w-full', className)}>
      <track kind="captions" />
    </audio>
  )
}

/**
 * Whether to put an `<img>` in the tile.
 *
 * An image always can: `/api/files/[id]?variant=preview` falls back to the
 * master server-side, so a picture uploaded before previews existed still
 * renders. Keying this on `hasPreview` alone drew an icon for every such file
 * — which looked exactly like a broken upload.
 *
 * Anything else needs a real generated preview. A video with no poster frame
 * would render as a broken image, and an MP3 has nothing to show at all.
 */
function showsThumbnail(row: AssetItem): boolean {
  if (row.kind === 'IMAGE' || row.kind === 'STICKER') return true
  return row.hasPreview
}

function isAudio(kind: AssetKindValue): boolean {
  return kind === 'MUSIC' || kind === 'SFX' || kind === 'VOICE'
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'grid size-7 place-items-center rounded-md transition-colors',
        active ? 'bg-stage-700 text-ink-100' : 'text-ink-600 hover:text-ink-200'
      )}
    >
      {children}
    </button>
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
      className="rounded-md bg-stage-900 px-2.5 py-1 text-[11px] text-ink-300 ring-1 ring-stage-700 transition-colors hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}
