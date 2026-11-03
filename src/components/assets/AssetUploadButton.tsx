'use client'

import { AlertTriangle, Check, Loader2, Plus, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { useUploader } from '@/components/studio/useUploader'
import { assetTabHref, tabForKind } from '@/lib/asset-center-view'
import type { AssetKindValue } from '@/lib/constants'
import { acceptAnyMedia, acceptFor, familyOf, resolveMimeType } from '@/lib/media-types'

/**
 * Upload entry point for the asset centre (81).
 *
 * Two modes, which is the distinction the tab strip already makes:
 *
 *  - **Overview** (`kind` omitted): takes any media, reads the kind from the
 *    file, and on success sends you to that kind's tab. You should not have to
 *    classify a file before the system has looked at it, and routing afterwards
 *    means the upload answers "where did it go?" by taking you there.
 *  - **Inside a tab** (`kind` given): takes only that tab's formats and files
 *    everything under that kind, because the tab is the answer already.
 *
 * It replaced a 「新增音樂」 button on the overview, which was the only entry
 * point on a page counting six kinds of asset.
 */
export function AssetUploadButton({
  projectId,
  kind,
  label,
}: {
  projectId: string
  /** Restrict to one kind. Omitted on the overview, which takes anything. */
  kind?: AssetKindValue
  label?: string
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [rejected, setRejected] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)

  const uploader = useUploader({
    projectId,
    // No episode: these belong to the project. The episode link is made later
    // from 本集素材.
    episodeId: null,
    onComplete: (_assetId, file) => {
      const landed = kind ?? kindOf(file)
      router.refresh()
      if (!landed) return

      const tab = tabForKind(landed)
      /*
       * Only navigate away from the overview, and only to a tab that exists.
       * Routing to an unbuilt tab would be a link to a 404 by another route,
       * so instead the file stays uploaded and the note says where it went.
       */
      if (!kind && tab) {
        if (tab.ready) {
          router.push(assetTabHref(projectId, tab))
        } else {
          setNote(`已上傳到「${tab.label}」，那個分頁還沒做（${tab.milestone}）。`)
        }
      }
    },
  })

  function accept(files: FileList | null) {
    const list = Array.from(files ?? [])
    if (list.length === 0) return

    setNote(null)
    const refused: string[] = []

    for (const file of list) {
      const resolved = kind ?? kindOf(file)
      if (!resolved) {
        refused.push(file.name)
        continue
      }
      uploader.enqueue([file], resolved)
    }

    setRejected(refused)
    if (inputRef.current) inputRef.current.value = ''
  }

  const active = uploader.counts.active
  const failed = uploader.items.filter((item) => item.status === 'failed')

  return (
    <div className="flex flex-col items-end gap-1.5">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={kind ? acceptForKind(kind) : acceptAnyMedia()}
        onChange={(event) => accept(event.target.files)}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-500 disabled:opacity-60"
        disabled={active > 0}
      >
        {active > 0 ? (
          <>
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            上傳中（{active}）
          </>
        ) : (
          <>
            <Plus aria-hidden className="size-3.5" />
            {label ?? '新增檔案'}
          </>
        )}
      </button>

      {active > 0 && (
        <ul className="flex max-w-xs flex-col gap-1">
          {uploader.items
            .filter((item) =>
              ['queued', 'preparing', 'uploading', 'finalising'].includes(item.status)
            )
            .map((item) => (
              <li key={item.id} className="flex items-center gap-1.5 text-[10px] text-ink-500">
                <span className="max-w-40 truncate">{item.file.name}</span>
                <span className="tabular-nums">{Math.round(item.progress * 100)}%</span>
                <button
                  type="button"
                  onClick={() => uploader.cancel(item.id)}
                  aria-label={`取消上傳 ${item.file.name}`}
                  className="rounded p-0.5 text-ink-600 hover:text-ink-200"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </li>
            ))}
        </ul>
      )}

      {uploader.counts.done > 0 && active === 0 && failed.length === 0 && !note && (
        <p className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
          <Check aria-hidden className="size-3" />
          已上傳 {uploader.counts.done} 個檔案
        </p>
      )}

      {note && <p className="max-w-xs text-right text-[10px] text-ink-400">{note}</p>}

      {failed.map((item) => (
        <p
          key={item.id}
          className="inline-flex max-w-xs items-start gap-1 text-right text-[10px] text-rose-300"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
          <span>
            {item.file.name}：{item.error ?? '上傳失敗'}
            <button
              type="button"
              onClick={() => uploader.retry(item.id)}
              className="ml-1.5 underline underline-offset-2 hover:text-rose-200"
            >
              重試
            </button>
          </span>
        </p>
      ))}

      {rejected.length > 0 && (
        <p className="max-w-xs text-right text-[10px] text-amber-300">
          認不得這些檔案的格式，沒有上傳：{rejected.join('、')}
        </p>
      )}
    </div>
  )
}

/**
 * Which asset kind a file becomes, on the overview where nothing says.
 *
 * `resolveMimeType` first, because Windows reports `application/octet-stream`
 * for `.mkv`, `.flac` and `.avi` — trusting `file.type` alone is what used to
 * reject half the formats the library is supposed to take.
 */
function kindOf(file: File): AssetKindValue | null {
  const mime = resolveMimeType(file.name, file.type)

  switch (familyOf(mime)) {
    case 'image':
      return 'IMAGE'
    case 'video':
      return 'VIDEO'
    case 'audio':
      // MUSIC / SFX / VOICE is an editorial distinction no MIME type can make.
      // MUSIC is the default; the metadata form moves it.
      return 'MUSIC'
    case 'document':
      return 'DOC'
    default:
      return null
  }
}

function acceptForKind(kind: AssetKindValue): string {
  switch (kind) {
    case 'IMAGE':
    case 'STICKER':
      return acceptFor('image')
    case 'VIDEO':
      return acceptFor('video')
    case 'MUSIC':
    case 'SFX':
    case 'VOICE':
      return acceptFor('audio')
    default:
      return acceptAnyMedia()
  }
}
