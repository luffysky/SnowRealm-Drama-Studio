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
import { applyAssignment } from './assignments'
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

  /*
   * 送純文字給模型，不要送 HTML (Z115).
   *
   * 小說編輯器傳的是它自己的原始內容，而那是 HTML。實測這部作品的 11 章：
   * 123,559 個字元裡 **43,928 個是標籤**——**35.6% 的 token 在買 `<p>`**。
   *
   * 而且不只是錢：標籤會干擾模型判斷段落。`<h2>` 跟 `<p>` 在模型眼裡就是
   * 內容的一部分，於是它要一邊讀故事一邊忽略排版。
   *
   * 修在這裡而不是修在編輯器，因為這是 sourceText 進入 AI 上下文的**唯一
   * 入口**——估價（`/api/ai/estimate`）跟真正送出（`/api/ai/jobs`）都走這
   * 一支。修在呼叫端就會變成「估的時候算標籤、送的時候不算」，那兩個數字
   * 是並排顯示給人看的。
   *
   * 對已經是純文字的輸入是等冪的：沒有標籤可以拿掉，只會順手 trim。
   */
  if (input.sourceText) context.sourceText = stripHtmlToText(input.sourceText)

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
  /*
   * 估價要用跟實際執行**同一組**設定 (Z152).
   *
   * 不然報的是 A 模型的價、跑的是 B 模型——那是跟那張壞掉的匯率表同一類的
   * 錯：每個數字看起來都像數字，只是跟事實無關。而這個數字是給人按下「確定
   * 要花這筆錢」之前看的。
   */
  const settled = await applyAssignment(input)

  const resolved = await adapterForTask(settled.task, settled.providerId ?? null)
  if (!resolved) {
    throw ApiError.notConfigured(
      'AI 功能尚未啟用：還沒有可用的 AI 供應商金鑰，無法估算費用。'
    )
  }

  return resolved.adapter.estimate({
    task: settled.task,
    context: settled.context,
    ...(settled.model ? { model: settled.model } : {}),
    ...(settled.candidates ? { candidates: settled.candidates } : {}),
    ...(settled.maxTokens ? { maxTokens: settled.maxTokens } : {}),
  })
}

/**
 * The only route from AI output into real data. Writes a version snapshot of
 * the *existing* content first, so applying a candidate is always reversible.
 */
/**
 * 採用之後到底寫了什麼 (Z71).
 *
 * `versionId` 本來是唯一的回報，而面板用「有沒有 versionId」來決定要說
 * 「已寫回，可在版本紀錄回溯」還是「還沒有自動寫回」。這對 document 目標是
 * 對的，但分鏡、角色設計、對白歸屬**都有寫進去、都沒有 version 快照**——照
 * 那個判斷法會對著一個剛建好 32 個鏡頭的任務說「還沒有自動寫回」。
 *
 * 所以回一句話：寫了什麼、寫進哪裡。沒寫就說沒寫。
 */
export type ApplyOutcome = {
  job: AiJobRow
  versionId: string | null
  /** 給人看的一句話；null 代表這份產出沒有自動寫回任何地方。 */
  wrote: string | null
}

export async function applyCandidate(input: {
  user: SessionUser
  jobId: string
  candidateIndex: number
}): Promise<ApplyOutcome> {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).limit(1)
  if (!job) throw ApiError.notFound('找不到該 AI 任務')
  if (job.status !== 'AWAITING_REVIEW') {
    throw ApiError.badRequest('只有「待人工確認」的任務可以套用')
  }

  const result = job.result as { candidates?: { label: string; content: string }[] } | null
  const candidate = result?.candidates?.[input.candidateIndex]
  if (!candidate) throw ApiError.badRequest('找不到指定的候選內容')

  /*
   * 對白歸屬自己有一條路 (Z132).
   *
   * 它寫的不是正文，是「第 37 段是誰說的」，所以 `applyToDocument` 幫不上
   * 忙。沒有這個分支的話，採用會走到下面去、把任務標成已採用、然後什麼都
   * 沒寫——正是 Z123 那個「說有寫入其實沒有」的老問題換一個殼。
   */
  if (job.targetType === 'episode_speakers') {
    const { applyAttribution } = await import('@/lib/attribution-job')
    await applyAttribution({ jobId: job.id, user: input.user })

    const [done] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id)).limit(1)
    return { job: done ?? job, versionId: null, wrote: '對白歸屬已寫入這一集' }
  }

  /*
   * 角色設計寫的是角色欄位，不是正文 (Z70).
   *
   * 跟上面那個分支同一個理由：沒有它的話，採用會走到下面的
   * `applyToDocument`，而這個任務沒有 document 目標——於是任務被標成已採用、
   * 角色一個字都沒變。那正是這裡要避免的那種「說有寫入其實沒有」。
   */
  if (job.targetType === 'character') {
    const { applyCharacterDesign } = await import('@/lib/character-design')
    await applyCharacterDesign({ jobId: job.id, user: input.user })

    const [done] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id)).limit(1)
    return { job: done ?? job, versionId: null, wrote: '角色的外觀與聲線已更新' }
  }

  /*
   * 分鏡寫的是鏡頭表，不是正文 (Z71).
   *
   * 跟上面兩個分支同一個理由。沒有它的話，採用會走到下面的
   * `applyToDocument`，而這個任務的目標是一集的鏡頭、不是一份 document——
   * 於是任務被標成已採用、一個鏡頭都沒建。
   */
  if (job.targetType === 'episode_shots') {
    const { applyStoryboard } = await import('@/lib/storyboard-apply')
    const { created } = await applyStoryboard({ jobId: job.id, user: input.user })

    const [done] = await db.select().from(aiJobs).where(eq(aiJobs.id, job.id)).limit(1)
    return { job: done ?? job, versionId: null, wrote: `建立了 ${created} 個鏡頭` }
  }

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

  return {
    job: updated,
    versionId,
    wrote: versionId ? '已寫回正文，原本的內容存成了版本' : null,
  }
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

/**
 * 看過了，不要這一份 (Z127-5).
 *
 * Distinct from `requestCancel`, which refuses anything past `RUNNING` — and
 * rightly: 「取消」 means stop doing this, and there is nothing left to stop.
 * This is the other half of a review, and until now it did not exist: output
 * you did not want could only be left in `AWAITING_REVIEW` forever, which is
 * how two outlines came to be sitting in it unread.
 *
 * The result payload is **kept**. It cost money, the model's refusal to write
 * EP001 from thin material was the single most useful thing it produced all
 * day, and 「捨棄」 is a decision about the novel, not a request to destroy
 * evidence.
 */
export async function discardCandidate(input: {
  user: SessionUser
  jobId: string
}): Promise<AiJobRow> {
  const [updated] = await db
    .update(aiJobs)
    .set({
      status: 'CANCELLED',
      finishedAt: sql`coalesce(${aiJobs.finishedAt}, now())`,
      progressNote: '已由人工捨棄',
      updatedAt: new Date(),
    })
    .where(and(eq(aiJobs.id, input.jobId), eq(aiJobs.status, 'AWAITING_REVIEW')))
    .returning()

  if (!updated) throw ApiError.badRequest('只有「待人工確認」的任務可以捨棄')

  await logActivity({
    user: input.user,
    action: 'ai.discard',
    entityType: 'ai_job',
    entityId: updated.id,
    projectId: updated.projectId,
    summary: `捨棄 AI 產出（${updated.kind}）`,
  })

  return updated
}
