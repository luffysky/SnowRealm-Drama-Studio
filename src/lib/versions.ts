import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { chapters, documents, episodes, scenes, versions } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import type { DocumentKindValue } from '@/lib/constants'
import { countRichTextChars } from '@/lib/utils'
import { estimateSceneSeconds } from '@/lib/writing'

/**
 * 版本紀錄 (design 08).
 *
 * History is append-only. Restoring an earlier version does not rewrite
 * anything — it writes two new rows: one holding the state just before the
 * restore, and one holding the restored content with a pointer to where it
 * came from. Nothing a member wrote can be removed by someone else's undo.
 */

export type VersionSnapshot = {
  kind: DocumentKindValue
  chapters?: { id: string; sortOrder: number; title: string; summary: string; content: string }[]
  scenes?: {
    id: string
    sortOrder: number
    code: string
    heading: string
    location: string
    timeOfDay: string
    content: string
  }[]
}

export type VersionRow = {
  id: string
  documentId: string
  version: number
  label: string
  charCount: number
  /** Difference from the previous version of the same document. */
  charDelta: number
  authorName: string
  isApproved: boolean
  restoredFromVersionId: string | null
  aiJobId: string | null
  createdAt: Date
  kind: DocumentKindValue
  episodeNumber: number
  episodeTitle: string
}

export type VersionStats = {
  total: number
  approved: number
  drafts: number
  restorePoints: number
  contributors: number
  lastUpdatedAt: Date | null
}

export type VersionFilters = {
  kind?: DocumentKindValue
  episodeId?: string
  search?: string
}

/** Every version belonging to a project, newest first. */
export async function listVersions(
  projectId: string,
  filters: VersionFilters = {}
): Promise<VersionRow[]> {
  const docs = await projectDocuments(projectId, filters)
  if (docs.length === 0) return []

  const byDocument = new Map(docs.map((d) => [d.id, d]))

  const rows = await db
    .select({
      id: versions.id,
      documentId: versions.targetId,
      version: versions.version,
      label: versions.label,
      charCount: versions.charCount,
      authorName: versions.authorName,
      isApproved: versions.isApproved,
      restoredFromVersionId: versions.restoredFromVersionId,
      aiJobId: versions.aiJobId,
      createdAt: versions.createdAt,
    })
    .from(versions)
    .where(
      and(
        eq(versions.targetType, 'DOCUMENT'),
        inArray(
          versions.targetId,
          docs.map((d) => d.id)
        )
      )
    )
    .orderBy(desc(versions.createdAt))

  const search = filters.search?.trim().toLowerCase()
  const filtered = search
    ? rows.filter((row) => row.label.toLowerCase().includes(search))
    : rows

  /*
   * The delta is against the previous version of the *same document*, not the
   * previous row in this list — the list interleaves documents, and "+136 字"
   * measured against another episode's script would be meaningless.
   */
  const previousOf = new Map<string, number>()
  for (const row of [...rows].sort((a, b) => a.version - b.version)) {
    const key = `${row.documentId}:${row.version}`
    const last = previousOf.get(row.documentId) ?? 0
    previousOf.set(key, last)
    previousOf.set(row.documentId, row.charCount)
  }

  return filtered.map((row) => {
    const document = byDocument.get(row.documentId)!
    return {
      id: row.id,
      documentId: row.documentId,
      version: row.version,
      label: row.label,
      charCount: row.charCount,
      charDelta: row.charCount - (previousOf.get(`${row.documentId}:${row.version}`) ?? 0),
      authorName: row.authorName,
      isApproved: row.isApproved,
      restoredFromVersionId: row.restoredFromVersionId,
      aiJobId: row.aiJobId,
      createdAt: row.createdAt,
      kind: document.kind,
      episodeNumber: document.number,
      episodeTitle: document.title,
    }
  })
}

export async function versionStats(projectId: string): Promise<VersionStats> {
  const rows = await listVersions(projectId)

  return {
    total: rows.length,
    approved: rows.filter((r) => r.isApproved).length,
    drafts: rows.filter((r) => !r.isApproved).length,
    restorePoints: rows.filter((r) => r.restoredFromVersionId !== null).length,
    contributors: new Set(rows.map((r) => r.authorName).filter(Boolean)).size,
    lastUpdatedAt: rows[0]?.createdAt ?? null,
  }
}

/** One version with its snapshot, scoped to the project. */
export async function getVersion(
  projectId: string,
  versionId: string
): Promise<(VersionRow & { snapshot: VersionSnapshot }) | null> {
  const [row] = await db
    .select()
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.targetType, 'DOCUMENT')))
    .limit(1)

  if (!row) return null

  const docs = await projectDocuments(projectId)
  const document = docs.find((d) => d.id === row.targetId)
  // Belongs to another project: indistinguishable from not existing.
  if (!document) return null

  const all = await listVersions(projectId)
  const summary = all.find((v) => v.id === versionId)
  if (!summary) return null

  return { ...summary, snapshot: row.snapshot as VersionSnapshot }
}

/** Flattens a snapshot into readable text, for the diff viewer. */
export function snapshotText(snapshot: VersionSnapshot): string {
  if (snapshot.scenes?.length) {
    return snapshot.scenes
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((scene) => `${scene.code} ${scene.heading}\n${stripHtml(scene.content)}`)
      .join('\n\n')
  }

  return (snapshot.chapters ?? [])
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((chapter) => `${chapter.title}\n${stripHtml(chapter.content)}`)
    .join('\n\n')
}

