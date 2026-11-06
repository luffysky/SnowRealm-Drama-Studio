import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { db } from '@/db'
import { aiJobs, episodes, projects } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { buildContext, estimateJob } from './jobs'
import { applyTargetFor } from './apply-targets'
import { enqueueJob } from './queue'
import {
  BATCH_TASKS,
  MAX_BATCH,
  type BatchCandidate,
  type BatchPlan,
  type BatchResult,
  type BatchTask,
} from './batch-view'

export { BATCH_TASKS, MAX_BATCH }
export type { BatchCandidate, BatchPlan, BatchResult, BatchTask }

/**
 * 批次生成 (Z127-3).
 *
 * 「EP006–EP020 全部產大綱」. Doing that one episode at a time through the
 * editor is fifteen trips through a dialog, and the two of us writing 120
 * episodes are going to want it for every stage, not just outlines.
 *
 * The whole design problem here is that this is the one screen that can spend
 * real money in one press. So:
 *
 *  - **It refuses to double-pay.** An episode that already has a job of the
 *    same kind queued, running or waiting for review is skipped and says so.
 *    Re-running after accepting the last output is legitimate; re-running
 *    while the last one is still sitting unread is just paying twice.
 *  - **It refuses to generate from nothing.** 小說轉劇本 on an episode with
 *    no prose produces a confident invention, which is the exact failure spec
 *    v3 §0 exists to prevent. Those episodes are skipped with the reason.
 *  - **It is capped.** {@link MAX_BATCH} episodes per press, so a typo in the
 *    range cannot queue 120 jobs.
 *  - **It estimates before it commits**, and reports the total, so the figure
 *    in the confirmation is the sum of the real per-episode estimates rather
 *    than one episode's multiplied up.
 *
 * It does not run anything. Like every other path, it fills the queue and the
 * worker picks it up.
 */

/** What each task needs to exist before it can say anything true. */
const REQUIRES: Record<BatchTask, 'novel' | 'script' | null> = {
  OUTLINE_GENERATE: null,
  NOVEL_TO_SCRIPT: 'novel',
  NOVEL_REVIEW: 'novel',
  SCRIPT_ANALYZE: 'script',
  STORYBOARD_GENERATE: 'script',
}

/**
 * What a batch would do, without doing it.
 *
 * The dialog needs this before anybody presses anything: which episodes are
 * in, which are out and why, and what the whole thing is estimated to cost.
 * Estimating is a token count per episode, so it is done in parallel and its
 * failure is not fatal — a provider that cannot count tokens must not stop
 * the batch, the same rule the single-job route follows.
 */
