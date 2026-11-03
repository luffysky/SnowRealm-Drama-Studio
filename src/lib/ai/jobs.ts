import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '@/db'
import {
  aiJobAttempts,
  aiJobs,
  aiProviders,
  arcs,
  characters,
  documents,
  episodes,
  projects,
  versions,
  worldEntries,
} from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { adapterFor, envOnlyAnthropicAdapter } from './registry'
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
  userInstruction?: string
  includeWorld?: boolean
  includeCharacters?: boolean
}): Promise<AiContext> {
  const context: AiContext = {}
  let projectId = input.projectId ?? null

  if (input.userInstruction) context.userInstruction = input.userInstruction
  if (input.sourceText) context.sourceText = input.sourceText

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

/** Resolves the adapter that would serve `task`, or null when none can. */
export async function adapterForTask(
  task: AiTaskKind,
  providerId?: string | null
): Promise<{ adapter: AiAdapter; providerId: string | null } | null> {
  if (providerId) {
    const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1)
    if (!row) throw ApiError.notFound('找不到指定的 AI 供應商')

    const adapter = adapterFor(row)
    if (!adapter) {
      throw ApiError.notConfigured(`${row.label} 這類供應商尚未實作適配器，目前無法使用。`)
    }
    if (!adapter.supportedTasks.includes(task)) {
      throw ApiError.badRequest(`${row.label} 不支援這個任務類型`)
    }
    return { adapter, providerId: row.id }
  }

  const rows = await db.select().from(aiProviders).where(eq(aiProviders.enabled, true))
  for (const row of rows) {
    const adapter = adapterFor(row)
    if (!adapter || !adapter.supportedTasks.includes(task)) continue
    const status = await adapter.status()
    if (status.available) return { adapter, providerId: row.id }
  }

  const fallback = envOnlyAnthropicAdapter()
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

    const [snapshot] = await tx
      .insert(versions)
      .values({
        targetType: 'DOCUMENT',
        targetId: doc.id,
        version: nextVersion,
        snapshot: { content: input.content, kind: doc.kind },
        charCount,
        label: input.label,
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
