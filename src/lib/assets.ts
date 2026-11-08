import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  assetLinks,
  assets,
  assetVariants,
  characters,
  documents,
  episodes,
  expenses,
  projects,
  shots,
  tasks,
  uploadSessions,
  users,
  worldEntries,
} from '@/db/schema'
import { ApiError } from '@/lib/api'
import {
  ACCEPTED_MIME_EXACT,
  ACCEPTED_MIME_PREFIXES,
  ASSET_KIND_ACCEPT,
  ASSET_KINDS,
  MAX_UPLOAD_BYTES,
  type AssetKindValue,
} from '@/lib/constants'
import {
  abortMultipart,
  assertR2Configured,
  buildDerivedKey,
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
import { resolveMimeType } from '@/lib/media-types'
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
  /** Used to recover a type the browser could not supply. */
  filename?: string
}): void {
  if (input.sizeBytes <= 0) {
    throw ApiError.badRequest('檔案大小必須大於 0')
  }
  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw ApiError.badRequest(
      `檔案超過上限 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024)} GB`
    )
  }

  /*
   * `File.type` cannot be trusted for media. It comes from the OS registry,
   * so on Windows a .mkv, .flac or .avi commonly arrives as
   * `application/octet-stream` — or empty — purely because no application
   * claimed the extension. Rejecting those turns an ordinary video into
   * 「不支援的檔案類型」 with nothing on screen to explain why, so the
   * extension gets a say before anything is refused.
   */
  const type = resolveMimeType(input.filename ?? '', input.contentType)

  // Still unknown after both: stored as octet-stream, and the kind continues
  // to constrain what the UI renders.
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

/** 一集做好的有聲書。 */
export type EpisodeAudiobook = {
  assetId: string
  title: string
  durationSec: number | null
  sizeBytes: number
  createdAt: Date
}

/**
 * 每一集最新的那一份有聲書 (Z147).
 *
 * 讀的是**素材**不是任務：任務跑完就結束了，而檔案留著。一集可能做過好幾次
 * （換了音色重做），所以取最新的那一個。
 *
 * 有聲書是 `kind = 'VOICE'` 加上 `episode_id`——**沒有 `AUDIOBOOK` 這個
 * kind**，雖然 `tts/job.ts` 裡有一個叫那個名字的型別（那是任務請求的判別標
 * 籤，不是素材分類）。這兩個名字長得太像，所以這一支存在的理由有一半是：讓
 * 「這一集有沒有聲音」只有一個定義，而不是每個呼叫端自己猜一次。
 *
 * **光靠 `kind` 與 `episode_id` 不夠，而我第一版以為夠。**
 *
 * `origin = 'LIBRARY'` 擋掉聊天室的語音訊息（`kind` 也是 VOICE，Z116）。但真
 * 正會混進來的不是聊天室，是**集數素材頁**：`EpisodeAssetBrowser` 的可上傳清
 * 單裡就有 VOICE，而它的上傳帶著 `episodeId`、origin 也是 LIBRARY。於是在那
 * 一頁傳一段三秒的參考音，它就符合全部條件——而這支取的是**最新的那一個**，
 * 所以它會把真正的成品頂掉：閱讀器顯示三秒、下載鍵指向那段參考音、總覽也把它
 * 算成「做出有聲書」。
 *
 * 所以改成認 `generation_meta`：合成出來的那一筆自己說自己是什麼
 * （`tts/job.ts`），既有的兩筆由 `drizzle/0034_audiobook_marker.sql` 從
 * `ai_jobs.result.assetId` 補標記。查詢裡疊更多條件只是換一種猜法——檔名、標
 * 題、時長，每一種都會在某個正常用法上猜錯。
 */
