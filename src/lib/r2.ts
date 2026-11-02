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

let client: S3Client | null = null

/** R2's S3 endpoint is derived from the account id unless overridden. */
function endpoint(): string {
  const e = env()
  return e.R2_ENDPOINT || `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
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
 * Builds the object key. The filename never appears in the key — only a UUID —
 * so a key can never collide, leak a title, or carry a path traversal. The
 * original name is kept in the `assets.name` column instead.
 */
export function buildObjectKey(input: {
  projectId: string
  kind: AssetKindValue
  filename: string
}): string {
  const ext = extensionOf(input.filename)
  const folder = KIND_FOLDER[input.kind] ?? 'other'
  return `projects/${input.projectId}/${folder}/${crypto.randomUUID()}${ext}`
}

/** Lower-cased extension including the dot, or '' when there isn't a safe one. */
export function extensionOf(filename: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(filename.trim())
  return match ? `.${match[1]!.toLowerCase()}` : ''
}

export function shouldUseMultipart(sizeBytes: number): boolean {
  return sizeBytes > MULTIPART_THRESHOLD_BYTES
}

export function planParts(sizeBytes: number): { partSize: number; totalParts: number } {
  const partSize = MULTIPART_PART_SIZE_BYTES
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

export async function deleteObject(objectKey: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: objectKey }))
}

export const R2_LIMITS = {
  multipartThresholdBytes: MULTIPART_THRESHOLD_BYTES,
  partSizeBytes: MULTIPART_PART_SIZE_BYTES,
} as const
