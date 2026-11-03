import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  assetLinks,
  assets,
  assetVariants,
  episodes,
  projects,
  shots,
  uploadSessions,
} from '@/db/schema'
import { ApiError } from '@/lib/api'
import {
  ACCEPTED_MIME_EXACT,
  ACCEPTED_MIME_PREFIXES,
  ASSET_KIND_ACCEPT,
  MAX_UPLOAD_BYTES,
  type AssetKindValue,
} from '@/lib/constants'
import {
  abortMultipart,
  assertR2Configured,
  buildObjectKey,
  completeMultipart,
  deleteObject,
  headObject,
  planParts,
  presignGet,
  presignParts,
  presignPut,
  shouldUseMultipart,
  startMultipart,
  type CompletedPart,
} from '@/lib/r2'
import type { SessionUser } from '@/lib/auth/session'

/**
 * Asset lifecycle. Every function that hands out a presigned URL checks the
 * caller's access to the owning project *first* — a presigned URL is a bearer
 * credential, so minting one is the privileged operation, not using it.
 */

export type AssetRow = typeof assets.$inferSelect

/**
 * Confirms the project exists. Both members can reach every project, so this
 * is an existence check today; it is the single place to add per-project
 * membership if a third account ever appears.
 */
export async function assertProjectAccess(
  projectId: string,
  _user: SessionUser
): Promise<{ id: string; title: string }> {
  const [row] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!row) throw ApiError.notFound('找不到該作品')
  return row
}

/** Loads an asset and checks the caller may reach its project. */
export async function loadAssetForUser(
  assetId: string,
  user: SessionUser
): Promise<AssetRow> {
  const [row] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1)
  if (!row) throw ApiError.notFound('找不到該素材')

  await assertProjectAccess(row.projectId, user)
  return row
}

export function validateUpload(input: {
  kind: AssetKindValue
  contentType: string
  sizeBytes: number
}): void {
  if (input.sizeBytes <= 0) {
    throw ApiError.badRequest('檔案大小必須大於 0')
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw ApiError.badRequest(
      `檔案超過上限 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024)} GB`
    )
  }

  const type = input.contentType.toLowerCase()

  // An empty content type is tolerated; R2 stores octet-stream and the kind
  // still constrains what the UI will render.
  if (!type) return

  const globallyAllowed =
    ACCEPTED_MIME_PREFIXES.some((p) => type.startsWith(p)) ||
    (ACCEPTED_MIME_EXACT as readonly string[]).includes(type)

  if (!globallyAllowed) {
    throw ApiError.badRequest(`不支援的檔案類型：${input.contentType}`)
  }

  const kindAccepts = ASSET_KIND_ACCEPT[input.kind]
  if (kindAccepts.length > 0 && !kindAccepts.some((p) => type.startsWith(p))) {
    throw ApiError.badRequest(`此素材分類不接受 ${input.contentType}`)
  }
}

export type BeginUploadResult = {
  assetId: string
  uploadSessionId: string
  objectKey: string
  multipart: boolean
  expiresInSec: number
  /** Present for a single-PUT upload. */
  url?: string
  /** Present for a multipart upload. */
  uploadId?: string
  partSizeBytes?: number
  totalParts?: number
}

/**
 * Creates the asset row (PENDING) plus an upload session, and returns the
 * presigned destination. The asset only becomes visible to the library once
 * `finishUpload` verifies the bytes actually landed in R2.
 */
