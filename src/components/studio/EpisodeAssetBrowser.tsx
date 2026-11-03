'use client'

import {
  Clapperboard,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Mic,
  Music,
  Upload,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, type DragEvent } from 'react'
import { useUploader } from '@/components/studio/useUploader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/StateViews'
import { assetDownloadUrl, assetPreviewUrl, assetUrl } from '@/lib/asset-url'
import {
  ASSET_KIND_LABEL,
  type AssetKindValue,
} from '@/lib/constants'
import { acceptAnyMedia } from '@/lib/media-types'
import { cn, formatDurationZh } from '@/lib/utils'

/**
 * 本集素材 (Z2).
 *
 * `assets.episode_id` has carried this association since the beginning; what
 * was missing was anywhere to look at it. A file uploaded against an episode
 * used to be reachable only through whatever record referenced it, so anything
 * uploaded and not yet used was invisible — present, paid for, and unfindable.
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
  createdAt: string
  hasPreview: boolean
  hasWaveform: boolean
  isFinalCut: boolean
}

export type AssetGroup = {
  kind: AssetKindValue
  items: AssetItem[]
  sizeBytes: number
}

const KIND_ICON: Partial<Record<AssetKindValue, LucideIcon>> = {
  IMAGE: ImageIcon,
  VIDEO: Film,
  MUSIC: Music,
  SFX: Volume2,
  VOICE: Mic,
  DOC: FileText,
  NOVEL_ATTACHMENT: FileText,
  STICKER: ImageIcon,
}

/** What the upload button offers. Order follows the production pipeline. */
const UPLOADABLE: AssetKindValue[] = ['IMAGE', 'VIDEO', 'MUSIC', 'SFX', 'VOICE', 'DOC']

