import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  aiJobAttempts,
  aiJobs,
  aiProviders,
  arcs,
  chapters,
  characters,
  documents,
  episodes,
  projects,
  versions,
  worldEntries,
} from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import { stripHtmlToText } from '@/lib/utils'
import type { SessionUser } from '@/lib/auth/session'
import { adapterFor, aiOverrides, envOnlyAnthropicAdapter } from './registry'
import type { AiAdapter, AiContext, AiTaskKind } from './types'

/**
 * Reading and applying AI jobs.
 *
 * Execution lives in `./queue.ts` — nothing here runs a model. A finished job
 * sits in `AWAITING_REVIEW`; `applyCandidate` is the only path from AI output
 * into the novel, script or storyboard, it requires an explicit human
 * acknowledgement, and it snapshots the previous content first so applying is
 * always reversible.
 */

export type AiJobRow = typeof aiJobs.$inferSelect

/**
 * Gathers the canon context the model must respect: world entries flagged as
 * canon, the characters in the project, and the source text when relevant.
 */
export async function buildContext(input: {
  projectId?: string | null
  episodeId?: string | null
  sourceText?: string
  /**
   * Adapt from this episode's novel (Z113).
   *
   * The prose is fetched **here**, server-side, rather than being handed to
   * the browser and posted back: an episode is ten thousand characters, and
   * the only thing the client needs to say is which one.
   *
   * It is also what lets 劇本工坊 adapt from an episode other than the one
   * being written — a scene that carries over, or a restructure.
   */
  novelEpisodeId?: string | null
  userInstruction?: string
  includeWorld?: boolean
  includeCharacters?: boolean
}): Promise<AiContext> {
  const context: AiContext = {}
  let projectId = input.projectId ?? null

  if (input.userInstruction) context.userInstruction = input.userInstruction
  if (input.sourceText) context.sourceText = input.sourceText

  // An explicit novel wins: it is the thing being adapted.
  if (input.novelEpisodeId) {
    const prose = await episodeNovelText(input.novelEpisodeId)
    if (prose) context.sourceText = prose
  }

  if (input.episodeId) {
    const [row] = await db
      .select({
        number: episodes.number,
        title: episodes.title,
        targetSec: episodes.targetSec,
        projectTitle: projects.title,
        arcTitle: arcs.title,
        projectId: projects.id,
      })
      .from(episodes)
      .innerJoin(arcs, eq(arcs.id, episodes.arcId))
      .innerJoin(projects, eq(projects.id, episodes.projectId))
      .where(eq(episodes.id, input.episodeId))
      .limit(1)

    if (row) {
      context.episodeNumber = row.number
      context.episodeTitle = row.title || undefined
      context.targetSec = row.targetSec
      context.projectTitle = row.projectTitle
      context.arcTitle = row.arcTitle
      projectId ??= row.projectId
    }
  } else if (projectId) {
    const [row] = await db
      .select({ title: projects.title })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    if (row) context.projectTitle = row.title
  }

  if (projectId && input.includeWorld !== false) {
    const rows = await db
      .select({
        title: worldEntries.title,
        category: worldEntries.category,
        body: worldEntries.body,
      })
      .from(worldEntries)
      /*
       * Soft-deleted rows are excluded here as well as in the UI.
       *
       * They were not, and it showed: two placeholder characters the pair had
       * already deleted kept arriving as canon, and the model — correctly —
       * stopped to ask who they were. A deletion the AI cannot see is a
       * deletion that still costs money on every call.
       */
      .where(
        and(
          eq(worldEntries.projectId, projectId),
          eq(worldEntries.isCanon, true),
          isNull(worldEntries.deletedAt)
        )
      )
      .limit(60)

    if (rows.length > 0) context.worldEntries = rows
  }

  if (projectId && input.includeCharacters !== false) {
    const rows = await db
      .select({
        name: characters.name,
        tier: characters.tier,
        appearance: characters.appearance,
        personality: characters.personality,
      })
      .from(characters)
      .where(and(eq(characters.projectId, projectId), isNull(characters.deletedAt)))
      .limit(60)

    if (rows.length > 0) {
      context.characters = rows.map((r) => ({
        name: r.name,
        tier: r.tier,
        appearance: r.appearance || undefined,
        personality: r.personality || undefined,
      }))
    }
  }

  return context
}

/**
 * One episode's novel, in chapter order, as plain text.
 *
 * Markup stripped: the model is being asked to adapt a story, and the
 * editor's HTML is noise it would be charged for by the token.
 */
export async function episodeNovelText(episodeId: string): Promise<string> {
  const rows = await db
    .select({ title: chapters.title, content: chapters.content })
    .from(chapters)
    .innerJoin(documents, eq(documents.id, chapters.documentId))
    .where(
      and(
        eq(documents.episodeId, episodeId),
        eq(documents.kind, 'NOVEL'),
        isNull(documents.deletedAt)
      )
    )
    .orderBy(asc(chapters.sortOrder))

  return rows
    .map((row) => [row.title, stripHtmlToText(row.content)].filter(Boolean).join('\n'))
    .join('\n\n')
    .trim()
}

