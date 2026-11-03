import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { chapters, documents, episodes, users, versions } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import type { DocumentKindValue } from '@/lib/constants'
import { countChars } from '@/lib/utils'

/**
 * 小說 / 劇本 的讀寫 (designs 06, 07).
 *
 * One `documents` row per episode per kind, and the chapters inside it are the
 * text. Spec v3 §11.1 is explicit that the project-level `/novel` page is an
 * index, not a second copy of the prose — so everything here is keyed by
 * episode and there is exactly one place any given paragraph lives.
 *
 * Two people edit this at once, which is the whole reason for `lockRevision`:
 * a save carries the revision it was based on, and a save based on a stale one
 * is refused rather than quietly overwriting the other member's paragraph.
 */

export type ChapterRow = {
  id: string
  sortOrder: number
  title: string
  summary: string
  content: string
  charCount: number
  updatedAt: Date
}

export type NovelDocument = {
  id: string
  episodeId: string
  episodeNumber: number
  episodeTitle: string
  projectId: string
  kind: DocumentKindValue
  charCount: number
  version: number
  lockRevision: number
  lastEditorName: string | null
  updatedAt: Date
  chapters: ChapterRow[]
}

/** Episode-level summary for the project's novel index. */
export type NovelIndexRow = {
  episodeId: string
  number: number
  title: string
  documentId: string | null
  charCount: number
  chapterCount: number
  lastEditorName: string | null
  updatedAt: Date | null
}

/**
 * Loads an episode's document, creating the row the first time it is opened.
 *
 * Creating on read rather than when the episode is created keeps 120 empty
 * document rows out of the database until somebody actually writes something.
 */
export async function openDocument(
  projectId: string,
  episodeId: string,
  kind: DocumentKindValue
): Promise<NovelDocument | null> {
  const [episode] = await db
    .select({ id: episodes.id, number: episodes.number, title: episodes.title })
    .from(episodes)
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt)
      )
    )
    .limit(1)

  if (!episode) return null

  let [document] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.episodeId, episodeId),
        eq(documents.kind, kind),
        isNull(documents.deletedAt)
      )
    )
    .limit(1)

  if (!document) {
    const [created] = await db
      .insert(documents)
      .values({ episodeId, kind })
      // Another tab may have created it in between; take whatever is there.
      .onConflictDoNothing({ target: [documents.episodeId, documents.kind] })
      .returning()

    document =
      created ??
      (
        await db
          .select()
          .from(documents)
          .where(and(eq(documents.episodeId, episodeId), eq(documents.kind, kind)))
          .limit(1)
      )[0]
  }

  if (!document) throw new Error('Failed to open document')

  const [rows, editor] = await Promise.all([
    db
      .select({
        id: chapters.id,
        sortOrder: chapters.sortOrder,
        title: chapters.title,
        summary: chapters.summary,
        content: chapters.content,
        charCount: chapters.charCount,
        updatedAt: chapters.updatedAt,
      })
      .from(chapters)
      .where(eq(chapters.documentId, document.id))
      .orderBy(asc(chapters.sortOrder)),

    document.lastEditorId
      ? db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, document.lastEditorId))
          .limit(1)
      : Promise.resolve([]),
  ])

  return {
    id: document.id,
    episodeId,
    episodeNumber: episode.number,
    episodeTitle: episode.title,
    projectId,
    kind,
    charCount: document.charCount,
    version: document.version,
    lockRevision: document.lockRevision,
    lastEditorName: editor[0]?.name ?? null,
    updatedAt: document.updatedAt,
    chapters: rows,
  }
}

