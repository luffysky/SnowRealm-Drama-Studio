'use client'

import { Check, Clapperboard, Film, Loader2, Trash2, Upload } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useUploader } from '@/components/studio/useUploader'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { assetUrl } from '@/lib/asset-url'
import { acceptFor, familyOf, resolveMimeType } from '@/lib/media-types'
import { apiFetch, readApiError } from '@/lib/client-fetch'
import { cn, formatDurationZh } from '@/lib/utils'

/**
 * 本集成片 (Z1).
 *
 * Being a video attached to the episode is not enough to identify the finished
 * cut — storyboard previews, source clips and rejected takes all satisfy that.
 * This is where one of them is named as *the* cut.
 *
 * Switching cuts never deletes the previous file. A re-edit is uploaded as a
 * new version and the pointer moves, so a released episode stays traceable to
 * the exact file that shipped, and a bad swap is one click to undo.
 */

export type CutRow = {
  assetId: string
  name: string
  title: string
  sizeBytes: number
  durationSec: number | null
  version: number
  uploadedAt: string
}

export function FinalCutPanel({
  projectId,
  episodeId,
  canWrite,
}: {
  projectId: string
  episodeId: string
  canWrite: boolean
}) {
  const router = useRouter()
  const toast = useToast()

  const [current, setCurrent] = useState<CutRow | null>(null)
  const [history, setHistory] = useState<CutRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [rejected, setRejected] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/projects/${projectId}/episodes/${episodeId}/final-cut`,
          signal ? { signal } : {}
        )
        if (!response.ok) throw new Error(await readApiError(response))

        const body = (await response.json()) as { current: CutRow | null; history: CutRow[] }
        setCurrent(body.current)
        setHistory(body.history)
      } catch {
        // A panel that cannot load its list is still usable for uploading.
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [projectId, episodeId]
  )

  useEffect(() => {
    /*
     * The fetch is the external system and the state is set in its callback,
     * which is the shape `react-hooks/set-state-in-effect` asks for — calling
     * an async function straight from the effect body reads as a synchronous
     * setState to the rule, even though it is not.
     */
    const controller = new AbortController()
    void (async () => {
      await load(controller.signal)
    })()
    return () => controller.abort()
  }, [load])

  const uploader = useUploader({
    projectId,
    episodeId,
    onComplete: (assetId) => void choose(assetId),
  })

  const active = uploader.items.find((item) =>
    ['queued', 'preparing', 'uploading', 'finalising'].includes(item.status)
  )

  async function choose(assetId: string | null) {
    setBusy(true)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/episodes/${episodeId}/final-cut`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ assetId }),
        }
      )
      if (!response.ok) throw new Error(await readApiError(response))

      await load()
      router.refresh()
      toast.success(assetId ? '已設定本集成片' : '已移除本集成片')
    } catch (error) {
      toast.error('設定失敗', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  function accept(files: FileList | File[] | null) {
    setRejected(null)
    const file = Array.from(files ?? [])[0]
    if (!file) return

    /*
     * Resolved the same way the server does. Checking `file.type` alone would
     * reject a .mkv or .avi that Windows reports as octet-stream — the file is
     * fine, the operating system simply did not know what it was.
     */
    if (familyOf(resolveMimeType(file.name, file.type)) !== 'video') {
      setRejected(`「${file.name}」不是影片檔`)
      return
    }

    uploader.enqueue([file], 'VIDEO')
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files)
  }

  return (
    <section className="flex flex-col gap-2">
      <h4 className="flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
        <Clapperboard aria-hidden className="size-3.5 text-accent-400" />
        本集成片
      </h4>

      {loading ? (
        <p className="rounded-lg bg-stage-900 px-3 py-4 text-center text-[11px] text-ink-600">
          讀取中…
        </p>
      ) : current ? (
        <div className="flex flex-col gap-2">
            <video
            key={current.assetId}
            src={assetUrl(current.assetId)}
            controls
            preload="metadata"
            className="w-full rounded-lg bg-stage-950 ring-1 ring-stage-700"
          />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-600">
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
              v{current.version}
            </span>
            <span className="min-w-0 truncate text-ink-400">
              {current.title || current.name}
            </span>
            {current.durationSec !== null && <span>{formatDurationZh(current.durationSec)}</span>}
            <span>{formatBytes(current.sizeBytes)}</span>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-lg px-3 py-6 text-center ring-1 ring-inset transition-colors',
            dragging ? 'bg-accent-600/10 ring-accent-500/60' : 'bg-stage-900 ring-stage-700'
          )}
        >
          <Film aria-hidden className="size-5 text-ink-700" />
          <p className="text-[11px] text-ink-500">尚未指定成片</p>
          <p className="text-[10px] leading-relaxed text-ink-700">
            上傳影片，或從下方已上傳的影片中挑一支。
          </p>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={<Upload aria-hidden className="size-3.5" />}
            onClick={() => inputRef.current?.click()}
            disabled={Boolean(active) || busy}
          >
            {current ? '上傳新版本' : '上傳成片'}
          </Button>

          {current && (
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Trash2 aria-hidden className="size-3.5" />}
              onClick={() => void choose(null)}
              disabled={busy}
            >
              取消指定
            </Button>
          )}

          {active && (
            <span className="flex items-center gap-1.5 text-[10px] text-ink-500">
              <Loader2 aria-hidden className="size-3 animate-spin" />
              上傳中 {Math.round(active.progress * 100)}%
            </span>
          )}
          {busy && <Loader2 aria-hidden className="size-3 animate-spin text-ink-500" />}
        </div>
      )}

      {rejected && (
        <p role="alert" className="text-[10px] text-rose-400">
          {rejected}
        </p>
      )}

      {history.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] text-ink-600">
            其他版本 {history.length}
            <span className="ml-1">——切換不會刪除任何一版</span>
          </p>

          <ul className="flex flex-col gap-0.5">
            {history.map((row) => (
              <li
                key={row.assetId}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px] hover:bg-stage-800/60"
              >
                <span className="shrink-0 rounded bg-stage-800 px-1 py-0.5 text-ink-500 ring-1 ring-inset ring-stage-700">
                  v{row.version}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-400">
                  {row.title || row.name}
                </span>
                {row.durationSec !== null && (
                  <span className="shrink-0 text-ink-600">
                    {formatDurationZh(row.durationSec)}
                  </span>
                )}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => void choose(row.assetId)}
                    disabled={busy}
                    className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-ink-500 transition-colors hover:bg-stage-700 hover:text-ink-100 disabled:opacity-50"
                  >
                    <Check aria-hidden className="size-3" />
                    設為成片
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={acceptFor('video')}
        className="hidden"
        onChange={(event) => {
          accept(event.target.files)
          // Reset, so picking the same file again still fires a change event.
          event.target.value = ''
        }}
      />
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
