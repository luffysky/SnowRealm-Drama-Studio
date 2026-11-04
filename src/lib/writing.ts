import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { chapters, documents, episodes, scenes, users, versions } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import type { DocumentKindValue } from '@/lib/constants'
import { countRichTextChars } from '@/lib/utils'

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
  scenes: SceneRow[]
}

export type SceneRow = {
  id: string
  sortOrder: number
  code: string
  heading: string
  location: string
  timeOfDay: string
  content: string
  estimatedSec: number
  updatedAt: Date
}

/** Episode-level summary for the project's novel index. */
export type NovelIndexRow = {
  episodeId: string
  number: number
  title: string
  documentId: string | null
  charCount: number
  chapterCount: number
  /** Scenes and estimated runtime, for the script index. */
  sceneCount: number
  estimatedSec: number
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

  const [rows, sceneRows, editor] = await Promise.all([
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

    db
      .select({
        id: scenes.id,
        sortOrder: scenes.sortOrder,
        code: scenes.code,
        heading: scenes.heading,
        location: scenes.location,
        timeOfDay: scenes.timeOfDay,
        content: scenes.content,
        estimatedSec: scenes.estimatedSec,
        updatedAt: scenes.updatedAt,
      })
      .from(scenes)
      .where(eq(scenes.documentId, document.id))
      .orderBy(asc(scenes.sortOrder)),

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
    scenes: sceneRows,
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
      sceneCount: sql<number>`(
        select count(*) from ${scenes} where ${scenes}.document_id = ${documents.id}
      )`.mapWith(Number),
      seconds: sql<number>`(
        select coalesce(sum(estimated_sec), 0) from ${scenes}
         where ${scenes}.document_id = ${documents.id}
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
    sceneCount: row.documentId ? row.sceneCount : 0,
    estimatedSec: row.documentId ? row.seconds : 0,
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
/** One episode's entry in the whole-book chapter index. */
export type NovelTocEpisode = {
  episodeId: string
  number: number
  title: string
  charCount: number
  chapters: { id: string; sortOrder: number; title: string; charCount: number }[]
}

/**
 * Every chapter in the book, grouped by episode.
 *
 * The editor's rail used to list only the open episode's chapters, which made
 * the 章節目錄 a table of contents for one episode of a 120-episode novel —
 * you could not see, or reach, anything you had already written elsewhere
 * without going back out to 集數管理.
 *
 * Episodes with no chapters at all are dropped: an index of 120 empty rows
 * buries the handful that have prose in them. Episodes that have chapters but
 * no text are kept, because an empty chapter someone created deliberately is
 * a plan for the next session.
 */
export async function novelToc(
  projectId: string,
  kind: DocumentKindValue = 'NOVEL'
): Promise<NovelTocEpisode[]> {
  const rows = await db
    .select({
      episodeId: episodes.id,
      number: episodes.number,
      episodeTitle: episodes.title,
      chapterId: chapters.id,
      sortOrder: chapters.sortOrder,
      chapterTitle: chapters.title,
      charCount: chapters.charCount,
    })
    .from(episodes)
    .innerJoin(
      documents,
      and(
        eq(documents.episodeId, episodes.id),
        eq(documents.kind, kind),
        isNull(documents.deletedAt)
      )
    )
    .innerJoin(chapters, eq(chapters.documentId, documents.id))
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number), asc(chapters.sortOrder))

  const byEpisode = new Map<string, NovelTocEpisode>()

  for (const row of rows) {
    let episode = byEpisode.get(row.episodeId)
    if (!episode) {
      episode = {
        episodeId: row.episodeId,
        number: row.number,
        title: row.episodeTitle ?? '',
        charCount: 0,
        chapters: [],
      }
      byEpisode.set(row.episodeId, episode)
    }

    episode.chapters.push({
      id: row.chapterId,
      sortOrder: row.sortOrder,
      title: row.chapterTitle ?? '',
      charCount: row.charCount,
    })
    episode.charCount += row.charCount
  }

  return [...byEpisode.values()].sort((a, b) => a.number - b.number)
}

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

/**
 * 刪除一個章節。
 *
 * **備份不是選項，是刪除的一部分。** Before the row goes, the whole document
 * is appended to `versions` labelled with the chapter's name, in the same
 * transaction — so 版本紀錄 can put it back, and `restoreVersion` already
 * reinstates chapters with their original ids, which means anything else
 * pointing at that chapter still resolves afterwards.
 *
 * That is the same rule the AI assistant's proposals follow. A person
 * deleting their own chapter is a likelier source of regret than a model
 * overwriting one, not a less likely one: there is no diff to look at first.
 *
 * Takes `expectedRevision` like a save does. Deleting a chapter out from
 * under someone who is typing in it is the same class of accident as
 * overwriting their paragraph, and gets the same 409.
 */
export async function deleteChapter(input: {
  chapterId: string
  expectedRevision: number
  user: SessionUser
}): Promise<{
  deletedId: string
  title: string
  documentCharCount: number
  lockRevision: number
  /** The snapshot it can be restored from. */
  backupVersion: number
}> {
  const [chapter] = await db
    .select({
      id: chapters.id,
      documentId: chapters.documentId,
      title: chapters.title,
      sortOrder: chapters.sortOrder,
    })
    .from(chapters)
    .where(eq(chapters.id, input.chapterId))
    .limit(1)

  if (!chapter) throw ApiError.notFound('找不到這個章節')

  return db.transaction(async (tx) => {
    // Conditional update: matches nothing when the document moved on.
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

    if (bumped.length === 0) throw await staleRevisionError(chapter.documentId)

    const title = chapter.title.trim() || '未命名'
    const { version } = await appendSnapshot(tx, {
      documentId: chapter.documentId,
      label: `刪除章節前：${title}`,
      user: input.user,
    })

    await tx.delete(chapters).where(eq(chapters.id, input.chapterId))

    /*
     * Close the gap in the numbering.
     *
     * The sidebar shows `sortOrder` as the chapter number, so leaving a hole
     * means the list reads 01, 02, 04 — and the next 新增章節 takes
     * `max + 1`, which would then collide with nothing but still look wrong.
     */
    await tx
      .update(chapters)
      .set({ sortOrder: sql`${chapters.sortOrder} - 1` })
      .where(
        and(
          eq(chapters.documentId, chapter.documentId),
          gt(chapters.sortOrder, chapter.sortOrder)
        )
      )

    // Recomputed, not adjusted by a delta — a drifting total is worse than a
    // slower query.
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
      deletedId: chapter.id,
      title,
      documentCharCount,
      lockRevision: bumped[0]!.lockRevision,
      backupVersion: version,
    }
  })
}

/**
 * Adds a scene. The code (`S01`) comes from its position rather than being
 * typed, so renumbering after a reorder is one update instead of a manual pass.
 */
export async function createScene(input: {
  documentId: string
  heading: string
  user: SessionUser
}): Promise<{ scene: SceneRow; lockRevision: number }> {
  const [last] = await db
    .select({ sortOrder: scenes.sortOrder })
    .from(scenes)
    .where(eq(scenes.documentId, input.documentId))
    .orderBy(desc(scenes.sortOrder))
    .limit(1)

  const sortOrder = (last?.sortOrder ?? 0) + 1

  const [created] = await db
    .insert(scenes)
    .values({
      documentId: input.documentId,
      sortOrder,
      code: `S${String(sortOrder).padStart(2, '0')}`,
      heading: input.heading.trim(),
    })
    .returning()

  if (!created) throw new Error('Failed to create scene')

  const lockRevision = await touchDocument(input.documentId, input.user.id)

  return {
    scene: {
      id: created.id,
      sortOrder: created.sortOrder,
      code: created.code,
      heading: created.heading,
      location: created.location,
      timeOfDay: created.timeOfDay,
      content: created.content,
      estimatedSec: created.estimatedSec,
      updatedAt: created.updatedAt,
    },
    lockRevision,
  }
}

export type SceneSaveResult = {
  scene: SceneRow
  documentCharCount: number
  /** Sum of the episode's scene estimates, in seconds. */
  documentSeconds: number
  lockRevision: number
  savedAt: Date
}

/**
 * Saves one scene, under the same optimistic lock as a chapter.
 *
 * The runtime estimate is recomputed here rather than taken from the client:
 * it decides whether an episode fits the 120-180 second target, and a figure
 * the browser could set is a figure that can be wished into range.
 */
export async function saveScene(input: {
  sceneId: string
  heading?: string
  location?: string
  timeOfDay?: string
  content: string
  expectedRevision: number
  user: SessionUser
}): Promise<SceneSaveResult> {
  const [scene] = await db
    .select({ id: scenes.id, documentId: scenes.documentId })
    .from(scenes)
    .where(eq(scenes.id, input.sceneId))
    .limit(1)

  if (!scene) throw ApiError.notFound('找不到這個場次')

  const estimatedSec = estimateSceneSeconds(input.content)

  return db.transaction(async (tx) => {
    const bumped = await tx
      .update(documents)
      .set({
        lockRevision: sql`${documents.lockRevision} + 1`,
        lastEditorId: input.user.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documents.id, scene.documentId),
          eq(documents.lockRevision, input.expectedRevision)
        )
      )
      .returning({ lockRevision: documents.lockRevision })

    if (bumped.length === 0) throw await staleRevisionError(scene.documentId)

    const [updated] = await tx
      .update(scenes)
      .set({
        ...(input.heading !== undefined ? { heading: input.heading } : {}),
        ...(input.location !== undefined ? { location: input.location } : {}),
        ...(input.timeOfDay !== undefined ? { timeOfDay: input.timeOfDay } : {}),
        content: input.content,
        estimatedSec,
        updatedAt: new Date(),
      })
      .where(eq(scenes.id, input.sceneId))
      .returning()

    if (!updated) throw new Error('Failed to save scene')

    const all = await tx
      .select({ content: scenes.content, estimatedSec: scenes.estimatedSec })
      .from(scenes)
      .where(eq(scenes.documentId, scene.documentId))

    const documentCharCount = all.reduce((n, row) => n + countRichTextChars(row.content), 0)
    const documentSeconds = all.reduce((n, row) => n + row.estimatedSec, 0)

    await tx
      .update(documents)
      .set({ charCount: documentCharCount })
      .where(eq(documents.id, scene.documentId))

    return {
      scene: {
        id: updated.id,
        sortOrder: updated.sortOrder,
        code: updated.code,
        heading: updated.heading,
        location: updated.location,
        timeOfDay: updated.timeOfDay,
        content: updated.content,
        estimatedSec: updated.estimatedSec,
        updatedAt: updated.updatedAt,
      },
      documentCharCount,
      documentSeconds,
      lockRevision: bumped[0]!.lockRevision,
      savedAt: updated.updatedAt,
    }
  })
}

/**
 * Rough runtime for one scene.
 *
 * Dialogue is read aloud and costs far more per character than an action line,
 * which is only acted. Text inside Chinese quotation marks counts as dialogue;
 * everything else is action. Deliberately crude, and recomputed on the server:
 * its job is to warn when an episode drifts out of the 120-180 second window,
 * not to be exact.
 */
export function estimateSceneSeconds(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ')

  let dialogue = 0
  for (const match of text.matchAll(/[\u300c\u300e]([^\u300d\u300f]*)[\u300d\u300f]/g)) {
    dialogue += countRichTextChars(match[1] ?? '')
  }

  const total = countRichTextChars(text)
  const action = Math.max(total - dialogue, 0)

  // ~5 spoken characters a second; action reads about three times faster.
  return Math.round(dialogue / 5 + action / 15)
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

  // Rich text: the markup must not inflate the count.
  const charCount = countRichTextChars(input.content)

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

    if (bumped.length === 0) throw await staleRevisionError(chapter.documentId)

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
  return db.transaction((tx) => appendSnapshot(tx, input))
}

/**
 * The body of `snapshotDocument`, taking a transaction.
 *
 * Split out so that deleting a chapter can take its backup and do the delete
 * in **one** transaction. A backup written by a separate transaction can
 * commit while the delete rolls back — leaving a 版本紀錄 entry labelled
 * 「刪除章節前」 for a chapter that was never deleted — or the reverse, which
 * is worse: the chapter gone and no snapshot to get it back from.
 */
async function appendSnapshot(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: { documentId: string; label: string; user: SessionUser }
): Promise<{ version: number }> {
  {
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

    const sceneSnapshot = await tx
      .select({
        id: scenes.id,
        sortOrder: scenes.sortOrder,
        code: scenes.code,
        heading: scenes.heading,
        location: scenes.location,
        timeOfDay: scenes.timeOfDay,
        content: scenes.content,
      })
      .from(scenes)
      .where(eq(scenes.documentId, input.documentId))
      .orderBy(asc(scenes.sortOrder))

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
        scenes: sceneSnapshot,
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
  }
}

/**
 * The 409 a stale save gets, naming whoever moved the document on.
 *
 * Shared by chapters and scenes: both are edited by two people at once, and a
 * different message for each would be a different bug for each.
 */
async function staleRevisionError(documentId: string): Promise<ApiError> {
  const [current] = await db
    .select({ lockRevision: documents.lockRevision, lastEditorId: documents.lastEditorId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1)

  const [editor] = current?.lastEditorId
    ? await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, current.lastEditorId))
        .limit(1)
    : []

  return new ApiError(
    409,
    `這份稿子已被${editor?.name ?? '另一位成員'}修改，請重新載入後再編輯，避免覆蓋對方的內容。`,
    'stale_revision',
    { currentRevision: current?.lockRevision ?? null }
  )
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

/** Same check, starting from a scene. */
export async function sceneProjectId(sceneId: string): Promise<string | null> {
  const [row] = await db
    .select({ projectId: episodes.projectId })
    .from(scenes)
    .innerJoin(documents, eq(documents.id, scenes.documentId))
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(eq(scenes.id, sceneId))
    .limit(1)

  return row?.projectId ?? null
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
