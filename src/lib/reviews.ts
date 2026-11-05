import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { approvalRecords, documents, episodes, reviews, users, versions } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { DOCUMENT_KIND_LABEL, type DocumentKindValue } from '@/lib/constants'

/**
 * 審核發布 (Z41, designs 57–58).
 *
 * `approval_records` 與 `reviews` 兩張表都在，`src/lib/approvals.ts` 把定稿、
 * 鎖定、解鎖、supersedes 的語意寫得很完整——然後：
 *
 * - 兩張表都**零筆資料**
 * - `approvals.ts` 的每一支函式**沒有任何地方呼叫**
 * - `assertNotLocked` 的註解寫著「Call this at the top of any write path」，
 *   而它**沒有被放在任何一條寫入路徑上**
 *
 * 最後那一條是這一塊真正的缺口。做一個會按「定稿」的頁面、而每一條存檔路徑
 * 都無視那個鎖，等於做一個會說謊的按鈕：spec v2 §6.5「已定稿內容必須透過審核
 * 解鎖或建立修訂版」會變成畫面上的一句話，而不是系統的行為。
 *
 * 所以 Z41 的重點順序是：先讓鎖真的鎖得住，再做看得到它的頁面。
 */

/** 可以定稿的東西：目前是每一集的小說與劇本。 */
const APPROVABLE_KINDS: DocumentKindValue[] = ['NOVEL', 'SCRIPT']

export type ApprovalState = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNLOCKED'

export type ReviewTargetRow = {
  documentId: string
  kind: DocumentKindValue
  kindLabel: string
  episodeId: string | null
  episodeNumber: number | null
  episodeTitle: string
  /** 目前的版本號（`documents.version`）。 */
  version: number
  charCount: number
  /** 最新一份快照；沒有快照就不能定稿。 */
  latestVersionId: string | null
  latestVersionNumber: number | null
  /** 目前生效的審核狀態。 */
  state: ApprovalState
  locked: boolean
  /** 定稿釘住的是哪一版。 */
  approvedVersionNumber: number | null
  note: string
  unlockReason: string
  decidedAt: Date | null
  decidedByName: string | null
  /** 還沒處理的審稿意見筆數。 */
  openNotes: number
}

export type ReviewBoard = {
  rows: ReviewTargetRow[]
  counts: { total: number; locked: number; pending: number; openNotes: number }
}

/**
 * 這部作品每一份可定稿內容的狀態。
 *
 * 審核紀錄一次撈出來再在記憶體裡取每個 target 最新的一筆，而不是每份文件
 * 一次 lateral 查詢：兩人團隊的量級下這張表很小，而 N+1 在 240 集的時候會很
 * 明顯。
 */