/**
 * Which episodes have a novel worth adapting, for the source picker.
 *
 * Only ones with prose in them: an empty episode is not a source, and
 * offering it is offering a button that spends money to be told there is
 * nothing to read.
 */
export async function novelSources(
  projectId: string
): Promise<{ id: string; number: number; title: string; charCount: number }[]> {
  const rows = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      charCount: sql<number>`coalesce(sum(${chapters.charCount}), 0)`.mapWith(Number),
    })
    .from(episodes)
    .innerJoin(
      documents,
      and(
        eq(documents.episodeId, episodes.id),
        eq(documents.kind, 'NOVEL'),
        isNull(documents.deletedAt)
      )
    )
    .innerJoin(chapters, eq(chapters.documentId, documents.id))
    .where(eq(episodes.projectId, projectId))
    .groupBy(episodes.id, episodes.number, episodes.title)
    .orderBy(asc(episodes.number))

  return rows.filter((row) => row.charCount > 0)
}

/** Resolves the adapter that would serve `task`, or null when none can. */
export async function adapterForTask(
  task: AiTaskKind,
  providerId?: string | null
): Promise<{ adapter: AiAdapter; providerId: string | null } | null> {
  if (providerId) {
    const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1)
    if (!row) throw ApiError.notFound('找不到指定的 AI 供應商')

    const adapter = adapterFor(row, await aiOverrides())
    if (!adapter) {
      throw ApiError.notConfigured(`${row.label} 這類供應商尚未實作適配器，目前無法使用。`)
    }
    if (!adapter.supportedTasks.includes(task)) {
      throw ApiError.badRequest(`${row.label} 不支援這個任務類型`)
    }
    return { adapter, providerId: row.id }
  }

  const rows = await db.select().from(aiProviders).where(eq(aiProviders.enabled, true))
  const overrides = await aiOverrides()

  for (const row of rows) {
    const adapter = adapterFor(row, overrides)
    if (!adapter || !adapter.supportedTasks.includes(task)) continue
    const status = await adapter.status()
    if (status.available) return { adapter, providerId: row.id }
  }

  const fallback = envOnlyAnthropicAdapter(overrides)
  const status = await fallback.status()
  if (status.available && fallback.supportedTasks.includes(task)) {
    return { adapter: fallback, providerId: null }
  }

  return null
}

/**
 * Token and cost estimate shown before the user commits to spending money
 * (spec v2 §6.7「預估與已實際發生費用分開紀錄」).
 */
export async function estimateJob(input: {
  task: AiTaskKind
  providerId?: string | null
  model?: string
  candidates?: number
  maxTokens?: number
  context: AiContext
}) {
  const resolved = await adapterForTask(input.task, input.providerId ?? null)
  if (!resolved) {
    throw ApiError.notConfigured(
      'AI 功能尚未啟用：還沒有可用的 AI 供應商金鑰，無法估算費用。'
    )
  }

  return resolved.adapter.estimate({
    task: input.task,
    context: input.context,
    ...(input.model ? { model: input.model } : {}),
    ...(input.candidates ? { candidates: input.candidates } : {}),
    ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
  })
}

/**
 * The only route from AI output into real data. Writes a version snapshot of
 * the *existing* content first, so applying a candidate is always reversible.
 */
export async function applyCandidate(input: {
  user: SessionUser
  jobId: string
  candidateIndex: number
}): Promise<{ job: AiJobRow; versionId: string | null }> {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).limit(1)
  if (!job) throw ApiError.notFound('找不到該 AI 任務')
  if (job.status !== 'AWAITING_REVIEW') {
    throw ApiError.badRequest('只有「待人工確認」的任務可以套用')
  }

  const result = job.result as { candidates?: { label: string; content: string }[] } | null
  const candidate = result?.candidates?.[input.candidateIndex]
  if (!candidate) throw ApiError.badRequest('找不到指定的候選內容')

  let versionId: string | null = null

  // Only document targets are written automatically; other target types are
  // applied by the user in their own editor, with the job as the source.
  if (job.targetType === 'document' && job.targetId) {
    versionId = await applyToDocument({
      documentId: job.targetId,
      content: candidate.content,
      user: input.user,
      jobId: job.id,
      label: `AI ${job.kind} 採用${candidate.label}`,
    })
  }

  const [updated] = await db
    .update(aiJobs)
    .set({
      status: 'SUCCEEDED',
      appliedById: input.user.id,
      appliedAt: new Date(),
      appliedVersionId: versionId,
      progressNote: '已由人工採用',
      updatedAt: new Date(),
    })
    .where(eq(aiJobs.id, job.id))
    .returning()

  if (!updated) throw new Error('Failed to mark AI job as applied')

  await logActivity({
    user: input.user,
    action: 'ai.apply',
    entityType: job.targetType || 'ai_job',
    entityId: job.targetId ?? job.id,
    projectId: job.projectId,
    summary: `套用 AI 產出（${job.kind} / ${candidate.label}）`,
  })

  return { job: updated, versionId }
}