export async function beginUpload(input: {
  user: SessionUser
  projectId: string
  episodeId?: string | null
  kind: AssetKindValue
  filename: string
  contentType: string
  sizeBytes: number
  rootAssetId?: string | null
  linkTo?: { entityType: string; entityId: string; slot?: string }
}): Promise<BeginUploadResult> {
  await assertProjectAccess(input.projectId, input.user)
  validateUpload(input)

  // Check storage config *before* writing anything. The rows below are
  // committed before R2 is contacted, so a missing credential discovered later
  // would strand a PENDING asset and upload session that nothing ever cleans up.
  assertR2Configured()

  if (input.episodeId) {
    const [ep] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.id, input.episodeId), eq(episodes.projectId, input.projectId)))
      .limit(1)
    if (!ep) throw ApiError.badRequest('指定的集數不屬於這個作品')
  }

  const objectKey = buildObjectKey({
    projectId: input.projectId,
    kind: input.kind,
    filename: input.filename,
  })

  const version = input.rootAssetId ? await nextVersionFor(input.rootAssetId) : 1
  const multipart = shouldUseMultipart(input.sizeBytes)

  const result = await db.transaction(async (tx) => {
    const [asset] = await tx
      .insert(assets)
      .values({
        projectId: input.projectId,
        episodeId: input.episodeId ?? null,
        kind: input.kind,
        name: input.filename,
        objectKey,
        mimeType: input.contentType,
        sizeBytes: input.sizeBytes,
        version,
        rootAssetId: input.rootAssetId ?? null,
        uploadStatus: 'PENDING',
        uploadedById: input.user.id,
      })
      .returning({ id: assets.id })

    if (!asset) throw new Error('Failed to create asset row')

    const plan = multipart ? planParts(input.sizeBytes) : { partSize: 0, totalParts: 1 }

    const [session] = await tx
      .insert(uploadSessions)
      .values({
        assetId: asset.id,
        objectKey,
        totalBytes: input.sizeBytes,
        partSizeBytes: plan.partSize,
        totalParts: plan.totalParts,
        status: 'PENDING',
        createdById: input.user.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning({ id: uploadSessions.id })

    if (!session) throw new Error('Failed to create upload session')

    if (input.linkTo) {
      await tx.insert(assetLinks).values({
        assetId: asset.id,
        entityType: input.linkTo.entityType,
        entityId: input.linkTo.entityId,
        slot: input.linkTo.slot ?? '',
      })
    }

    return { assetId: asset.id, uploadSessionId: session.id, plan }
  })

  if (!multipart) {
    const { url, expiresInSec } = await presignPut({
      objectKey,
      contentType: input.contentType,
    })
    return {
      assetId: result.assetId,
      uploadSessionId: result.uploadSessionId,
      objectKey,
      multipart: false,
      url,
      expiresInSec,
    }
  }

  const { uploadId } = await startMultipart({ objectKey, contentType: input.contentType })

  await db
    .update(uploadSessions)
    .set({ multipartUploadId: uploadId, status: 'UPLOADING', updatedAt: new Date() })
    .where(eq(uploadSessions.id, result.uploadSessionId))

  return {
    assetId: result.assetId,
    uploadSessionId: result.uploadSessionId,
    objectKey,
    multipart: true,
    uploadId,
    partSizeBytes: result.plan.partSize,
    totalParts: result.plan.totalParts,
    expiresInSec: 0,
  }
}

async function nextVersionFor(rootAssetId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${assets.version}), 0)` })
    .from(assets)
    .where(sql`${assets.rootAssetId} = ${rootAssetId} or ${assets.id} = ${rootAssetId}`)

  return (row?.max ?? 0) + 1
}

/** Issues presigned URLs for a batch of multipart parts, for retry or parallelism. */
export async function presignUploadParts(input: {
  user: SessionUser
  uploadSessionId: string
  partNumbers: number[]
}): Promise<{ partNumber: number; url: string }[]> {
  const session = await loadSessionForUser(input.uploadSessionId, input.user)

  if (!session.multipartUploadId) {
    throw ApiError.badRequest('這不是分段上傳的工作階段')
  }
  if (session.status === 'COMPLETED' || session.status === 'ABORTED') {
    throw ApiError.badRequest('此上傳已結束，無法再取得分段網址')
  }

  const invalid = input.partNumbers.filter((n) => n < 1 || n > session.totalParts)
  if (invalid.length > 0) {
    throw ApiError.badRequest(`分段編號超出範圍：${invalid.join(', ')}`)
  }

  return presignParts({
    objectKey: session.objectKey,
    uploadId: session.multipartUploadId,
    partNumbers: input.partNumbers,
  })
}

async function loadSessionForUser(uploadSessionId: string, user: SessionUser) {
  const [row] = await db
    .select({
      id: uploadSessions.id,
      assetId: uploadSessions.assetId,
      objectKey: uploadSessions.objectKey,
      multipartUploadId: uploadSessions.multipartUploadId,
      totalParts: uploadSessions.totalParts,
      totalBytes: uploadSessions.totalBytes,
      status: uploadSessions.status,
      attemptCount: uploadSessions.attemptCount,
      projectId: assets.projectId,
    })
    .from(uploadSessions)
    .innerJoin(assets, eq(assets.id, uploadSessions.assetId))
    .where(eq(uploadSessions.id, uploadSessionId))
    .limit(1)

  if (!row) throw ApiError.notFound('找不到上傳工作階段')
  await assertProjectAccess(row.projectId, user)
  return row
}

/**
 * Finalises an upload. For multipart this completes the R2 upload; either way
 * it HEADs the object to confirm the bytes are really there before flipping the
 * asset to COMPLETED, so a failed browser upload cannot leave a phantom asset.
 */
export async function finishUpload(input: {
  user: SessionUser
  uploadSessionId: string
  parts?: CompletedPart[]
}): Promise<AssetRow> {
  const session = await loadSessionForUser(input.uploadSessionId, input.user)

  if (session.status === 'COMPLETED') {
    const [existing] = await db.select().from(assets).where(eq(assets.id, session.assetId)).limit(1)
    if (!existing) throw ApiError.notFound('找不到該素材')
    return existing
  }

  if (session.multipartUploadId) {
    if (!input.parts?.length) {
      throw ApiError.badRequest('分段上傳必須提供每個分段的 ETag')
    }
    try {
      await completeMultipart({
        objectKey: session.objectKey,
        uploadId: session.multipartUploadId,
        parts: input.parts,
      })
    } catch (error) {
      await markUploadFailed(session.id, session.assetId, describe(error))
      throw ApiError.badRequest(`分段合併失敗：${describe(error)}`)
    }
  }

  const head = await headObject(session.objectKey)
  if (!head) {
    await markUploadFailed(session.id, session.assetId, '物件不存在於 R2')
    throw ApiError.badRequest('上傳未完成：R2 找不到該物件')
  }

  const [updated] = await db.transaction(async (tx) => {
    await tx
      .update(uploadSessions)
      .set({
        status: 'COMPLETED',
        uploadedBytes: head.sizeBytes,
        completedParts: input.parts ?? [],
        updatedAt: new Date(),
      })
      .where(eq(uploadSessions.id, session.id))

    return tx
      .update(assets)
      .set({
        uploadStatus: 'COMPLETED',
        sizeBytes: head.sizeBytes,
        mimeType: head.mimeType || undefined,
        checksum: head.etag,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, session.assetId))
      .returning()
  })

  if (!updated) throw ApiError.notFound('找不到該素材')
  return updated
}

async function markUploadFailed(sessionId: string, assetId: string, message: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(uploadSessions)
      .set({
        status: 'FAILED',
        lastError: message.slice(0, 500),
        attemptCount: sql`${uploadSessions.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(uploadSessions.id, sessionId))

    await tx
      .update(assets)
      .set({ uploadStatus: 'FAILED', updatedAt: new Date() })
      .where(eq(assets.id, assetId))
  })
}