export async function audiobooksByEpisode(
  projectId: string
): Promise<Map<string, EpisodeAudiobook>> {
  const rows = await db
    .select({
      assetId: assets.id,
      episodeId: assets.episodeId,
      title: assets.title,
      durationSec: assets.durationSec,
      sizeBytes: assets.sizeBytes,
      createdAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.projectId, projectId),
        eq(assets.kind, 'VOICE'),
        eq(assets.origin, 'LIBRARY'),
        sql`${assets.generationMeta} ->> 'kind' = 'AUDIOBOOK'`,
        eq(assets.uploadStatus, 'COMPLETED'),
        isNull(assets.deletedAt)
      )
    )

  const newest = new Map<string, EpisodeAudiobook>()
  for (const row of rows) {
    if (!row.episodeId) continue
    const existing = newest.get(row.episodeId)
    if (existing && existing.createdAt >= row.createdAt) continue
    newest.set(row.episodeId, {
      assetId: row.assetId,
      title: row.title,
      durationSec: row.durationSec,
      sizeBytes: Number(row.sizeBytes),
      createdAt: row.createdAt,
    })
  }

  return newest
}

/**
 * `linkTo` 指到的那個東西屬於哪一個作品，查不到就回 null (Z169).
 *
 * ## 為什麼要有這一支
 *
 * `beginUpload` 驗了 `episodeId` 屬於本作品，但 `linkTo.entityId` 完全沒驗。
 * 手動發一個 `projectId` 填 A、`linkTo` 指向 B 作品某個角色的上傳請求，那一列
 * `asset_links` 就建起來了。
 *
 * **今天這不是權限漏洞。** 這個 schema 沒有 per-project 成員（`visibleProjects()`
 * 說兩個人都看得到每一部作品），所以跨作品不是一道權限邊界，只是資料完整性
 * ——A 的角色身上掛著 B 的圖。等 membership 真的出現，這條要先補起來再開那個
 * 功能。
 *
 * ## 為什麼修在這裡而不是六個讀取端
 *
 * `asset_links` 有 `shot`／`character`／`task`／`world_entry`／`document`／
 * `expense` 六種。Z168 已經讓角色圖庫查詢自己加上 `assets.projectId` 條件，所
 * 以**顯示**那條路堵住了——但那是在讀取端補的，照那個做法走下去六個讀取端都
 * 要各自防一次，而六處裡只要有一處忘了洞就還在。一個寫入端，不是六個讀取端。
 *
 * 反方向（素材屬於 B、掛到 A 的角色）已經有 `assertAssetUsable` 守著
 * （`characters.ts`），所以兩邊都封起來了。
 *
 * ## 連軟刪除的也不收
 *
 * 四張表有 `deleted_at`，而掛到一個已刪除的角色身上，那一列是**讀不出來的**
 * ——`characters.ts` 的圖庫查詢會把刪掉的濾掉。建一列沒有人讀得到的連結不是
 * 寬容，是製造垃圾。`shots` 與 `expenses` 沒有這個欄位，所以沒有這一層。
 */