/** Every episode of a project with its novel status, for the index page. */
export async function novelIndex(
  projectId: string,
  kind: DocumentKindValue = 'NOVEL'
): Promise<NovelIndexRow[]> {
  const rows = await db
    .select({
      episodeId: episodes.id,
      number: episodes.number,
      title: episodes.title,
      documentId: documents.id,
      charCount: documents.charCount,
      updatedAt: documents.updatedAt,
      lastEditorId: documents.lastEditorId,
      chapterCount: sql<number>`(
        select count(*) from ${chapters} where ${chapters}.document_id = ${documents.id}
      )`.mapWith(Number),
    })
    .from(episodes)
    .leftJoin(
      documents,
      and(
        eq(documents.episodeId, episodes.id),
        eq(documents.kind, kind),
        isNull(documents.deletedAt)
      )
    )
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number))

  const editorIds = [...new Set(rows.map((r) => r.lastEditorId).filter(Boolean))] as string[]
  const editors = editorIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users)
    : []
  const nameOf = new Map(editors.map((e) => [e.id, e.name]))

  return rows.map((row) => ({
    episodeId: row.episodeId,
    number: row.number,
    title: row.title,
    documentId: row.documentId,
    charCount: row.charCount ?? 0,
    chapterCount: row.documentId ? row.chapterCount : 0,
    lastEditorName: row.lastEditorId ? (nameOf.get(row.lastEditorId) ?? null) : null,
    updatedAt: row.updatedAt,
  }))
}

/**
 * Adds a chapter and returns the document's new revision.
 *
 * Creating a chapter changes the document, so it advances `lockRevision` —
 * every other open editor is now stale. The caller is given the new value
 * rather than left to guess it, because a client that increments its own copy
 * is one race away from silently saving against the wrong revision.
 */
export async function createChapter(input: {
  documentId: string
  title: string
  user: SessionUser
}): Promise<{ chapter: ChapterRow; lockRevision: number }> {
  const [last] = await db
    .select({ sortOrder: chapters.sortOrder })
    .from(chapters)
    .where(eq(chapters.documentId, input.documentId))
    .orderBy(desc(chapters.sortOrder))
    .limit(1)

  const [created] = await db
    .insert(chapters)
    .values({
      documentId: input.documentId,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      title: input.title.trim(),
    })
    .returning()

  if (!created) throw new Error('Failed to create chapter')

  const lockRevision = await touchDocument(input.documentId, input.user.id)

  return {
    chapter: {
      id: created.id,
      sortOrder: created.sortOrder,
      title: created.title,
      summary: created.summary,
      content: created.content,
      charCount: created.charCount,
      updatedAt: created.updatedAt,
    },
    lockRevision,
  }
}

export type SaveResult = {
  chapter: ChapterRow
  documentCharCount: number
  lockRevision: number
  savedAt: Date
}

/**
 * Saves one chapter.
 *
 * `expectedRevision` is the document revision the editor was opened on. If the
 * other member saved in between, this refuses with 409 rather than overwriting
 * them — losing somebody's writing silently is the worst thing this page could
 * do, and "last write wins" is exactly that with extra steps.
 */