/**
 * Markup out, paragraph breaks in.
 *
 * A diff of raw HTML reports a changed class attribute as a changed sentence,
 * which is worse than no diff at all.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Restores an earlier version.
 *
 * Appends twice and rewrites nothing:
 *   1. the state as it is now, so the restore itself is undoable;
 *   2. the restored content, pointing at the version it came from.
 *
 * Spec 08:「還原永遠不改寫歷史」. Someone restoring a week-old draft must not be
 * able to destroy what the other member wrote yesterday.
 */
export async function restoreVersion(input: {
  projectId: string
  versionId: string
  user: SessionUser
}): Promise<{ version: number }> {
  const target = await getVersion(input.projectId, input.versionId)
  if (!target) throw ApiError.notFound('找不到這個版本')

  return db.transaction(async (tx) => {
    const [document] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, target.documentId))
      .limit(1)

    if (!document) throw ApiError.notFound('找不到這份文件')

    // --- 1. keep the current state -------------------------------------
    const [liveChapters, liveScenes] = await Promise.all([
      tx.select().from(chapters).where(eq(chapters.documentId, document.id)),
      tx.select().from(scenes).where(eq(scenes.documentId, document.id)),
    ])

    const beforeVersion = document.version + 1
    await tx.insert(versions).values({
      targetType: 'DOCUMENT',
      targetId: document.id,
      version: beforeVersion,
      snapshot: {
        kind: document.kind,
        chapters: liveChapters.map((row) => ({
          id: row.id,
          sortOrder: row.sortOrder,
          title: row.title,
          summary: row.summary,
          content: row.content,
        })),
        scenes: liveScenes.map((row) => ({
          id: row.id,
          sortOrder: row.sortOrder,
          code: row.code,
          heading: row.heading,
          location: row.location,
          timeOfDay: row.timeOfDay,
          content: row.content,
        })),
      },
      charCount: document.charCount,
      label: `回溯前自動存檔（回到 v${target.version} 之前）`,
      authorId: input.user.id,
      authorName: input.user.name,
    })

    // --- 2. write the snapshot back ------------------------------------
    const snapshot = target.snapshot

    if (snapshot.chapters) {
      await tx.delete(chapters).where(eq(chapters.documentId, document.id))
      if (snapshot.chapters.length > 0) {
        await tx.insert(chapters).values(
          snapshot.chapters.map((row) => ({
            // Same ids, so anything referencing a chapter still resolves.
            id: row.id,
            documentId: document.id,
            sortOrder: row.sortOrder,
            title: row.title,
            summary: row.summary,
            content: row.content,
            charCount: countRichTextChars(row.content),
          }))
        )
      }
    }

    if (snapshot.scenes) {
      await tx.delete(scenes).where(eq(scenes.documentId, document.id))
      if (snapshot.scenes.length > 0) {
        await tx.insert(scenes).values(
          snapshot.scenes.map((row) => ({
            id: row.id,
            documentId: document.id,
            sortOrder: row.sortOrder,
            code: row.code,
            heading: row.heading,
            location: row.location,
            timeOfDay: row.timeOfDay,
            content: row.content,
            /*
             * 還原會把預估片長洗成 0 (Z30).
             *
             * 快照裡沒有 `estimatedSec`（上面那段存的時候就沒存），所以這裡
             * 不給就落在欄位預設值 0——**還原一個劇本版本，每一場的預估片長
             * 都歸零**。而 `production-findings` 與 `stage-sync` 讀的是
             * `sum(estimated_sec)`，於是那一集會變成「0 秒，離目標還差很
             * 遠」，然後體檢照這個數字叫人去加戲。
             *
             * 跟上面 chapters 重算 `charCount` 是同一個處理：**衍生欄位從內
             * 容重算，不要從快照帶**。這樣快照裡存不存它都不影響正確性。
             */
            estimatedSec: estimateSceneSeconds(row.content),
          }))
        )
      }
    }

    // --- 3. record the restore ------------------------------------------
    const restoredVersion = beforeVersion + 1
    const charCount =
      (snapshot.chapters ?? []).reduce((n, r) => n + countRichTextChars(r.content), 0) +
      (snapshot.scenes ?? []).reduce((n, r) => n + countRichTextChars(r.content), 0)

    await tx.insert(versions).values({
      targetType: 'DOCUMENT',
      targetId: document.id,
      version: restoredVersion,
      snapshot,
      charCount,
      label: `還原自 v${target.version}`,
      restoredFromVersionId: target.id,
      authorId: input.user.id,
      authorName: input.user.name,
    })

    await tx
      .update(documents)
      .set({
        version: restoredVersion,
        charCount,
        // Everyone's open editor is now stale, which is the truth.
        lockRevision: sql`${documents.lockRevision} + 1`,
        lastEditorId: input.user.id,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, document.id))

    return { version: restoredVersion }
  })
}

/** The project's documents, with their episode context. */
async function projectDocuments(projectId: string, filters: VersionFilters = {}) {
  const conditions = [eq(episodes.projectId, projectId), isNull(episodes.deletedAt)]
  if (filters.kind) conditions.push(eq(documents.kind, filters.kind))
  if (filters.episodeId) conditions.push(eq(documents.episodeId, filters.episodeId))

  return db
    .select({
      id: documents.id,
      kind: documents.kind,
      number: episodes.number,
      title: episodes.title,
    })
    .from(documents)
    .innerJoin(episodes, eq(episodes.id, documents.episodeId))
    .where(and(...conditions))
}
