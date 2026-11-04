import crypto from 'node:crypto'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ApiError } from '@/lib/api'
import { env, hasR2Config, missingR2Keys } from '@/lib/env'
import type { AssetKindValue } from '@/lib/constants'

/**
 * Cloudflare R2 over the S3-compatible API.
 *
 * The bucket is private and never publicly listable. Every read and write goes
 * through a short-lived presigned URL that this module mints *after* the caller
 * has already been authorised — presigning is not itself an access check, so
 * callers must verify ownership first (see src/lib/assets.ts).
 */

const MULTIPART_THRESHOLD_BYTES = 64 * 1024 * 1024 // 64 MB
const MULTIPART_PART_SIZE_BYTES = 16 * 1024 * 1024 // 16 MB; R2 minimum is 5 MB

/** R2 refuses a multipart upload with more parts than this. */
const MAX_PARTS = 10_000

/** R2's per-part ceiling is 5 GiB; stay under it. */
const MAX_PART_SIZE_BYTES = 4 * 1024 * 1024 * 1024

let client: S3Client | null = null

/**
 * R2's S3 endpoint, derived from the account id unless overridden.
 *
 * It must NOT include the bucket. Cloudflare's dashboard shows the bucket's
 * S3 URL as `https://<account>.r2.cloudflarestorage.com/<bucket>`, which is
 * the obvious thing to paste — but the SDK appends the bucket itself, so that
 * value silently produces keys under `<bucket>/<bucket>/…`. Fail loudly
 * instead: a misconfiguration that still "works" is far more expensive than
 * one that refuses to start.
 */
function endpoint(): string {
  const e = env()
  const configured = e.R2_ENDPOINT?.trim()
  if (!configured) return `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`

  let parsed: URL
  try {
    parsed = new URL(configured)
  } catch {
    throw new Error(`R2_ENDPOINT 不是合法的網址：${configured}`)
  }

  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error(
      `R2_ENDPOINT 結尾不可包含 bucket 名稱或任何路徑。` +
        `請改成 ${parsed.origin}（目前是 ${configured}）`
    )
  }

  return parsed.origin
}

/** Throws a 503 naming the exact missing variables rather than failing obscurely. */
export function assertR2Configured(): void {
  if (!hasR2Config()) {
    throw ApiError.notConfigured(
      `物件儲存尚未設定，缺少環境變數：${missingR2Keys().join(', ')}。請參考 docs/ENVIRONMENT.md`,
      { missing: missingR2Keys() }
    )
  }
}

export function r2(): S3Client {
  assertR2Configured()
  if (client) return client

  const e = env()
  client = new S3Client({
    // R2 ignores the region but the SDK requires one.
    region: 'auto',
    endpoint: endpoint(),
    credentials: {
      accessKeyId: e.R2_ACCESS_KEY_ID!,
      secretAccessKey: e.R2_SECRET_ACCESS_KEY!,
    },
  })
  return client
}

function bucket(): string {
  return env().R2_BUCKET!
}

function ttl(): number {
  return env().PRESIGN_TTL_SECONDS
}

/** Folder segment per asset kind, so the bucket stays browsable in the dashboard. */
const KIND_FOLDER: Record<AssetKindValue, string> = {
  IMAGE: 'image',
  VIDEO: 'video',
  MUSIC: 'music',
  VOICE: 'voice',
  SFX: 'sfx',
  NOVEL_ATTACHMENT: 'novel',
  STICKER: 'sticker',
  DOC: 'doc',
  OTHER: 'other',
}

/**
 * Builds the object key.
 *
 * The bucket is browsed by humans — when something looks wrong, the R2 console
 * is where you go — so the layout has to answer "what is this" without the
 * database:
 *
 *   projects/<projectId>/originals/image/ep001/<uuid>__市集-概念圖.png
 *   projects/<projectId>/originals/music/_project/<uuid>__主題曲.mp3
 *   projects/<projectId>/derived/preview/<uuid>.webp
 *
 * - `originals` vs `derived` keeps masters apart from things a machine can
 *   regenerate. Previously `preview/` sat beside `image/` and `video/`, which
 *   made it look like another kind of asset.
 * - The episode folder matters at this scale: 120 episodes of stills in one
 *   flat `image/` folder is not a folder, it is a haystack. Assets with no
 *   episode go to `_project`, which sorts to the top.
 * - The UUID still comes first and is still what guarantees uniqueness. The
 *   readable part is a *suffix*, sanitised, and never read back — the
 *   authoritative name remains `assets.name`.
 *
 * Keys are immutable once written: the database points at them, and renaming
 * an object in S3 means copy-and-delete. Changing this function only affects
 * new uploads, which is why old keys in other shapes keep working.
 */