export async function reviewBoard(projectId: string): Promise<ReviewBoard> {
  /*
   * `documents` 沒有 `project_id`，它經由 `episode_id` 歸屬（`episodes` 上才
   * 有）。所以這裡是 innerJoin 而不是 leftJoin——`episode_id` 是 notNull，不
   * 存在「沒有集數的文件」。
   */
  const docs = await db
    .select({
      documentId: documents.id,
      kind: documents.kind,
      episodeId: documents.episodeId,
      episodeNumber: episodes.number,
      episodeTitle: episodes.title,
      version: documents.version,
      charCount: documents.charCount,
    })
    .from(documents)
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(
      and(
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt),
        inArray(documents.kind, APPROVABLE_KINDS),
        isNull(documents.deletedAt),
        /*
         * 空白文件不列。
         *
         * 240 集 × 兩種文件，列出來會是一張 480 列、每一列都寫著「還沒有內
         * 容」的表——而那張表回答不了「現在有什麼在等我審」。
         */
        sql`${documents.charCount} > 0`
      )
    )
    .orderBy(episodes.number, documents.kind)

  if (docs.length === 0) {
    return { rows: [], counts: { total: 0, locked: 0, pending: 0, openNotes: 0 } }
  }

  const documentIds = docs.map((row) => row.documentId)

  const [approvals, latestVersions, approvedVersions, noteCounts] = await Promise.all([
    db
      .select({
        id: approvalRecords.id,
        targetId: approvalRecords.targetId,
        state: approvalRecords.state,
        locks: approvalRecords.locks,
        note: approvalRecords.note,
        unlockReason: approvalRecords.unlockReason,
        versionId: approvalRecords.versionId,
        decidedAt: approvalRecords.decidedAt,
        decidedByName: users.name,
        createdAt: approvalRecords.createdAt,
      })
      .from(approvalRecords)
      .leftJoin(users, eq(users.id, approvalRecords.decidedById))
      .where(
        and(
          eq(approvalRecords.projectId, projectId),
          eq(approvalRecords.targetType, 'DOCUMENT'),
          inArray(approvalRecords.targetId, documentIds)
        )
      )
      .orderBy(desc(approvalRecords.createdAt)),

    db
      .select({
        id: versions.id,
        targetId: versions.targetId,
        version: versions.version,
      })
      .from(versions)
      .where(
        and(eq(versions.targetType, 'DOCUMENT'), inArray(versions.targetId, documentIds))
      )
      .orderBy(desc(versions.version)),

    db
      .select({ id: versions.id, version: versions.version })
      .from(versions)
      .where(and(eq(versions.targetType, 'DOCUMENT'), inArray(versions.targetId, documentIds))),

    db
      .select({ documentId: reviews.documentId, n: sql<number>`count(*)`.mapWith(Number) })
      .from(reviews)
      .where(
        and(
          eq(reviews.projectId, projectId),
          eq(reviews.state, 'OPEN'),
          inArray(reviews.documentId, documentIds)
        )
      )
      .groupBy(reviews.documentId),
  ])

  // 每個 target 最新的一筆審核紀錄。已經按 createdAt 降冪排了，所以第一筆就是。
  const currentByTarget = new Map<string, (typeof approvals)[number]>()
  for (const row of approvals) {
    if (!currentByTarget.has(row.targetId)) currentByTarget.set(row.targetId, row)
  }

  const latestByTarget = new Map<string, { id: string; version: number }>()
  for (const row of latestVersions) {
    if (!latestByTarget.has(row.targetId)) {
      latestByTarget.set(row.targetId, { id: row.id, version: row.version })
    }
  }

  const versionNumberById = new Map(approvedVersions.map((row) => [row.id, row.version]))
  const notesByDocument = new Map(noteCounts.map((row) => [row.documentId ?? '', row.n]))

  const rows: ReviewTargetRow[] = docs.map((doc) => {
    const approval = currentByTarget.get(doc.documentId)
    const latest = latestByTarget.get(doc.documentId)

    return {
      documentId: doc.documentId,
      kind: doc.kind as DocumentKindValue,
      kindLabel: DOCUMENT_KIND_LABEL[doc.kind as DocumentKindValue] ?? doc.kind,
      episodeId: doc.episodeId,
      episodeNumber: doc.episodeNumber,
      episodeTitle: doc.episodeTitle ?? '',
      version: doc.version,
      charCount: doc.charCount,
      latestVersionId: latest?.id ?? null,
      latestVersionNumber: latest?.version ?? null,
      state: (approval?.state as ApprovalState) ?? 'NONE',
      locked: Boolean(approval?.locks),
      approvedVersionNumber: approval?.versionId
        ? (versionNumberById.get(approval.versionId) ?? null)
        : null,
      note: approval?.note ?? '',
      unlockReason: approval?.unlockReason ?? '',
      decidedAt: approval?.decidedAt ?? null,
      decidedByName: approval?.decidedByName ?? null,
      openNotes: notesByDocument.get(doc.documentId) ?? 0,
    }
  })

  return {
    rows,
    counts: {
      total: rows.length,
      locked: rows.filter((row) => row.locked).length,
      pending: rows.filter((row) => row.state === 'PENDING').length,
      openNotes: rows.reduce((sum, row) => sum + row.openNotes, 0),
    },
  }
}

/* -------------------------------------------------------------------------- */
/* 審稿意見                                                                    */
/* -------------------------------------------------------------------------- */

export type ReviewNote = {
  id: string
  body: string
  state: string
  authorName: string | null
  resolvedByName: string | null
  resolvedAt: Date | null
  createdAt: Date
  /** 有錨點的是在編輯器裡選取某一段留的；整份文件的留言沒有錨點。 */
  anchorText: string
}

