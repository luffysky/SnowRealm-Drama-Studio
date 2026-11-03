'use client'

import { useCallback, useRef, useState } from 'react'
import type { AssetKindValue } from '@/lib/constants'
import { apiFetch } from '@/lib/client-fetch'
import { captureVideoPoster, computeWaveform } from '@/lib/audio-waveform'
import { makeImagePreview } from '@/lib/image-preview'

/**
 * Browser-side upload driver.
 *
 * The bytes go straight from the browser to R2 using the presigned URL the
 * server issues, so a 1 GB video never passes through a serverless function.
 * Large files are uploaded part by part; a part that fails is re-presigned and
 * retried individually rather than restarting the whole file.
 */

export type UploadItemStatus =
  | 'queued'
  | 'preparing'
  | 'uploading'
  | 'finalising'
  | 'done'
  | 'failed'
  | 'cancelled'

export type UploadItem = {
  /** Client-side id; stable across retries. */
  id: string
  file: File
  kind: AssetKindValue
  status: UploadItemStatus
  /** 0..1 */
  progress: number
  error?: string
  assetId?: string
  uploadSessionId?: string
  /** Incremented on each manual retry. */
  attempt: number
}

type BeginResponse = {
  assetId: string
  uploadSessionId: string
  objectKey: string
  multipart: boolean
  url?: string
  uploadId?: string
  partSizeBytes?: number
  totalParts?: number
}

const MAX_PART_ATTEMPTS = 3

export type UseUploaderOptions = {
  projectId: string
  episodeId?: string | null
  linkTo?: { entityType: string; entityId: string; slot?: string }
  onComplete?: (assetId: string, file: File) => void
}

export function useUploader(options: UseUploaderOptions) {
  const [items, setItems] = useState<UploadItem[]>([])
  const aborters = useRef(new Map<string, AbortController>())

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...changes } : item))
    )
  }, [])

  const upload = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController()
      aborters.current.set(item.id, controller)

      try {
        patch(item.id, { status: 'preparing', progress: 0, error: undefined })

        const beginResponse = await apiFetch('/api/uploads', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            projectId: options.projectId,
            episodeId: options.episodeId ?? null,
            kind: item.kind,
            filename: item.file.name,
            contentType: item.file.type,
            sizeBytes: item.file.size,
            ...(options.linkTo ? { linkTo: options.linkTo } : {}),
          }),
        })

        if (!beginResponse.ok) {
          throw new Error(await readError(beginResponse))
        }

        const begin = (await beginResponse.json()) as BeginResponse
        patch(item.id, {
          status: 'uploading',
          assetId: begin.assetId,
          uploadSessionId: begin.uploadSessionId,
        })

        let parts: { partNumber: number; etag: string }[] | undefined

        if (begin.multipart) {
          parts = await uploadInParts({
            file: item.file,
            uploadSessionId: begin.uploadSessionId,
            partSizeBytes: begin.partSizeBytes ?? 16 * 1024 * 1024,
            totalParts: begin.totalParts ?? 1,
            signal: controller.signal,
            onProgress: (fraction) => patch(item.id, { progress: fraction }),
          })
        } else {
          if (!begin.url) throw new Error('伺服器未提供上傳網址')
          await putWithProgress({
            url: begin.url,
            body: item.file,
            contentType: item.file.type,
            signal: controller.signal,
            onProgress: (fraction) => patch(item.id, { progress: fraction }),
          })
        }

        patch(item.id, { status: 'finalising', progress: 1 })

        const completeResponse = await apiFetch('/api/uploads/complete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            uploadSessionId: begin.uploadSessionId,
            ...(parts ? { parts } : {}),
          }),
        })

        if (!completeResponse.ok) {
          throw new Error(await readError(completeResponse))
        }

        patch(item.id, { status: 'done', progress: 1 })
        options.onComplete?.(begin.assetId, item.file)

        /*
         * The derived file, after the master is safely stored
         * (`docs/STORAGE.md`). Deliberately not awaited into the upload's
         * status: the file is already uploaded, and a derived file that fails
         * is a slower grid or a missing waveform, not a lost asset. Hence the
         * swallowed error — the master is unaffected either way.
         */
        void uploadDerived(begin.assetId, item.kind, item.file).catch(() => {})
      } catch (error) {
        if (controller.signal.aborted) {
          patch(item.id, { status: 'cancelled' })
        } else {
          patch(item.id, {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      } finally {
        aborters.current.delete(item.id)
      }
    },
    [options, patch]
  )

  const enqueue = useCallback(
    (files: File[], kind: AssetKindValue) => {
      const newItems: UploadItem[] = files.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        kind,
        status: 'queued',
        progress: 0,
        attempt: 1,
      }))

      setItems((current) => [...current, ...newItems])
      for (const item of newItems) void upload(item)

      return newItems.map((i) => i.id)
    },
    [upload]
  )

  const retry = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id)
      if (!item) return
      const next = { ...item, attempt: item.attempt + 1 }
      patch(id, { attempt: next.attempt })
      void upload(next)
    },
    [items, patch, upload]
  )

  const cancel = useCallback(
    async (id: string) => {
      aborters.current.get(id)?.abort()

      const item = items.find((i) => i.id === id)
      if (item?.uploadSessionId) {
        // Tell R2 to drop the partial multipart upload so it is not billed.
        await apiFetch('/api/uploads/abort', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ uploadSessionId: item.uploadSessionId }),
        }).catch(() => {})
      }

      patch(id, { status: 'cancelled' })
    },
    [items, patch]
  )

  const clearFinished = useCallback(() => {
    setItems((current) => current.filter((i) => i.status !== 'done' && i.status !== 'cancelled'))
  }, [])

  return {
    items,
    enqueue,
    retry,
    cancel,
    clearFinished,
    /** Counts for the queue dialog's tab badges. */
    counts: {
      active: items.filter((i) =>
        ['queued', 'preparing', 'uploading', 'finalising'].includes(i.status)
      ).length,
      failed: items.filter((i) => i.status === 'failed').length,
      done: items.filter((i) => i.status === 'done').length,
    },
  }
}