/** Cancels an in-flight upload and removes the placeholder asset row. */
export async function abortUpload(input: {
  user: SessionUser
  uploadSessionId: string
}): Promise<void> {
  const session = await loadSessionForUser(input.uploadSessionId, input.user)

  if (session.multipartUploadId) {
    try {
      await abortMultipart({
        objectKey: session.objectKey,
        uploadId: session.multipartUploadId,
      })
    } catch (error) {
      // R2 may have expired the upload already; the DB state still matters.
      console.error('[assets] abortMultipart failed:', describe(error))
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(uploadSessions)
      .set({ status: 'ABORTED', updatedAt: new Date() })
      .where(eq(uploadSessions.id, session.id))

    // Only a never-completed asset is removed; a COMPLETED one is real data.
    await tx
      .delete(assets)
      .where(and(eq(assets.id, session.assetId), eq(assets.uploadStatus, 'PENDING')))
  })
}

/**
 * Mints a short-lived download URL. Called by /api/files/[assetId] after the
 * session has been checked, so the private bucket stays private while
 * `<img src>` can point at a stable application URL.
 */
export async function presignAssetDownload(input: {
  user: SessionUser
  assetId: string
  asAttachment?: boolean
  /** Serve the small preview instead of the master, when one exists. */
  preview?: boolean
}): Promise<{ url: string; expiresInSec: number; asset: AssetRow; servedPreview: boolean }> {
  const asset = await loadAssetForUser(input.assetId, input.user)

  if (asset.uploadStatus !== 'COMPLETED') {
    throw ApiError.badRequest('此素材尚未完成上傳')
  }

  /*
   * A preview is an optimisation, never a requirement: an asset uploaded
   * before previews existed, or one whose preview failed, still has to render.
   * So a missing preview silently serves the master rather than 404ing.
   *
   * Never for a download — `?download=1` must hand over the real file.
   */
  if (input.preview && !input.asAttachment) {
    const [variant] = await db
      .select()
      .from(assetVariants)
      .where(
        and(
          eq(assetVariants.assetId, asset.id),
          eq(assetVariants.kind, 'PREVIEW'),
          eq(assetVariants.uploadStatus, 'COMPLETED')
        )
      )
      .limit(1)

    if (variant) {
      const signed = await presignGet({ objectKey: variant.objectKey })
      return { ...signed, asset, servedPreview: true }
    }
  }

  const { url, expiresInSec } = await presignGet({
    objectKey: asset.objectKey,
    ...(input.asAttachment ? { downloadName: asset.name } : {}),
  })

  return { url, expiresInSec, asset, servedPreview: false }
}