export function buildObjectKey(input: {
  projectId: string
  kind: AssetKindValue
  filename: string
  /** Groups the file under its episode when known. */
  episodeNumber?: number | null
}): string {
  const ext = extensionOf(input.filename)
  const folder = KIND_FOLDER[input.kind] ?? 'other'
  const scope =
    input.episodeNumber != null
      ? `ep${String(input.episodeNumber).padStart(3, '0')}`
      : '_project'

  const label = slugForKey(input.filename)
  const suffix = label ? `__${label}` : ''

  return `projects/${input.projectId}/originals/${folder}/${scope}/${crypto.randomUUID()}${suffix}${ext}`
}

/** Where a derived file lives. Never mixed in with the originals. */
export function buildDerivedKey(input: {
  projectId: string
  kind: 'preview' | 'waveform'
  extension: string
}): string {
  return `projects/${input.projectId}/derived/${input.kind}/${crypto.randomUUID()}${input.extension}`
}

/**
 * A readable, harmless fragment of the original filename.
 *
 * Everything that could make a key dangerous is removed rather than escaped:
 * no slashes, no dots, no control characters, no leading dashes. CJK is kept —
 * the files here are named in Chinese, and a key of nothing but hyphens would
 * defeat the point of putting a name in at all. S3 keys are UTF-8 and the SDK
 * percent-encodes them when signing.
 */
export function slugForKey(filename: string): string {
  const base = filename.replace(/\.[A-Za-z0-9]{1,12}$/, '')

  return base
    .normalize('NFKC')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
}

/** Lower-cased extension including the dot, or '' when there isn't a safe one. */
export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(filename.trim())
  return match ? `.${match[1]!.toLowerCase()}` : ''
}

export function shouldUseMultipart(sizeBytes: number): boolean {
  return sizeBytes > MULTIPART_THRESHOLD_BYTES
}

/**
 * Part size and count for a multipart upload.
 *
 * The part size scales with the file. A fixed 16 MB part would cap any upload
 * at 160 GB (10,000 × 16 MB) — not by refusing it, which would at least be
 * visible, but by producing more parts than R2 accepts and failing somewhere
 * in the middle of a long upload.
 *
 * Small files keep 16 MB parts: more, smaller parts mean a failed part costs
 * less to retry, which matters on a home connection.
 */
export function planParts(sizeBytes: number): { partSize: number; totalParts: number } {
  const needed = Math.ceil(sizeBytes / MAX_PARTS)

  // Round up to a whole MB so the numbers stay legible in logs and progress.
  const megabyte = 1024 * 1024
  const scaled = Math.ceil(needed / megabyte) * megabyte

  const partSize = Math.min(
    Math.max(MULTIPART_PART_SIZE_BYTES, scaled),
    MAX_PART_SIZE_BYTES
  )

  return { partSize, totalParts: Math.max(1, Math.ceil(sizeBytes / partSize)) }
}

/** Presigned PUT for a single-request upload. */
export async function presignPut(params: {
  objectKey: string
  contentType: string
  contentLength?: number
}): Promise<{ url: string; expiresInSec: number }> {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: params.objectKey,
    ContentType: params.contentType || 'application/octet-stream',
    ...(params.contentLength ? { ContentLength: params.contentLength } : {}),
  })

  const url = await getSignedUrl(r2(), command, { expiresIn: ttl() })
  return { url, expiresInSec: ttl() }
}