export function EpisodeAssetBrowser({
  projectId,
  episodeId,
  groups,
  total,
  sizeBytes,
  canUpload,
}: {
  projectId: string
  episodeId: string
  groups: AssetGroup[]
  total: number
  sizeBytes: number
  canUpload: boolean
}) {
  const router = useRouter()
  const [kind, setKind] = useState<AssetKindValue>('IMAGE')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const uploader = useUploader({
    projectId,
    episodeId,
    // Refresh once a file lands, so it appears without a manual reload.
    onComplete: () => router.refresh(),
  })

  const active = uploader.items.filter((item) =>
    ['queued', 'preparing', 'uploading', 'finalising'].includes(item.status)
  )
  const failed = uploader.items.filter((item) => item.status === 'failed')

  function accept(files: FileList | File[] | null) {
    const list = Array.from(files ?? [])
    if (list.length > 0) uploader.enqueue(list, kind)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files)
  }

  return (
    <div
      onDragOver={(event) => {
        if (!canUpload) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={canUpload ? onDrop : undefined}
      className={cn(
        'flex flex-col gap-4 rounded-xl transition-colors',
        dragging && 'bg-accent-600/5 ring-2 ring-accent-500/50 ring-inset'
      )}
    >
      {canUpload && (
        <section className="panel flex flex-wrap items-center gap-2 rounded-xl bg-stage-900 p-3 ring-1 ring-stage-700">
          <span className="text-[11px] text-ink-500">上傳為</span>

          <div className="flex flex-wrap gap-1">
            {UPLOADABLE.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] transition-colors',
                  kind === option
                    ? 'bg-accent-600/25 text-ink-50 ring-1 ring-inset ring-accent-500/50'
                    : 'text-ink-500 ring-1 ring-inset ring-stage-700 hover:bg-stage-800 hover:text-ink-200'
                )}
              >
                {ASSET_KIND_LABEL[option]}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Upload aria-hidden className="size-3.5" />}
            onClick={() => inputRef.current?.click()}
            className="ml-auto"
          >
            選擇檔案
          </Button>

          <p className="w-full text-[10px] text-ink-700">
            也可以把檔案直接拖進這一頁。大檔會自動分段上傳，中斷可以重試。
          </p>

          {active.length > 0 && (
            <ul className="flex w-full flex-col gap-1">
              {active.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-[10px] text-ink-400">
                  <Loader2 aria-hidden className="size-3 animate-spin text-accent-400" />
                  <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                  <span className="tabular-nums">{Math.round(item.progress * 100)}%</span>
                  <button
                    type="button"
                    onClick={() => void uploader.cancel(item.id)}
                    className="text-ink-600 hover:text-rose-300"
                  >
                    取消
                  </button>
                </li>
              ))}
            </ul>
          )}

          {failed.map((item) => (
            <p key={item.id} role="alert" className="w-full text-[10px] text-rose-400">
              {item.file.name} 上傳失敗：{item.error}{' '}
              <button
                type="button"
                onClick={() => uploader.retry(item.id)}
                className="underline underline-offset-2"
              >
                重試
              </button>
            </p>
          ))}
        </section>
      )}

      {total === 0 ? (
        <EmptyState
          title="這一集還沒有素材"
          description={
            canUpload
              ? '上傳的圖片、影片、音樂、音效與配音都會集中在這裡。'
              : '素材上傳需要相應權限。'
          }
          icon={<Clapperboard aria-hidden className="size-5 text-ink-500" />}
          className="py-16"
        />
      ) : (
        <>
          <p className="text-[11px] text-ink-500">
            共 {total} 個檔案・{formatBytes(sizeBytes)}
          </p>

          {groups.map((group) => (
            <section key={group.kind} className="flex flex-col gap-2">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-ink-200">
                {renderIcon(group.kind)}
                {ASSET_KIND_LABEL[group.kind]}
                <span className="font-normal text-ink-600">
                  {group.items.length}・{formatBytes(group.sizeBytes)}
                </span>
              </h3>

              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <AssetCard item={item} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptAnyMedia()}
        className="hidden"
        onChange={(event) => {
          accept(event.target.files)
          // Reset, so picking the same file again still fires a change event.
          event.target.value = ''
        }}
      />
    </div>
  )
}

function renderIcon(kind: AssetKindValue) {
  const Icon = KIND_ICON[kind]
  return Icon ? <Icon aria-hidden className="size-3.5 text-accent-400" /> : null
}

function AssetCard({ item }: { item: AssetItem }) {
  const isImage = item.kind === 'IMAGE' || item.kind === 'STICKER'
  const isVideo = item.kind === 'VIDEO'
  const isAudio = item.kind === 'MUSIC' || item.kind === 'SFX' || item.kind === 'VOICE'

  return (
    <article className="panel flex flex-col overflow-hidden rounded-lg bg-stage-900 ring-1 ring-stage-700 transition-all hover:ring-stage-600">
      <div className="relative aspect-video bg-stage-950">
        {isImage || (isVideo && item.hasPreview) ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={assetPreviewUrl(item.id)}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            {renderIcon(item.kind) ?? <FileText aria-hidden className="size-5 text-ink-700" />}
          </div>
        )}

        {item.isFinalCut && (
          <span className="absolute top-1.5 left-1.5 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-200 ring-1 ring-inset ring-emerald-500/40">
            本集成片
          </span>
        )}

        {item.version > 1 && (
          <span className="absolute top-1.5 right-1.5 rounded bg-stage-950/80 px-1.5 py-0.5 text-[10px] text-ink-300">
            v{item.version}
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1 p-2.5">
        <p className="truncate text-[11px] font-medium text-ink-100" title={item.name}>
          {item.title || item.name}
        </p>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-600">
          <span>{formatBytes(item.sizeBytes)}</span>
          {item.durationSec !== null && <span>{formatDurationZh(item.durationSec)}</span>}
          {item.width && item.height && (
            <span>
              {item.width}×{item.height}
            </span>
          )}
          {isAudio && !item.hasWaveform && <span title="尚未計算波形">無波形</span>}
        </div>

        {/* Audio is listened to, not looked at — so the card plays it. */}
        {isAudio && (
          <audio src={assetUrl(item.id)} controls preload="none" className="mt-1 h-8 w-full" />
        )}

        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-700">
          <span className="min-w-0 flex-1 truncate">{item.uploadedByName ?? '—'}</span>
          <a
            href={assetDownloadUrl(item.id)}
            className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-stage-800 hover:text-ink-200"
          >
            <Download aria-hidden className="size-3" />
            下載
          </a>
        </div>
      </div>
    </article>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
