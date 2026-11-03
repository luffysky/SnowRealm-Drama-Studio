'use client'

/**
 * Makes a small copy of an image, in the browser (`docs/STORAGE.md`).
 *
 * The master is uploaded untouched; this is the copy that every grid, card and
 * thumbnail actually loads. An AI-generated 1920×1080 PNG is around 2.5 MB and
 * comes back from here at roughly 150–300 KB — a difference you can see in how
 * fast the episode list paints, not only on the storage bill.
 *
 * Done in the browser because the browser already holds the decoded bitmap. A
 * serverless function would have to download the master, decode and re-encode
 * it inside a 60-second budget to reach the same result.
 *
 * Nothing here is allowed to fail an upload. Every path returns null instead of
 * throwing: a missing preview costs a little speed, a thrown error costs the
 * file.
 */

/** Below this, a preview is not worth a second object and a second request. */
const MIN_SOURCE_BYTES = 200 * 1024

/** Longest edge. Bigger than any grid tile, small enough to stay cheap. */
const MAX_EDGE = 1600

/**
 * WebP at 0.82 is visually indistinguishable from the source at normal
 * viewing sizes while being several times smaller. AVIF is smaller still, but
 * encoding support in `canvas.toBlob` is uneven, so it is attempted first and
 * quietly falls back.
 */
const QUALITY = 0.82

export type PreviewResult = {
  blob: Blob
  width: number
  height: number
  params: Record<string, unknown>
}

export async function makeImagePreview(file: File): Promise<PreviewResult | null> {
  if (typeof window === 'undefined') return null
  if (!file.type.startsWith('image/')) return null

  // An SVG is already tiny and re-encoding it to a bitmap loses the point.
  if (file.type === 'image/svg+xml') return null
  if (file.size < MIN_SOURCE_BYTES) return null

  let bitmap: ImageBitmap | null = null

  try {
    bitmap = await createImageBitmap(file)

    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return null

    context.drawImage(bitmap, 0, 0, width, height)

    const encoded = await encode(canvas)
    if (!encoded) return null

    /*
     * A preview that is not smaller than its master is not a preview. Small
     * or already-optimised originals land here, and storing one would cost
     * space to make things slower. The server rejects it too; this just saves
     * the round trip.
     */
    if (encoded.blob.size >= file.size) return null

    return {
      blob: encoded.blob,
      width,
      height,
      params: {
        encoder: encoded.type,
        quality: QUALITY,
        sourceBytes: file.size,
        sourceType: file.type,
        scale: Number(scale.toFixed(4)),
      },
    }
  } catch {
    // A decode failure (corrupt file, unsupported codec, memory) must not stop
    // the master from uploading.
    return null
  } finally {
    bitmap?.close()
  }
}

/** AVIF when the browser can encode it, WebP otherwise. */
async function encode(canvas: HTMLCanvasElement): Promise<{ blob: Blob; type: string } | null> {
  for (const type of ['image/avif', 'image/webp'] as const) {
    const blob = await toBlob(canvas, type)
    // Browsers that cannot encode a type silently produce PNG instead, so the
    // result's own type is the only reliable check.
    if (blob && blob.type === type) return { blob, type }
  }
  return null
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, QUALITY)
  })
}