/** Deletes the R2 object and the row. OWNER-only; caller checks the permission. */
export type AssetReference = {
  entityType: string
  entityId: string
  slot: string
}

/**
 * Everything still pointing at this asset: explicit `asset_links` rows, later
 * versions in its lineage, and the shot columns that reference it directly.
 */
export async function findAssetReferences(assetId: string): Promise<AssetReference[]> {
  const links = await db
    .select({
      entityType: assetLinks.entityType,
      entityId: assetLinks.entityId,
      slot: assetLinks.slot,
    })
    .from(assetLinks)
    .where(eq(assetLinks.assetId, assetId))

  const versions = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.rootAssetId, assetId))

  const shotRefs = await db
    .select({ id: shots.id })
    .from(shots)
    .where(
      sql`${shots.imageAssetId} = ${assetId}
       or ${shots.videoAssetId} = ${assetId}
       or ${shots.voiceAssetId} = ${assetId}
       or ${shots.refAssetId} = ${assetId}
       or ${shots.firstFrameAssetId} = ${assetId}
       or ${shots.lastFrameAssetId} = ${assetId}`
    )

  return [
    ...links,
    ...versions.map((v) => ({ entityType: 'asset_version', entityId: v.id, slot: '' })),
    ...shotRefs.map((s) => ({ entityType: 'shot', entityId: s.id, slot: '' })),
  ]
}

/**
 * Deletes an asset and its R2 object.
 *
 * Refuses while anything still references the asset. Deleting one database row
 * must never silently strip a still off a shot or orphan a later version of the
 * same image — the caller has to detach the references first, deliberately.
 *
 * OWNER-only; the route checks `asset.delete` before calling.
 */