async function ownerOfLinkTarget(entityType: string, entityId: string): Promise<string | null> {
  switch (entityType) {
    case 'character': {
      const [row] = await db
        .select({ projectId: characters.projectId })
        .from(characters)
        .where(and(eq(characters.id, entityId), isNull(characters.deletedAt)))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'world_entry': {
      const [row] = await db
        .select({ projectId: worldEntries.projectId })
        .from(worldEntries)
        .where(and(eq(worldEntries.id, entityId), isNull(worldEntries.deletedAt)))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'task': {
      const [row] = await db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(and(eq(tasks.id, entityId), isNull(tasks.deletedAt)))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'expense': {
      const [row] = await db
        .select({ projectId: expenses.projectId })
        .from(expenses)
        .where(eq(expenses.id, entityId))
        .limit(1)
      return row?.projectId ?? null
    }
    /*
     * 這兩張自己沒有 `project_id`，掛在集數底下，所以要多跳一次。
     */
    case 'shot': {
      const [row] = await db
        .select({ projectId: episodes.projectId })
        .from(shots)
        .innerJoin(episodes, eq(episodes.id, shots.episodeId))
        .where(eq(shots.id, entityId))
        .limit(1)
      return row?.projectId ?? null
    }
    case 'document': {
      const [row] = await db
        .select({ projectId: episodes.projectId })
        .from(documents)
        .innerJoin(episodes, eq(episodes.id, documents.episodeId))
        .where(and(eq(documents.id, entityId), isNull(documents.deletedAt)))
        .limit(1)
      return row?.projectId ?? null
    }
    /*
     * 沒聽過的類型一律當成查不到。驗證器（`validators.ts`）已經把它限成那六
     * 種，而這裡再擋一次是因為**新增第七種的時候會先忘記改這裡**——那時候該
     * 發生的是上傳被拒絕，不是悄悄建一列沒人驗過的連結。
     */
    default:
      return null
  }
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
  /** 對話的附件不屬於素材庫 (Z116)。預設 LIBRARY。 */
  origin?: 'LIBRARY' | 'CHAT'
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

  let episodeNumber: number | null = null

  if (input.episodeId) {
    const [ep] = await db
      .select({ id: episodes.id, number: episodes.number })
      .from(episodes)
      .where(and(eq(episodes.id, input.episodeId), eq(episodes.projectId, input.projectId)))
      .limit(1)
    if (!ep) throw ApiError.badRequest('指定的集數不屬於這個作品')
    // Used only to group the object in the bucket; the row is authoritative.
    episodeNumber = ep.number
  }

  /*
   * 在寫任何一列之前 (Z169).
   *
   * 跟上面那個 `assertR2Configured()` 同一個理由：下面兩列是在碰 R2 之前就
   * 提交的，所以一個「其實該拒絕」的請求如果拒絕得太晚，留下的是一個沒有人
   * 會清掉的 PENDING 素材加一個上傳工作階段。
   */
  if (input.linkTo) {
    const owner = await ownerOfLinkTarget(input.linkTo.entityType, input.linkTo.entityId)
    if (owner !== input.projectId) {
      throw ApiError.badRequest('要掛上去的對象不屬於這個作品')
    }
  }

  const objectKey = buildObjectKey({
    projectId: input.projectId,
    kind: input.kind,
    filename: input.filename,
    episodeNumber,
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
        origin: input.origin ?? 'LIBRARY',
        name: input.filename,
        objectKey,
        /*
         * The resolved type, not what the browser claimed. Storing
         * `application/octet-stream` for an .mkv would make the library show a
         * generic file where a video belongs, long after the upload.
         */
        mimeType: resolveMimeType(input.filename, input.contentType),
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
        /*
         * R2 echoes back whatever the browser PUT, so a useless type must not
         * overwrite the one resolved at the start.
         */
        ...(head.mimeType && head.mimeType !== 'application/octet-stream'
          ? { mimeType: head.mimeType }
          : {}),
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
    /*
     * 連到**已經被軟刪的角色**的那一列不算引用 (Z168).
     *
     * 不這樣過濾的話會出現一條死路：角色上傳了一張圖 → 角色被軟刪 → 去素材
     * 中心刪那張圖 → 409「仍被 1 處引用（character(key_visual)）」。而那個
     * 角色已經從角色頁消失，沒有任何介面能解除那個連結，直接打
     * `unlinkCharacterPortrait` 也不行（它要求角色沒被軟刪），而全專案沒有
     * 任何角色還原路徑。那張圖就永遠刪不掉。
     *
     * 留著連結列而不是在軟刪時一併刪掉，是為了讓「角色回來時圖庫也回來」還
     * 有機會成立——軟刪的意思就是還能回來。
     */
    .leftJoin(
      characters,
      and(eq(assetLinks.entityType, 'character'), eq(characters.id, assetLinks.entityId))
    )
    .where(and(eq(assetLinks.assetId, assetId), isNull(characters.deletedAt)))

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

/**
 * Which derived files each asset kind may have.
 *
 * `asset_variants.kind` is the *derived file* axis — another rendering of the
 * same source, which a machine can regenerate. It is not the editorial axis:
 * an instrumental is a different recording and lives in `audio_revisions`.
 */
const DERIVED: Record<string, { kind: 'PREVIEW' | 'WAVEFORM'; mime: string; ext: string }[]> = {
  IMAGE: [{ kind: 'PREVIEW', mime: 'image/', ext: '.webp' }],
  STICKER: [{ kind: 'PREVIEW', mime: 'image/', ext: '.webp' }],
  // A poster frame, so a grid of episode cards does not pull down the video.
  VIDEO: [{ kind: 'PREVIEW', mime: 'image/', ext: '.webp' }],
  // Peaks as JSON (design 83), so the player draws without decoding the file.
  MUSIC: [{ kind: 'WAVEFORM', mime: 'application/json', ext: '.json' }],
  SFX: [{ kind: 'WAVEFORM', mime: 'application/json', ext: '.json' }],
  VOICE: [{ kind: 'WAVEFORM', mime: 'application/json', ext: '.json' }],
}

/** Presigns a single PUT for a derived file. These are small; no multipart. */
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

  const allowed = DERIVED[asset.kind]
  if (!allowed) {
    throw ApiError.badRequest('這類素材不會產生衍生檔案')
  }

  const match = allowed.find((entry) => input.contentType.startsWith(entry.mime))
  if (!match) {
    throw ApiError.badRequest('衍生檔案的類型不符合這類素材')
  }

  if (input.sizeBytes <= 0 || input.sizeBytes > PREVIEW_MAX_BYTES) {
    throw ApiError.badRequest('衍生檔案大小不合理')
  }

  /*
   * A "preview" larger than its master is not a preview — that happens with
   * small or already-optimised originals, and storing it would cost space to
   * make things slower.
   *
   * Waveforms are exempt: peaks are not a smaller copy of the audio, they are
   * a different thing, and a short SFX can legitimately have a peaks file
   * larger than the clip itself.
   */
  if (
    match.kind === 'PREVIEW' &&
    asset.sizeBytes > 0 &&
    input.sizeBytes >= asset.sizeBytes
  ) {
    throw ApiError.badRequest('預覽檔沒有比原檔小，不值得存')
  }

  const extension = input.contentType === 'image/avif' ? '.avif' : match.ext
  const objectKey = buildDerivedKey({
    projectId: asset.projectId,
    kind: match.kind === 'WAVEFORM' ? 'waveform' : 'preview',
    extension,
  })

  const [variant] = await db
    .insert(assetVariants)
    .values({
      assetId: asset.id,
      kind: match.kind,
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
      // One per kind per asset: regenerating replaces rather than piles up.
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

  /*
   * A waveform knows the track's length, because computing it meant decoding
   * the whole file. Carry that onto the asset when nothing else has.
   *
   * Without this, audio uploaded from 「新增檔案」 had a null
   * `durationSec` forever: only the music metadata form used to send one, and
   * a file that never passes through that form never gets a length. The list
   * then shows 「—」 for the duration while the player, which reads it from
   * the audio element, shows the real number on the next screen.
   *
   * Only when absent: a value the uploader sent explicitly is the better one,
   * and overwriting it here would be a silent downgrade.
   */
  if (variant.kind === 'WAVEFORM' && asset.durationSec === null) {
    const duration = Number((variant.params as { durationSec?: unknown } | null)?.durationSec)

    if (Number.isFinite(duration) && duration > 0) {
      await db
        .update(assets)
        .set({ durationSec: Math.round(duration) })
        .where(and(eq(assets.id, asset.id), isNull(assets.durationSec)))
    }
  }

  return updated
}

/* -------------------------------------------------------------------------- */
/* 各集素材 (Z2)                                                                */
/* -------------------------------------------------------------------------- */

export type EpisodeAsset = {
  id: string
  kind: AssetKindValue
  /** Editable display name; empty means use `name`. */
  title: string
  name: string
  mimeType: string
  sizeBytes: number
  durationSec: number | null
  width: number | null
  height: number | null
  version: number
  uploadedByName: string | null
  createdAt: Date
  /** Whether a compressed copy or waveform exists, so the grid knows. */
  hasPreview: boolean
  hasWaveform: boolean
  /** Set when this is the episode's finished cut. */
  isFinalCut: boolean
}

export type EpisodeAssetGroup = {
  kind: AssetKindValue
  items: EpisodeAsset[]
  sizeBytes: number
}

/**
 * Everything attached to one episode, grouped by kind (Z2).
 *
 * `assets.episode_id` has carried this since the beginning — what was missing
 * was anywhere to look at it. Before this, a file uploaded against an episode
 * was reachable only by whatever record happened to reference it, so anything
 * uploaded and not yet used was invisible.
 *
 * Variants are reported as flags rather than joined rows: the grid needs to
 * know a preview exists, not what it is, and `/api/files/[id]?variant=preview`
 * already falls back on its own.
 */
export async function episodeAssets(
  projectId: string,
  episodeId: string
): Promise<{ groups: EpisodeAssetGroup[]; total: number; sizeBytes: number }> {
  const rows = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      title: assets.title,
      name: assets.name,
      mimeType: assets.mimeType,
      sizeBytes: assets.sizeBytes,
      durationSec: assets.durationSec,
      width: assets.width,
      height: assets.height,
      version: assets.version,
      createdAt: assets.createdAt,
      uploadedByName: users.name,
      finalAssetId: episodes.finalAssetId,
      hasPreview: sql<boolean>`exists (
        select 1 from asset_variants v
         where v.asset_id = assets.id and v.kind = 'PREVIEW'
           and v.upload_status = 'COMPLETED'
      )`,
      hasWaveform: sql<boolean>`exists (
        select 1 from asset_variants v
         where v.asset_id = assets.id and v.kind = 'WAVEFORM'
           and v.upload_status = 'COMPLETED'
      )`,
    })
    .from(assets)
    .leftJoin(users, eq(users.id, assets.uploadedById))
    .leftJoin(episodes, eq(episodes.id, assets.episodeId))
    .where(
      and(
        eq(assets.projectId, projectId),
        eq(assets.episodeId, episodeId),
        // Only finished uploads: a PENDING row has no bytes behind it yet.
        eq(assets.uploadStatus, 'COMPLETED'),
        isNull(assets.deletedAt)
      )
    )
    .orderBy(desc(assets.createdAt))

  const byKind = new Map<AssetKindValue, EpisodeAsset[]>()

  for (const row of rows) {
    const item: EpisodeAsset = {
      id: row.id,
      kind: row.kind,
      title: row.title,
      name: row.name,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      durationSec: row.durationSec,
      width: row.width,
      height: row.height,
      version: row.version,
      uploadedByName: row.uploadedByName,
      createdAt: row.createdAt,
      hasPreview: Boolean(row.hasPreview),
      hasWaveform: Boolean(row.hasWaveform),
      isFinalCut: row.finalAssetId === row.id,
    }

    byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), item])
  }

  /*
   * Kind order comes from `ASSET_KINDS`, not from what happens to exist, so
   * the page does not reshuffle itself as files are added.
   */
  const groups: EpisodeAssetGroup[] = ASSET_KINDS.filter((kind) => byKind.has(kind)).map(
    (kind) => {
      const items = byKind.get(kind) ?? []
      return {
        kind,
        items,
        sizeBytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
      }
    }
  )

  return {
    groups,
    total: rows.length,
    sizeBytes: rows.reduce((sum, row) => sum + row.sizeBytes, 0),
  }
}