export async function planBatch(input: {
  projectId: string
  task: BatchTask
  from: number
  to: number
  /** Skip the per-episode token counts, for a plan that only needs the list. */
  estimate?: boolean
}): Promise<BatchPlan> {
  const [project] = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
    .limit(1)

  if (!project) throw ApiError.notFound('找不到這個作品')

  const lo = Math.min(input.from, input.to)
  const hi = Math.max(input.from, input.to)

  const found = await db
    .select({ id: episodes.id, number: episodes.number, title: episodes.title })
    .from(episodes)
    .where(
      and(
        eq(episodes.projectId, project.id),
        isNull(episodes.deletedAt),
        gte(episodes.number, lo),
        lte(episodes.number, hi)
      )
    )
    .orderBy(asc(episodes.number))

  const capped = found.length > MAX_BATCH
  const inRange = found.slice(0, MAX_BATCH)

  if (inRange.length === 0) {
    return {
      task: input.task,
      projectId: project.id,
      projectTitle: project.title,
      candidates: [],
      runnable: 0,
      skipped: 0,
      estimatedTotal: null,
      capped,
    }
  }

  const ids = inRange.map((row) => row.id)

  /*
   * Three set-at-a-time queries rather than three per episode. Thirty
   * episodes would otherwise be ninety round trips to render a dialog.
   */
  const idList = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `
  )

  /*
   * Raw SQL for the two content counts rather than the query builder.
   *
   * These aggregate a joined table inside a grouped select, and Drizzle
   * renders an interpolated column **unqualified** in a select list — the
   * same thing that made `assistant/threads.ts`'s correlated subqueries
   * silently compile to always-false. Written out, there is nothing to get
   * wrong.
   */
  const [novel, script, busy] = await Promise.all([
    db.execute<{ episode_id: string; chars: string }>(sql`
      select d.episode_id::text as episode_id,
             coalesce(sum(ch.char_count), 0)::text as chars
        from documents d
        left join chapters ch on ch.document_id = d.id
       where d.episode_id in (${idList})
         and d.kind = 'NOVEL'
         and d.deleted_at is null
       group by d.episode_id
    `),

    db.execute<{ episode_id: string; scenes: string }>(sql`
      select d.episode_id::text as episode_id,
             count(sc.id)::text as scenes
        from documents d
        left join scenes sc on sc.document_id = d.id
       where d.episode_id in (${idList})
         and d.kind = 'SCRIPT'
         and d.deleted_at is null
       group by d.episode_id
    `),

    db
      .select({ episodeId: aiJobs.episodeId, status: aiJobs.status })
      .from(aiJobs)
      .where(
        and(
          inArray(aiJobs.episodeId, ids),
          eq(aiJobs.kind, input.task),
          inArray(aiJobs.status, ['QUEUED', 'RUNNING', 'AWAITING_PROVIDER', 'AWAITING_REVIEW'])
        )
      ),
  ])

  const charsBy = new Map(novel.rows.map((row) => [row.episode_id, Number(row.chars)]))
  const scenesBy = new Map(script.rows.map((row) => [row.episode_id, Number(row.scenes)]))
  const busyBy = new Map(busy.map((row) => [row.episodeId, row.status]))

  const needs = REQUIRES[input.task]

  const candidates: BatchCandidate[] = inRange.map((episode) => {
    const novelChars = charsBy.get(episode.id) ?? 0
    const scriptScenes = scenesBy.get(episode.id) ?? 0
    const pending = busyBy.get(episode.id)

    let skipReason: string | null = null

    if (pending) {
      skipReason =
        pending === 'AWAITING_REVIEW'
          ? '已經有一份產出在等確認，先處理掉再重跑'
          : '已經有一筆同樣的任務在排隊或執行中'
    } else if (needs === 'novel' && novelChars === 0) {
      skipReason = '這一集還沒有小說內容，沒有東西可以改編'
    } else if (needs === 'script' && scriptScenes === 0) {
      skipReason = '這一集還沒有劇本場次'
    }

    return {
      episodeId: episode.id,
      number: episode.number,
      title: episode.title,
      skipReason,
      novelChars,
      scriptScenes,
    }
  })

  const runnable = candidates.filter((row) => row.skipReason === null)

  let estimatedTotal: number | null = null

  if (input.estimate !== false && runnable.length > 0) {
    const estimates = await Promise.all(
      runnable.map(async (row) => {
        try {
          const context = await buildContext({
            projectId: project.id,
            episodeId: row.episodeId,
            novelEpisodeId: needs === 'novel' ? row.episodeId : null,
            userInstruction: '',
            includeWorld: true,
            includeCharacters: true,
          })
          const estimate = await estimateJob({
            task: input.task,
            providerId: null,
            candidates: 1,
            context,
          })
          return estimate.estimatedCostUsd
        } catch {
          // Informational. A provider that cannot count must not block.
          return null
        }
      })
    )

    const priced = estimates.filter((value): value is number => value !== null)
    estimatedTotal = priced.length > 0 ? priced.reduce((n, value) => n + value, 0) : null
  }

  return {
    task: input.task,
    projectId: project.id,
    projectTitle: project.title,
    candidates,
    runnable: runnable.length,
    skipped: candidates.length - runnable.length,
    estimatedTotal,
    capped,
  }
}

/**
 * Queues the batch.
 *
 * Re-plans rather than trusting a plan from the client: the dialog's list is
 * seconds old, and in those seconds the other member may have started the
 * same job from their editor. Checking again here is what makes the
 * 「不重複扣費」 promise hold rather than nearly hold.
 *
 * One episode failing does not stop the rest. A batch that queues eleven of
 * fifteen and says which four did not is more use than one that rolls back
 * because EP013 has no prose.
 */
export async function enqueueBatch(input: {
  user: SessionUser
  projectId: string
  task: BatchTask
  from: number
  to: number
  userInstruction?: string
  model?: string
  providerId?: string | null
}): Promise<BatchResult> {
  const plan = await planBatch({
    projectId: input.projectId,
    task: input.task,
    from: input.from,
    to: input.to,
    estimate: false,
  })

  const queued: BatchResult['queued'] = []
  const skipped: BatchResult['skipped'] = plan.candidates
    .filter((row) => row.skipReason !== null)
    .map((row) => ({ number: row.number, reason: row.skipReason! }))

  const needs = REQUIRES[input.task]
  let estimatedTotal = 0
  let priced = false

  /*
   * Sequential on purpose, though it is slower.
   *
   * Thirty parallel enqueues means thirty parallel token counts against the
   * provider, which is the fastest way to get rate-limited at the exact
   * moment somebody is watching a progress dialog. In order also means the
   * queue runs EP006 before EP007, which is what anybody batching a range
   * expects to happen.
   */
  for (const row of plan.candidates) {
    if (row.skipReason !== null) continue

    try {
      const context = await buildContext({
        projectId: input.projectId,
        episodeId: row.episodeId,
        novelEpisodeId: needs === 'novel' ? row.episodeId : null,
        userInstruction: input.userInstruction ?? '',
        includeWorld: true,
        includeCharacters: true,
      })

      let estimatedCostUsd: number | null = null
      try {
        const estimate = await estimateJob({
          task: input.task,
          providerId: input.providerId ?? null,
          ...(input.model ? { model: input.model } : {}),
          candidates: 1,
          context,
        })
        estimatedCostUsd = estimate.estimatedCostUsd
        if (estimatedCostUsd !== null) {
          estimatedTotal += estimatedCostUsd
          priced = true
        }
      } catch {
        /* Estimates are informational. */
      }

      const { job } = await enqueueJob({
        user: input.user,
        task: input.task,
        context,
        projectId: input.projectId,
        episodeId: row.episodeId,
        providerId: input.providerId ?? null,
        ...(input.model ? { model: input.model } : {}),
        candidates: 1,
        /*
         * 目標跟編輯器用同一張表 (Z30).
         *
         * 這裡本來寫死 `''`，理由是「不讓 AI 的產出未經人看過就寫進文件」
         * ——但 `targetType` 不會讓任何東西自動寫入，它只說人按下採用之後要
         * 寫到哪。任務照樣停在 `AWAITING_REVIEW`，收件匣照樣要求先看過全文。
         *
         * 空字串換來的不是安全，是**批次產出的東西一樣都套用不了**：十五集
         * 的改編跑完，每一集還是得回編輯器重跑一次——而批次存在的理由正是不
         * 要這樣。分鏡也在 `BATCH_TASKS` 裡，所以它一直有同一個問題。
         */
        targetType: applyTargetFor(input.task),
        targetId: null,
        idempotencyKey: crypto.randomUUID(),
        estimatedCostUsd,
      })

      queued.push({ episodeId: row.episodeId, number: row.number, jobId: job.id })
    } catch (cause) {
      skipped.push({
        number: row.number,
        reason: cause instanceof Error ? cause.message : '排入佇列失敗',
      })
    }
  }

  return { queued, skipped, estimatedTotal: priced ? estimatedTotal : null }
}