async function applyToDocument(input: {
  documentId: string
  content: string
  user: SessionUser
  jobId: string
  label: string
}): Promise<string> {
  return db.transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, input.documentId))
      .limit(1)

    if (!doc) throw ApiError.notFound('找不到目標文件')

    const nextVersion = doc.version + 1
    const charCount = input.content.replace(/\s/g, '').length

    /*
     * The snapshot holds what was **there**, not what is about to replace it.
     *
     * It used to store `input.content` — the AI's output — under a label
     * saying 「採用候選一」, so the thing the UI called a backup was a second
     * copy of the new text. Restoring it would have handed back the AI's
     * version again, and the original would have been nowhere. The whole
     * promise of 「原本的內容仍在版本紀錄裡」 rested on this one line.
     */
    const [snapshot] = await tx
      .insert(versions)
      .values({
        targetType: 'DOCUMENT',
        targetId: doc.id,
        version: nextVersion,
        snapshot: { content: doc.content, kind: doc.kind },
        charCount: doc.charCount,
        label: `${input.label}（這一版是採用前的內容）`,
        aiJobId: input.jobId,
        authorId: input.user.id,
        authorName: input.user.name,
      })
      .returning({ id: versions.id })

    if (!snapshot) throw new Error('Failed to write version snapshot')

    await tx
      .update(documents)
      .set({
        content: input.content,
        charCount,
        version: nextVersion,
        lastEditorId: input.user.id,
        lockRevision: doc.lockRevision + 1,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id))

    return snapshot.id
  })
}

export async function listJobs(input: {
  projectId?: string | null
  status?: AiJobRow['status']
  limit?: number
}): Promise<AiJobRow[]> {
  const conditions = []
  if (input.projectId) conditions.push(eq(aiJobs.projectId, input.projectId))
  if (input.status) conditions.push(eq(aiJobs.status, input.status))

  return db
    .select()
    .from(aiJobs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(aiJobs.createdAt))
    .limit(Math.min(input.limit ?? 50, 200))
}

export type QueueRow = {
  id: string
  kind: AiJobRow['kind']
  status: AiJobRow['status']
  model: string
  projectId: string | null
  projectTitle: string
  episodeNumber: number | null
  attemptCount: number
  maxAttempts: number
  errorMessage: string
  estimatedCost: string | null
  actualCost: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

/**
 * The queue, as 「AI 製片中心」 shows it (Z88).
 *
 * Joined rather than N+1: the page lists which work and which episode each job
 * belongs to, and a job id on its own answers neither. The request and result
 * payloads are deliberately left out — they are large, often the whole
 * chapter, and nothing on a list view reads them.
 */
export async function listQueue(input: {
  status?: AiJobRow['status']
  limit?: number
}): Promise<QueueRow[]> {
  const rows = await db
    .select({
      id: aiJobs.id,
      kind: aiJobs.kind,
      status: aiJobs.status,
      model: aiJobs.model,
      projectId: aiJobs.projectId,
      projectTitle: projects.title,
      episodeNumber: episodes.number,
      attemptCount: aiJobs.attemptCount,
      maxAttempts: aiJobs.maxAttempts,
      errorMessage: aiJobs.errorMessage,
      estimatedCost: aiJobs.estimatedCost,
      actualCost: aiJobs.actualCost,
      createdAt: aiJobs.createdAt,
      startedAt: aiJobs.startedAt,
      finishedAt: aiJobs.finishedAt,
    })
    .from(aiJobs)
    .leftJoin(projects, eq(projects.id, aiJobs.projectId))
    .leftJoin(episodes, eq(episodes.id, aiJobs.episodeId))
    .where(input.status ? eq(aiJobs.status, input.status) : undefined)
    .orderBy(desc(aiJobs.createdAt))
    .limit(Math.min(input.limit ?? 60, 200))

  return rows.map((row) => ({
    ...row,
    projectTitle: row.projectTitle ?? '',
  }))
}

/** How many jobs sit in each state, for the queue's summary strip. */
export async function queueCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: aiJobs.status, n: count() })
    .from(aiJobs)
    .groupBy(aiJobs.status)

  return Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]))
}

/** One job with its attempt history, for the queue dialog's detail view. */
export async function getJobWithAttempts(jobId: string): Promise<{
  job: AiJobRow
  attempts: (typeof aiJobAttempts.$inferSelect)[]
} | null> {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1)
  if (!job) return null

  const attempts = await db
    .select()
    .from(aiJobAttempts)
    .where(eq(aiJobAttempts.jobId, jobId))
    .orderBy(aiJobAttempts.attempt)

  return { job, attempts }
}
