/**
 * URLs for reading a file out of the private bucket.
 *
 * The bucket has no public access, so every read goes through
 * `/api/files/[assetId]`, which checks the session and redirects to a
 * short-lived presigned URL. These helpers exist so the `?variant=preview`
 * decision is made in one place rather than in ten template literals — the
 * kind of thing that is easy to add and impossible to audit afterwards.
 */

/** The master: the file exactly as uploaded. Use for delivery and editing. */
export function assetUrl(assetId: string): string {
  return `/api/files/${assetId}`
}

/**
 * The compressed copy (`docs/STORAGE.md`). Use for every grid, card and
 * thumbnail. Falls back to the master server-side when no preview exists, so
 * this is always safe.
 */
export function assetPreviewUrl(assetId: string): string {
  return `/api/files/${assetId}?variant=preview`
}

/** Saves under the original filename. Always the master, never a preview. */
export function assetDownloadUrl(assetId: string): string {
  return `/api/files/${assetId}?download=1`
}
