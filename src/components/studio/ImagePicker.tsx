'use client'

import { ImageUp, Loader2, Trash2 } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { CropDialog } from '@/components/studio/CropDialog'
import { useUploader } from '@/components/studio/useUploader'
import { assetPreviewUrl } from '@/lib/asset-url'
import { acceptFor, familyOf, resolveMimeType } from '@/lib/media-types'
import { cn } from '@/lib/utils'

/**
 * Picks one image and uploads it, returning the asset id.
 *
 * Shared by 作品封面, 小說封面 and 角色定妝照 — they differ only in the shape
 * of the frame and what the empty state says. Writing each one separately is
 * how the project ended up with a cover uploader that validated the file type
 * and a character portrait that had no upload at all.
 *
 * The caller owns the id: this never writes to the server itself, so the same
 * component works inside a form that saves on submit (the project dialog) and
 * beside one that saves immediately (the character rail).
 */

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024

export function ImagePicker({
  projectId,
  assetId,
  onChange,
  shape = 'wide',
  label = '圖片',
  hint,
  linkTo,
  disabled,
}: {
  projectId: string
  assetId: string | null
  onChange: (assetId: string | null) => void
  /** `wide` 16:10 for covers, `portrait` 2:3 for book covers and people. */
  shape?: 'wide' | 'portrait' | 'square'
  label?: string
  hint?: string
  /** Attaches the finished asset to a character, shot, etc. */
  linkTo?: { entityType: string; entityId: string; slot?: string }
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)
  /** 選好了、還沒裁的那一個檔案 (Z65)。 */
  const [cropping, setCropping] = useState<File | null>(null)

  const uploader = useUploader({
    projectId,
    ...(linkTo ? { linkTo } : {}),
    onComplete: (uploaded) => onChange(uploaded),
  })

  const active = uploader.items.find((item) =>
    ['queued', 'preparing', 'uploading', 'finalising'].includes(item.status)
  )
  const failed = uploader.items.find((item) => item.status === 'failed')

  function accept(files: FileList | File[] | null) {
    setRejected(null)
    const file = Array.from(files ?? [])[0]
    if (!file) return

    /*
     * Checked here as well as on the server: saying so immediately beats
     * uploading 12 MB and being refused. `resolveMimeType` rather than
     * `file.type`, which Windows reports as `application/octet-stream` for
     * anything with no registry entry.
     */
    if (familyOf(resolveMimeType(file.name, file.type)) !== 'image') {
      setRejected(`「${file.name}」不是圖片檔`)
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setRejected(`請小於 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`)
      return
    }

    /*
     * 先裁切再上傳 (Z65).
     *
     * 封面在列表、卡片與工作區頂端都是固定比例的框，所以直接存原圖等於讓
     * `object-cover` 替人決定構圖——一張直式照片會被從中間切掉頭。
     *
     * 裁切視窗用的就是這個 picker 的 `shape`，所以看到的框就是之後會顯示
     * 的框。
     */
    setCropping(file)
  }

  /** 裁切完（或按了「用原圖」）之後才真的進上傳佇列。 */
  function upload(file: File) {
    setCropping(null)
    uploader.enqueue([file], 'IMAGE')
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (!disabled) accept(event.dataTransfer.files)
  }

  const frame =
    shape === 'portrait' ? 'aspect-2/3 w-24' : shape === 'square' ? 'size-24' : 'aspect-16/10 w-40'

  return (
    <div className="flex flex-col gap-2">
      {cropping && (
        <CropDialog
          file={cropping}
          shape={shape}
          onCancel={() => setCropping(null)}
          onDone={upload}
        />
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-xl p-3 ring-1 transition-colors',
          dragging ? 'bg-accent-600/10 ring-accent-500' : 'bg-stage-900/60 ring-stage-700'
        )}
      >
        <div
          className={cn(
            'relative shrink-0 overflow-hidden rounded-lg bg-stage-950 ring-1 ring-stage-700',
            frame
          )}
        >
          {assetId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={assetPreviewUrl(assetId)}
              alt=""
              className="size-full object-cover"
              decoding="async"
            />
          ) : (
            <span className="grid size-full place-items-center">
              <ImageUp aria-hidden className="size-5 text-ink-700" />
            </span>
          )}

          {active && (
            <span className="absolute inset-0 grid place-items-center bg-stage-990/70">
              <span className="flex flex-col items-center gap-1 text-[10px] text-ink-200">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                {Math.round(active.progress * 100)}%
              </span>
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {hint && <p className="text-[10px] leading-relaxed text-ink-500">{hint}</p>}

          <div className="flex flex-wrap items-center gap-1.5">
            <input
              ref={inputRef}
              type="file"
              accept={acceptFor('image')}
              onChange={(event) => accept(event.target.files)}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || Boolean(active)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-stage-800 px-2.5 py-1.5 text-[11px] text-ink-200 transition-colors hover:bg-stage-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImageUp aria-hidden className="size-3.5" />
              {assetId ? `更換${label}` : `上傳${label}`}
            </button>

            {assetId && (
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={disabled || Boolean(active)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-ink-500 transition-colors hover:bg-stage-800 hover:text-rose-300 disabled:opacity-50"
              >
                <Trash2 aria-hidden className="size-3.5" />
                移除
              </button>
            )}
          </div>
        </div>
      </div>

      {rejected && <p className="text-[11px] text-amber-300">{rejected}</p>}
      {failed && (
        <p className="text-[11px] text-rose-300">
          上傳失敗：{failed.error ?? '請再試一次'}
          <button
            type="button"
            onClick={() => uploader.retry(failed.id)}
            className="ml-1.5 underline underline-offset-2"
          >
            重試
          </button>
        </p>
      )}
    </div>
  )
}