/** Presigned GET, used by /api/files/[assetId] to redirect the browser. */
export async function presignGet(params: {
  objectKey: string
  /** Sets Content-Disposition so a download saves under the original name. */
  downloadName?: string
}): Promise<{ url: string; expiresInSec: number }> {
  const command = new GetObjectCommand({
    Bucket: bucket(),
    Key: params.objectKey,
    ...(params.downloadName
      ? {
          ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(
            params.downloadName
          )}`,
        }
      : {}),
  })

  const url = await getSignedUrl(r2(), command, { expiresIn: ttl() })
  return { url, expiresInSec: ttl() }
}

export async function startMultipart(params: {
  objectKey: string
  contentType: string
}): Promise<{ uploadId: string }> {
  const out = await r2().send(
    new CreateMultipartUploadCommand({
      Bucket: bucket(),
      Key: params.objectKey,
      ContentType: params.contentType || 'application/octet-stream',
    })
  )

  if (!out.UploadId) throw new Error('R2 did not return an UploadId')
  return { uploadId: out.UploadId }
}

/** One presigned URL per part, so the browser can upload parts in parallel. */
export async function presignParts(params: {
  objectKey: string
  uploadId: string
  partNumbers: number[]
}): Promise<{ partNumber: number; url: string }[]> {
  const s3 = r2()
  return Promise.all(
    params.partNumbers.map(async (partNumber) => {
      const url = await getSignedUrl(
        s3,
        new UploadPartCommand({
          Bucket: bucket(),
          Key: params.objectKey,
          UploadId: params.uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: ttl() }
      )
      return { partNumber, url }
    })
  )
}

export type CompletedPart = { partNumber: number; etag: string }

export async function completeMultipart(params: {
  objectKey: string
  uploadId: string
  parts: CompletedPart[]
}): Promise<void> {
  // R2 requires parts in ascending PartNumber order.
  const ordered = [...params.parts].sort((a, b) => a.partNumber - b.partNumber)

  await r2().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: params.objectKey,
      UploadId: params.uploadId,
      MultipartUpload: {
        Parts: ordered.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    })
  )
}

export async function abortMultipart(params: {
  objectKey: string
  uploadId: string
}): Promise<void> {
  await r2().send(
    new AbortMultipartUploadCommand({
      Bucket: bucket(),
      Key: params.objectKey,
      UploadId: params.uploadId,
    })
  )
}

/** Confirms the object landed and reports its real size and type. */
export async function headObject(objectKey: string): Promise<{
  sizeBytes: number
  mimeType: string
  etag: string
} | null> {
  try {
    const out = await r2().send(new HeadObjectCommand({ Bucket: bucket(), Key: objectKey }))
    return {
      sizeBytes: out.ContentLength ?? 0,
      mimeType: out.ContentType ?? '',
      etag: (out.ETag ?? '').replaceAll('"', ''),
    }
  } catch {
    return null
  }
}

/**
 * Reads a small object's bytes on the server.
 *
 * Only for things measured in kilobytes — waveform peaks, and nothing else so
 * far. Audio and video are presigned and fetched by the browser directly;
 * pulling a 50 MB file through a function would pay for the bandwidth twice
 * and still be slower.
 *
 * Returns null when the object is gone, which the caller treats as "no
 * waveform" rather than an error.
 */
export async function getObjectText(objectKey: string): Promise<string | null> {
  try {
    const out = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: objectKey }))
    const body = out.Body
    if (!body) return null
    return await body.transformToString('utf-8')
  } catch {
    return null
  }
}

/**
 * Writes bytes straight from the server (Z129).
 *
 * Every other write in this file hands the browser a presigned URL, because
 * every other write is a person uploading a file they chose. Synthesised
 * audio never exists in a browser — the worker holds the bytes — so a
 * presigned round trip would be the server uploading to itself.
 */
export async function putObject(input: {
  objectKey: string
  body: Buffer
  contentType: string
}): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.length,
    })
  )
}

/** The raw bytes. `getObjectText` is the same thing for text. */
export async function getObjectBytes(objectKey: string): Promise<Buffer | null> {
  try {
    const out = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: objectKey }))
    if (!out.Body) return null
    return Buffer.from(await out.Body.transformToByteArray())
  } catch {
    return null
  }
}

export async function deleteObject(objectKey: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: objectKey }))
}

export const R2_LIMITS = {
  multipartThresholdBytes: MULTIPART_THRESHOLD_BYTES,
  partSizeBytes: MULTIPART_PART_SIZE_BYTES,
  maxParts: MAX_PARTS,
  maxPartSizeBytes: MAX_PART_SIZE_BYTES,
} as const