/**
 * 一份文件上的審稿意見。
 *
 * `anchor_start` / `anchor_end` 可以是 null，schema 註解寫明那代表「整份文件
 * 的留言」——所以整份文件層級的意見不是偷工，是這張表本來就支援的一種。選取
 * 某一段來留言需要編輯器裡的錨點介面，那是另一個表面，還沒做。
 */
export async function listReviewNotes(documentId: string): Promise<ReviewNote[]> {
  const rows = await db
    .select({
      id: reviews.id,
      body: reviews.body,
      state: reviews.state,
      authorName: users.name,
      resolvedAt: reviews.resolvedAt,
      createdAt: reviews.createdAt,
      anchorText: reviews.anchorText,
      resolvedById: reviews.resolvedById,
    })
    .from(reviews)
    .leftJoin(users, eq(users.id, reviews.authorId))
    .where(eq(reviews.documentId, documentId))
    .orderBy(desc(reviews.createdAt))

  const resolverIds = rows.map((row) => row.resolvedById).filter((id): id is string => Boolean(id))

  const resolvers =
    resolverIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, resolverIds))
      : []

  const nameById = new Map(resolvers.map((row) => [row.id, row.name]))

  return rows.map((row) => ({
    id: row.id,
    body: row.body,
    state: row.state,
    authorName: row.authorName,
    resolvedByName: row.resolvedById ? (nameById.get(row.resolvedById) ?? null) : null,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    anchorText: row.anchorText,
  }))
}

export async function addReviewNote(input: {
  projectId: string
  documentId: string
  body: string
  user: SessionUser
}): Promise<{ id: string }> {
  const [doc] = await db
    .select({ id: documents.id, projectId: episodes.projectId })
    .from(documents)
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(and(eq(documents.id, input.documentId), isNull(documents.deletedAt)))
    .limit(1)

  if (!doc) throw ApiError.notFound('找不到這份文件')
  if (doc.projectId !== input.projectId) throw ApiError.notFound('這份文件不屬於這部作品')

  const [row] = await db
    .insert(reviews)
    .values({
      projectId: input.projectId,
      documentId: input.documentId,
      body: input.body,
      state: 'OPEN',
      authorId: input.user.id,
    })
    .returning({ id: reviews.id })

  if (!row) throw new Error('Failed to create review note')

  await logActivity({
    user: input.user,
    action: 'create',
    entityType: 'review',
    entityId: row.id,
    projectId: input.projectId,
    summary: `${input.user.name} 留了一則審稿意見`,
  })

  return row
}

/**
 * 把一則意見標成已處理，或重新打開。
 *
 * 不刪除：一則「這裡的動機交代不夠」就算處理完了，也還是這份內容為什麼改成
 * 現在這樣的理由。
 */
export async function setReviewNoteState(input: {
  projectId: string
  noteId: string
  state: 'OPEN' | 'RESOLVED'
  user: SessionUser
}): Promise<void> {
  const [note] = await db
    .select({ id: reviews.id, projectId: reviews.projectId })
    .from(reviews)
    .where(eq(reviews.id, input.noteId))
    .limit(1)

  if (!note) throw ApiError.notFound('找不到這則意見')
  if (note.projectId !== input.projectId) throw ApiError.notFound('這則意見不屬於這部作品')

  await db
    .update(reviews)
    .set(
      input.state === 'RESOLVED'
        ? { state: 'RESOLVED', resolvedById: input.user.id, resolvedAt: new Date(), updatedAt: new Date() }
        : { state: 'OPEN', resolvedById: null, resolvedAt: null, updatedAt: new Date() }
    )
    .where(eq(reviews.id, input.noteId))

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'review',
    entityId: input.noteId,
    projectId: input.projectId,
    summary:
      input.state === 'RESOLVED'
        ? `${input.user.name} 把一則審稿意見標成已處理`
        : `${input.user.name} 重新打開一則審稿意見`,
  })
}

/** 這份文件屬於哪部作品，給路由做歸屬檢查。 */
export async function documentProjectId(documentId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: episodes.projectId })
    .from(documents)
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(eq(documents.id, documentId))
    .limit(1)
  return row?.projectId ?? null
}