/**
 * Builds and stores whatever derived file this kind of asset gets.
 *
 * - image  -> a compressed copy, so grids do not pull full-size originals
 * - video  -> a poster frame, for the same reason
 * - audio  -> waveform peaks, so the player draws without decoding the file
 *
 * Never throws to the caller: every outcome short of success is "no derived
 * file", and every reader falls back on its own.
 */
async function uploadDerived(
  assetId: string,
  kind: AssetKindValue,
  file: File
): Promise<void> {
  const derived = await buildDerived(kind, file)
  if (!derived) return

  const begin = await apiFetch(`/api/assets/${assetId}/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contentType: derived.blob.type,
      sizeBytes: derived.blob.size,
      ...(derived.width !== undefined ? { width: derived.width } : {}),
      ...(derived.height !== undefined ? { height: derived.height } : {}),
      params: derived.params,
    }),
  })
  if (!begin.ok) return

  const { variantId, url } = (await begin.json()) as { variantId: string; url: string }

  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': derived.blob.type },
    body: derived.blob,
  })
  if (!put.ok) return

  await apiFetch(`/api/assets/${assetId}/preview`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ variantId }),
  })
}

type Derived = {
  blob: Blob
  width?: number
  height?: number
  params: Record<string, unknown>
}

async function buildDerived(kind: AssetKindValue, file: File): Promise<Derived | null> {
  if (kind === 'IMAGE' || kind === 'STICKER') {
    const preview = await makeImagePreview(file)
    return preview
      ? {
          blob: preview.blob,
          width: preview.width,
          height: preview.height,
          params: preview.params,
        }
      : null
  }

  if (kind === 'VIDEO') {
    const poster = await captureVideoPoster(file)
    return poster
      ? { blob: poster, params: { derivedFrom: 'video', sourceType: file.type } }
      : null
  }

  if (kind === 'MUSIC' || kind === 'SFX' || kind === 'VOICE') {
    const waveform = await computeWaveform(file)
    if (!waveform) return null

    /*
     * Stored as JSON rather than a rendered image: the player draws it at
     * whatever width it has, and a picture of a waveform cannot be re-scaled
     * or re-coloured without looking wrong.
     */
    return {
      blob: new Blob([JSON.stringify(waveform)], { type: 'application/json' }),
      params: {
        peaks: waveform.peaks.length,
        durationSec: Number(waveform.durationSec.toFixed(3)),
        sampleRate: waveform.sampleRate,
        channels: waveform.channels,
      },
    }
  }

  return null
}

async function uploadInParts(input: {
  file: File
  uploadSessionId: string
  partSizeBytes: number
  totalParts: number
  signal: AbortSignal
  onProgress: (fraction: number) => void
}): Promise<{ partNumber: number; etag: string }[]> {
  const partNumbers = Array.from({ length: input.totalParts }, (_, i) => i + 1)

  const presignResponse = await apiFetch('/api/uploads/parts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({ uploadSessionId: input.uploadSessionId, partNumbers }),
  })

  if (!presignResponse.ok) throw new Error(await readError(presignResponse))

  const { parts: urls } = (await presignResponse.json()) as {
    parts: { partNumber: number; url: string }[]
  }

  const urlByPart = new Map(urls.map((p) => [p.partNumber, p.url]))
  const completed: { partNumber: number; etag: string }[] = []
  const uploadedBytes = new Array<number>(input.totalParts).fill(0)

  function reportProgress() {
    const total = uploadedBytes.reduce((sum, n) => sum + n, 0)
    input.onProgress(Math.min(total / input.file.size, 1))
  }

  // Sequential: parallel parts on a home connection mostly cause timeouts,
  // and sequential progress is what the queue dialog shows meaningfully.
  for (const partNumber of partNumbers) {
    const start = (partNumber - 1) * input.partSizeBytes
    const end = Math.min(start + input.partSizeBytes, input.file.size)
    const blob = input.file.slice(start, end)

    let etag: string | null = null
    let lastError: unknown

    for (let attempt = 1; attempt <= MAX_PART_ATTEMPTS; attempt++) {
      try {
        let url = urlByPart.get(partNumber)
        if (!url || attempt > 1) {
          // Re-presign on retry: the original URL may have expired.
          const retryResponse = await apiFetch('/api/uploads/parts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            signal: input.signal,
            body: JSON.stringify({
              uploadSessionId: input.uploadSessionId,
              partNumbers: [partNumber],
            }),
          })
          if (!retryResponse.ok) throw new Error(await readError(retryResponse))
          const retryJson = (await retryResponse.json()) as {
            parts: { partNumber: number; url: string }[]
          }
          url = retryJson.parts[0]?.url
        }

        if (!url) throw new Error(`無法取得第 ${partNumber} 段的上傳網址`)

        etag = await putWithProgress({
          url,
          body: blob,
          contentType: '',
          signal: input.signal,
          onProgress: (fraction) => {
            uploadedBytes[partNumber - 1] = fraction * blob.size
            reportProgress()
          },
        })
        break
      } catch (error) {
        if (input.signal.aborted) throw error
        lastError = error
        // Back off before retrying a transient network failure.
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
      }
    }

    if (!etag) {
      throw new Error(
        `第 ${partNumber} 段上傳失敗（已重試 ${MAX_PART_ATTEMPTS} 次）：` +
          (lastError instanceof Error ? lastError.message : String(lastError))
      )
    }

    uploadedBytes[partNumber - 1] = blob.size
    reportProgress()
    completed.push({ partNumber, etag })
  }

  return completed
}

/**
 * XHR rather than fetch: `fetch` gives no upload progress events, and a
 * progress bar is the whole point of the upload queue dialog.
 * Resolves with the ETag, which multipart completion needs.
 */
function putWithProgress(input: {
  url: string
  body: Blob
  contentType: string
  signal: AbortSignal
  onProgress: (fraction: number) => void
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', input.url, true)

    if (input.contentType) {
      xhr.setRequestHeader('Content-Type', input.contentType)
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress(event.loaded / event.total)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // Requires `ExposeHeaders: ["etag"]` in the bucket's CORS policy.
        const etag = xhr.getResponseHeader('ETag') ?? ''
        resolve(etag.replaceAll('"', ''))
      } else {
        reject(new Error(`R2 回應 ${xhr.status}：${xhr.responseText.slice(0, 200)}`))
      }
    }

    xhr.onerror = () =>
      reject(new Error('網路錯誤，或 R2 的 CORS 設定未允許此來源（見 docs/ENVIRONMENT.md §2.4）'))
    xhr.ontimeout = () => reject(new Error('上傳逾時'))

    const onAbort = () => xhr.abort()
    input.signal.addEventListener('abort', onAbort, { once: true })
    xhr.onloadend = () => input.signal.removeEventListener('abort', onAbort)

    xhr.send(input.body)
  })
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    return body.error?.message ?? `請求失敗（${response.status}）`
  } catch {
    return `請求失敗（${response.status}）`
  }
}