export async function saveChapter(input: {
  chapterId: string
  title?: string
  summary?: string
  content: string
  expectedRevision: number
  user: SessionUser
}): Promise<SaveResult> {
  const [chapter] = await db
    .select({ id: chapters.id, documentId: chapters.documentId })
    .from(chapters)
    .where(eq(chapters.id, input.chapterId))
    .limit(1)

  if (!chapter) throw ApiError.notFound('找不到這個章節')

  const charCount = countChars(input.content)

  return db.transaction(async (tx) => {
    // Conditional update: matches nothing when the revision moved on.
    const bumped = await tx
      .update(documents)
      .set({
        lockRevision: sql`${documents.lockRevision} + 1`,
        lastEditorId: input.user.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documents.id, chapter.documentId),
          eq(documents.lockRevision, input.expectedRevision)
        )
      )
      .returning({ lockRevision: documents.lockRevision })

    if (bumped.length === 0) {
      const [current] = await tx
        .select({ lockRevision: documents.lockRevision, lastEditorId: documents.lastEditorId })
        .from(documents)
        .where(eq(documents.id, chapter.documentId))
        .limit(1)

      const [editor] = current?.lastEditorId
        ? await tx
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, current.lastEditorId))
            .limit(1)
        : []

      throw new ApiError(
        409,
        `這份稿子已被${editor?.name ?? '另一位成員'}修改，請重新載入後再編輯，避免覆蓋對方的內容。`,
        'stale_revision',
        { currentRevision: current?.lockRevision ?? null }
      )
    }

    const [updated] = await tx
      .update(chapters)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        content: input.content,
        charCount,
        updatedAt: new Date(),
      })
      .where(eq(chapters.id, input.chapterId))
      .returning()

    if (!updated) throw new Error('Failed to save chapter')

    // The document's count is the sum of its chapters, recomputed rather than
    // adjusted by a delta — a drifting total is worse than a slower query.
    const [sum] = await tx
      .select({ total: sql<number>`coalesce(sum(${chapters.charCount}), 0)`.mapWith(Number) })
      .from(chapters)
      .where(eq(chapters.documentId, chapter.documentId))

    const documentCharCount = Number(sum?.total ?? 0)

    await tx
      .update(documents)
      .set({ charCount: documentCharCount })
      .where(eq(documents.id, chapter.documentId))

    return {
      chapter: {
        id: updated.id,
        sortOrder: updated.sortOrder,
        title: updated.title,
        summary: updated.summary,
        content: updated.content,
        charCount: updated.charCount,
        updatedAt: updated.updatedAt,
      },
      documentCharCount,
      lockRevision: bumped[0]!.lockRevision,
      savedAt: updated.updatedAt,
    }
  })
}

/**
 * Appends an immutable snapshot of the whole document.
 *
 * Drafts autosave into `chapters`; this is the explicit "keep this" that the
 * 版本紀錄 page reads. History is append-only — restoring later adds a new
 * version rather than rewriting one (spec 08).
 */
export async function snapshotDocument(input: {
  documentId: string
  label: string
  user: SessionUser
}): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const [document] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, input.documentId))
      .limit(1)

    if (!document) throw ApiError.notFound('找不到這份文件')

    const rows = await tx
      .select()
      .from(chapters)
      .where(eq(chapters.documentId, input.documentId))
      .orderBy(asc(chapters.sortOrder))

    const [previous] = await tx
      .select({ id: versions.id })
      .from(versions)
      .where(and(eq(versions.targetType, 'DOCUMENT'), eq(versions.targetId, input.documentId)))
      .orderBy(desc(versions.version))
      .limit(1)

    const nextVersion = document.version + 1

    await tx.insert(versions).values({
      targetType: 'DOCUMENT',
      targetId: input.documentId,
      version: nextVersion,
      parentVersionId: previous?.id ?? null,
      snapshot: {
        kind: document.kind,
        chapters: rows.map((row) => ({
          id: row.id,
          sortOrder: row.sortOrder,
          title: row.title,
          summary: row.summary,
          content: row.content,
        })),
      },
      charCount: document.charCount,
      label: input.label.trim(),
      authorId: input.user.id,
      authorName: input.user.name,
    })

    await tx
      .update(documents)
      .set({ version: nextVersion, updatedAt: new Date() })
      .where(eq(documents.id, input.documentId))

    return { version: nextVersion }
  })
}

/** Confirms a document belongs to the project before anything touches it. */
export async function documentBelongsToProject(
  documentId: string,
  projectId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(and(eq(documents.id, documentId), eq(episodes.projectId, projectId)))
    .limit(1)

  return Boolean(row)
}

/** Same check, starting from a chapter. */
export async function chapterProjectId(chapterId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: episodes.projectId })
    .from(chapters)
    .innerJoin(documents, eq(documents.id, chapters.documentId))
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(eq(chapters.id, chapterId))
    .limit(1)

  return row?.projectId ?? null
}

/** Advances the revision and returns the new value. */
async function touchDocument(documentId: string, userId: string): Promise<number> {
  const [row] = await db
    .update(documents)
    .set({
      lockRevision: sql`${documents.lockRevision} + 1`,
      lastEditorId: userId,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, documentId))
    .returning({ lockRevision: documents.lockRevision })

  if (!row) throw new Error('Failed to touch document')
  return row.lockRevision
}