export async function deleteAsset(input: {
  user: SessionUser
  assetId: string
}): Promise<void> {
  const asset = await loadAssetForUser(input.assetId, input.user)

  const references = await findAssetReferences(asset.id)
  if (references.length > 0) {
    const summary = references
      .slice(0, 5)
      .map((r) => `${r.entityType}${r.slot ? `(${r.slot})` : ''}`)
      .join('、')

    throw ApiError.conflict(
      `這個素材仍被 ${references.length} 處引用（${summary}${references.length > 5 ? ' 等' : ''}），` +
        `請先解除引用再刪除。`,
      { references }
    )
  }

  // Remove the row first: a failed R2 delete leaves a recoverable orphan
  // object, whereas deleting the object first would leave the library pointing
  // at a file that no longer exists.
  await db.delete(assets).where(eq(assets.id, asset.id))

  try {
    await deleteObject(asset.objectKey)
  } catch (error) {
    // The row is already gone; surface it so the object can be swept later.
    console.error(
      `[assets] orphaned R2 object after row delete: ${asset.objectKey} — ${describe(error)}`
    )
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/* -------------------------------------------------------------------------- */
/* Derivatives                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Preview derivatives (`docs/STORAGE.md`).
 *
 * The master is kept exactly as uploaded — it is what gets delivered and
 * re-edited, and a re-encode is not reversible. Alongside it the browser
 * stores a small WebP/AVIF copy, and that is what every grid, card and
 * thumbnail loads.
 *
 * The saving is in what gets *read*, not only in what gets stored: an episode
 * list showing 120 covers used to pull 120 full-size PNGs.
 *
 * Only images get one. Video is already compressed, and re-encoding it in a
 * browser is not practical.
 */

const PREVIEW_MAX_BYTES = 8 * 1024 * 1024

export type VariantRow = typeof assetVariants.$inferSelect

/** Presigns a single PUT for a preview. Previews are small; no multipart. */
export async function beginVariantUpload(input: {
  user: SessionUser
  assetId: string
  contentType: string
  sizeBytes: number
  width?: number | null
  height?: number | null
  params?: Record<string, unknown>
}): Promise<{ variantId: string; url: string; objectKey: string }> {
  assertR2Configured()

  const asset = await loadAssetForUser(input.assetId, input.user)

  if (asset.kind !== 'IMAGE' && asset.kind !== 'STICKER') {
    throw ApiError.badRequest('只有圖片才會產生預覽檔')
  }
  if (!input.contentType.startsWith('image/')) {
    throw ApiError.badRequest('預覽檔必須是圖片')
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > PREVIEW_MAX_BYTES) {
    throw ApiError.badRequest('預覽檔大小不合理')
  }
  /*
   * A "preview" larger than its master is not a preview. This happens with
   * small or already-optimised originals, and storing it would cost space to
   * make things slower.
   */
  if (asset.sizeBytes > 0 && input.sizeBytes >= asset.sizeBytes) {
    throw ApiError.badRequest('預覽檔沒有比原檔小，不值得存')
  }

  const extension = input.contentType === 'image/avif' ? '.avif' : '.webp'
  const objectKey = `projects/${asset.projectId}/preview/${crypto.randomUUID()}${extension}`

  const [variant] = await db
    .insert(assetVariants)
    .values({
      assetId: asset.id,
      kind: 'PREVIEW',
      objectKey,
      mimeType: input.contentType,
      sizeBytes: input.sizeBytes,
      width: input.width ?? null,
      height: input.height ?? null,
      params: input.params ?? null,
      uploadStatus: 'PENDING',
      createdById: input.user.id,
    })
    .onConflictDoUpdate({
      // One preview per asset: regenerating replaces rather than piles up.
      target: [assetVariants.assetId, assetVariants.kind],
      set: {
        objectKey,
        mimeType: input.contentType,
        sizeBytes: input.sizeBytes,
        width: input.width ?? null,
        height: input.height ?? null,
        params: input.params ?? null,
        uploadStatus: 'PENDING',
        createdAt: new Date(),
      },
    })
    .returning()

  if (!variant) throw ApiError.badRequest('無法建立預覽檔紀錄')

  const { url } = await presignPut({ objectKey, contentType: input.contentType })

  return { variantId: variant.id, url, objectKey }
}

/** Confirms the bytes arrived, so nothing ever points at a missing object. */
export async function finishVariantUpload(input: {
  user: SessionUser
  assetId: string
  variantId: string
}): Promise<VariantRow> {
  const asset = await loadAssetForUser(input.assetId, input.user)

  const [variant] = await db
    .select()
    .from(assetVariants)
    .where(and(eq(assetVariants.id, input.variantId), eq(assetVariants.assetId, asset.id)))
    .limit(1)

  if (!variant) throw ApiError.notFound('找不到這個預覽檔')

  const head = await headObject(variant.objectKey)
  if (!head) {
    await db
      .update(assetVariants)
      .set({ uploadStatus: 'FAILED' })
      .where(eq(assetVariants.id, variant.id))
    throw ApiError.badRequest('預覽檔上傳未完成：R2 找不到該物件')
  }

  const [updated] = await db
    .update(assetVariants)
    .set({
      uploadStatus: 'COMPLETED',
      sizeBytes: head.sizeBytes,
      checksum: head.etag,
    })
    .where(eq(assetVariants.id, variant.id))
    .returning()

  if (!updated) throw ApiError.notFound('找不到這個預覽檔')
  return updated
}
