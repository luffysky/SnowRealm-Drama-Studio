import crypto from 'node:crypto'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { aiJobAttempts, aiJobs, aiOutputs, expenses } from '@/db/schema'
import { ApiError } from '@/lib/api'
import { assertWithinBudget, recordActual, recordEstimate } from '@/lib/usage'
import type { SessionUser } from '@/lib/auth/session'
import { adapterFor, envOnlyAnthropicAdapter } from './registry'
import { aiProviders } from '@/db/schema'
import { AiAdapterError, type AiAdapter, type AiContext, type AiRunRequest, type AiTaskKind } from './types'

/**
 * Durable AI job queue (spec v2 §6.6).
 *
 * Jobs are never executed inside the HTTP request that creates them: a long
 * generation exceeds the serverless function limit, and a dropped connection
 * would lose work already paid for. `enqueueJob` writes a QUEUED row and
 * returns; `runDueJobs` — invoked by `/api/ai/worker` on a schedule — claims
 * and executes them.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so two concurrent worker invocations
 * take different jobs instead of racing for the same one.
 */

export type AiJobRow = typeof aiJobs.$inferSelect

/** Retry backoff: 30s, 2m, 8m. Capped so a stuck job stops consuming slots. */
const BACKOFF_SECONDS = [30, 120, 480]

/** A claimed job older than this is assumed abandoned and may be reclaimed. */
const LEASE_TIMEOUT_MS = 10 * 60 * 1000

export type EnqueueInput = {
  user: SessionUser
  task: AiTaskKind
  context: AiContext
  projectId?: string | null
  episodeId?: string | null
  providerId?: string | null
  model?: string
  candidates?: number
  effort?: AiRunRequest['effort']
  maxTokens?: number
  targetType?: string
  targetId?: string | null
  /** Caller-supplied; makes a resubmission return the same job. */
  idempotencyKey?: string | null
  priority?: number
  estimatedCostUsd?: number | null
}

/**
 * Creates a QUEUED job, or returns the existing one when `idempotencyKey`
 * matches — so a double-clicked button or a retried request cannot pay twice.
 */
export async function enqueueJob(input: EnqueueInput): Promise<{
  job: AiJobRow
  deduplicated: boolean
  budgetWarning?: string
}> {
  // Fail fast when nothing can serve the task, rather than queueing a job that
  // can only ever fail.
  await assertTaskServiceable(input.task, input.providerId ?? null)

  /*
   * Budget gate (spec v2 §6.7). Enforced here, before the row exists: once a
   * job is queued the worker will run it, so refusing afterwards would be too
   * late. Checked against settled *and* committed spend, so a burst of queued
   * jobs cannot collectively overshoot the cap.
   */
  let budgetWarning: string | undefined
  if (input.projectId && (input.estimatedCostUsd ?? 0) > 0) {
    const verdict = await assertWithinBudget({
      projectId: input.projectId,
      additionalUsd: input.estimatedCostUsd ?? 0,
      category: 'AI_API',
    })
    budgetWarning = verdict.warning
  }

  if (input.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(aiJobs)
      .where(eq(aiJobs.idempotencyKey, input.idempotencyKey))
      .limit(1)

    if (existing) return { job: existing, deduplicated: true }
  }

  const [job] = await db
    .insert(aiJobs)
    .values({
      projectId: input.projectId ?? null,
      episodeId: input.episodeId ?? null,
      kind: input.task,
      status: 'QUEUED',
      providerId: input.providerId ?? null,
      model: input.model ?? '',
      idempotencyKey: input.idempotencyKey ?? null,
      request: {
        task: input.task,
        context: input.context,
        candidates: input.candidates ?? 1,
        effort: input.effort ?? 'high',
        maxTokens: input.maxTokens ?? null,
      },
      targetType: input.targetType ?? '',
      targetId: input.targetId ?? null,
      priority: input.priority ?? 0,
      estimatedCost:
        input.estimatedCostUsd === null || input.estimatedCostUsd === undefined
          ? null
          : input.estimatedCostUsd.toFixed(6),
      requestedById: input.user.id,
    })
    .returning()

  if (!job) throw new Error('Failed to enqueue AI job')

  // Book the forecast so committed spend is visible before the job settles.
  if (input.projectId && (input.estimatedCostUsd ?? 0) > 0) {
    await recordEstimate({
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      source: 'AI_JOB',
      refId: job.id,
      description: `AI ${input.task} 預估`,
      unit: 'usd',
      amountUsd: input.estimatedCostUsd ?? 0,
    })
  }

  return { job, deduplicated: false, ...(budgetWarning ? { budgetWarning } : {}) }
}

async function assertTaskServiceable(
  task: AiTaskKind,
  providerId: string | null
): Promise<void> {
  const resolved = await resolveAdapter(task, providerId)
  if (!resolved) {
    throw ApiError.notConfigured(
      'AI 功能尚未啟用：還沒有可用的 AI 供應商金鑰。請在「AI 模型連線與金鑰設定」填入金鑰，' +
        '或設定 ANTHROPIC_API_KEY 環境變數。'
    )
  }
}

/** Picks the adapter: explicit provider, first enabled one, or the env fallback. */
async function resolveAdapter(
  task: AiTaskKind,
  providerId: string | null
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
    const status = await adapter.status()
    if (!status.available) throw ApiError.notConfigured(status.detail)

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
 * Atomically claims up to `limit` due jobs for this worker invocation.
 *
 * `SKIP LOCKED` is what makes concurrent workers safe: a row another
 * transaction already holds is skipped rather than waited on, so two
 * invocations never run the same job.
 */
async function claimJobs(workerId: string, limit: number): Promise<AiJobRow[]> {
  const now = new Date()

  return db.transaction(async (tx) => {
    /*
     * Due-time comparisons use the database clock (`now()`), not this process's
     * clock. `next_attempt_at` is written by the database, so comparing it
     * against a JS `Date` makes claiming sensitive to clock skew between the
     * app instance and Postgres — a job enqueued a millisecond ago would look
     * like it was scheduled for the future and be skipped.
     */
    const candidates = await tx
      .select({ id: aiJobs.id })
      .from(aiJobs)
      .where(
        and(
          or(
            // Fresh work.
            eq(aiJobs.status, 'QUEUED'),
            // Reclaim a lease whose worker died mid-run.
            and(
              eq(aiJobs.status, 'RUNNING'),
              sql`${aiJobs.lockedAt} <= now() - ${sql.raw(`interval '${LEASE_TIMEOUT_MS} milliseconds'`)}`
            )
          ),
          sql`${aiJobs.nextAttemptAt} <= now()`,
          isNull(aiJobs.cancelRequestedAt)
        )
      )
      .orderBy(sql`${aiJobs.priority} desc, ${aiJobs.nextAttemptAt} asc`)
      .limit(limit)
      .for('update', { skipLocked: true })

    if (candidates.length === 0) return []

    const ids = candidates.map((c) => c.id)

    return tx
      .update(aiJobs)
      .set({
        status: 'RUNNING',
        lockedAt: now,
        lockedBy: workerId,
        attemptCount: sql`${aiJobs.attemptCount} + 1`,
        startedAt: sql`coalesce(${aiJobs.startedAt}, ${now})`,
        progress: 5,
        progressNote: '已排入執行',
        updatedAt: now,
      })
      .where(inArray(aiJobs.id, ids))
      .returning()
  })
}

export type WorkerReport = {
  workerId: string
  claimed: number
  succeeded: number
  failed: number
  retrying: number
  cancelled: number
}

/**
 * Claims and runs due jobs. Intended to be called by the worker route on a
 * schedule; safe to run concurrently with itself.
 */
export async function runDueJobs(options: { limit?: number } = {}): Promise<WorkerReport> {
  const workerId = `w_${crypto.randomUUID().slice(0, 8)}`
  const jobs = await claimJobs(workerId, options.limit ?? 2)

  const report: WorkerReport = {
    workerId,
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    retrying: 0,
    cancelled: 0,
  }

  for (const job of jobs) {
    const outcome = await executeJob(job)
    report[outcome] += 1
  }

  return report
}

type Outcome = 'succeeded' | 'failed' | 'retrying' | 'cancelled'

async function executeJob(job: AiJobRow): Promise<Outcome> {
  const request = job.request as {
    task: AiTaskKind
    context: AiContext
    candidates?: number
    effort?: AiRunRequest['effort']
    maxTokens?: number | null
  }

  const startedAt = Date.now()

  const [attempt] = await db
    .insert(aiJobAttempts)
    .values({
      jobId: job.id,
      attempt: job.attemptCount,
      status: 'RUNNING',
      model: job.model,
    })
    .returning({ id: aiJobAttempts.id })

  try {
    const resolved = await resolveAdapter(request.task, job.providerId)
    if (!resolved) {
      return finishFailed(job, attempt?.id, {
        code: 'not_configured',
        message: 'AI 供應商不可用',
        retryable: false,
        durationMs: Date.now() - startedAt,
      })
    }

    await db
      .update(aiJobs)
      .set({ progress: 20, progressNote: '正在呼叫模型', updatedAt: new Date() })
      .where(eq(aiJobs.id, job.id))

    const result = await resolved.adapter.run({
      task: request.task,
      context: request.context,
      ...(job.model ? { model: job.model } : {}),
      ...(request.candidates ? { candidates: request.candidates } : {}),
      ...(request.effort ? { effort: request.effort } : {}),
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
    })

    // A cancel that arrived while the model was running: the provider has
    // already been charged, so the usage is recorded, but the output is not
    // offered for review.
    const [current] = await db
      .select({ cancelRequestedAt: aiJobs.cancelRequestedAt })
      .from(aiJobs)
      .where(eq(aiJobs.id, job.id))
      .limit(1)

    const costUsd = result.usage.costUsd

    await db
      .update(aiJobAttempts)
      .set({
        status: current?.cancelRequestedAt ? 'CANCELLED' : 'AWAITING_REVIEW',
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        costUsd: costUsd === null ? null : costUsd.toFixed(6),
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
      })
      .where(eq(aiJobAttempts.id, attempt?.id ?? ''))

    await recordActualCost(job, result.model, costUsd, result.usage)

    if (current?.cancelRequestedAt) {
      await db
        .update(aiJobs)
        .set({
          status: 'CANCELLED',
          lockedAt: null,
          lockedBy: '',
          progress: 100,
          progressNote: '已取消（供應商可能已計費）',
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiJobs.id, job.id))
      return 'cancelled'
    }

    const hasOutput = result.candidates.length > 0

    // Candidates as rows, so the comparison dialogs can query them and an
    // adopted one can be attributed precisely (spec v2 §5 `ai_outputs`).
    if (hasOutput) {
      await db
        .insert(aiOutputs)
        .values(
          result.candidates.map((candidate, index) => ({
            jobId: job.id,
            attemptId: attempt?.id ?? null,
            index,
            label: candidate.label,
            content: candidate.content,
            structured: candidate.structured === undefined ? null : candidate.structured,
            charCount: candidate.content.replace(/\s/g, '').length,
            model: result.model,
          }))
        )
        .onConflictDoNothing()
    }

    await db
      .update(aiJobs)
      .set({
        // AWAITING_REVIEW, never SUCCEEDED: a human still has to accept it.
        status: hasOutput ? 'AWAITING_REVIEW' : 'FAILED',
        result: {
          candidates: result.candidates,
          ...(result.refusal ? { refusal: result.refusal } : {}),
        },
        model: result.model,
        inputTokens: sql`${aiJobs.inputTokens} + ${result.usage.inputTokens}`,
        outputTokens: sql`${aiJobs.outputTokens} + ${result.usage.outputTokens}`,
        cacheReadTokens: sql`${aiJobs.cacheReadTokens} + ${result.usage.cacheReadTokens}`,
        actualCost: costUsd === null ? null : costUsd.toFixed(6),
        errorCode: result.refusal ? 'refusal' : '',
        errorMessage: result.refusal ? result.refusal.explanation : '',
        lockedAt: null,
        lockedBy: '',
        progress: 100,
        progressNote: hasOutput ? '待人工確認' : '模型沒有產出內容',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(aiJobs.id, job.id))

    return hasOutput ? 'succeeded' : 'failed'
  } catch (error) {
    const adapterError = error instanceof AiAdapterError ? error : null
    return finishFailed(job, attempt?.id, {
      code: adapterError?.code ?? 'unknown',
      message: error instanceof Error ? error.message : String(error),
      retryable: adapterError?.retryable ?? false,
      durationMs: Date.now() - startedAt,
    })
  }
}

/**
 * Records a failure, and either schedules a backoff retry or gives up.
 * Retrying reuses the same job row, so the idempotency key still holds and a
 * retry cannot double-charge for work that already succeeded.
 */
async function finishFailed(
  job: AiJobRow,
  attemptId: string | undefined,
  failure: { code: string; message: string; retryable: boolean; durationMs: number }
): Promise<Outcome> {
  const willRetry = failure.retryable && job.attemptCount < job.maxAttempts
  const backoffSec = BACKOFF_SECONDS[Math.min(job.attemptCount - 1, BACKOFF_SECONDS.length - 1)] ?? 30

  if (attemptId) {
    await db
      .update(aiJobAttempts)
      .set({
        status: 'FAILED',
        errorCode: failure.code,
        errorMessage: failure.message.slice(0, 1000),
        retryable: failure.retryable,
        durationMs: failure.durationMs,
        finishedAt: new Date(),
      })
      .where(eq(aiJobAttempts.id, attemptId))
  }

  await db
    .update(aiJobs)
    .set({
      status: willRetry ? 'QUEUED' : 'FAILED',
      errorCode: failure.code,
      errorMessage: failure.message.slice(0, 1000),
      lockedAt: null,
      lockedBy: '',
      nextAttemptAt: willRetry ? new Date(Date.now() + backoffSec * 1000) : new Date(),
      progress: willRetry ? 0 : 100,
      progressNote: willRetry ? `將於 ${backoffSec} 秒後重試` : '失敗',
      ...(willRetry ? {} : { finishedAt: new Date() }),
      updatedAt: new Date(),
    })
    .where(eq(aiJobs.id, job.id))

  return willRetry ? 'retrying' : 'failed'
}

/** Books the real spend against the project, separately from the estimate. */
async function recordActualCost(
  job: AiJobRow,
  model: string,
  costUsd: number | null,
  usage: { inputTokens: number; outputTokens: number }
): Promise<void> {
  if (costUsd === null || costUsd <= 0 || !job.projectId) return

  // Ledger line that settles the estimate recorded at enqueue time.
  await recordActual({
    projectId: job.projectId,
    episodeId: job.episodeId ?? null,
    source: 'AI_JOB',
    refId: job.id,
    description: `AI ${job.kind}（${model}）`,
    unit: 'tokens',
    quantity: usage.inputTokens + usage.outputTokens,
    amountUsd: costUsd,
  })

  await db.insert(expenses).values({
    projectId: job.projectId,
    episodeId: job.episodeId ?? null,
    category: 'AI_API',
    description: `AI ${job.kind}（${model}）`,
    amount: costUsd.toFixed(4),
    currency: 'USD',
    baseCurrency: 'USD',
    exchangeRate: '1',
    aiJobId: job.id,
    createdById: job.requestedById,
  })
}

/** Flags a job for cancellation. The worker honours it before and after the call. */
export async function requestCancel(jobId: string): Promise<AiJobRow> {
  const [updated] = await db
    .update(aiJobs)
    .set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(aiJobs.id, jobId),
        or(eq(aiJobs.status, 'QUEUED'), eq(aiJobs.status, 'RUNNING'))
      )
    )
    .returning()

  if (!updated) throw ApiError.badRequest('只有等待中或執行中的任務可以取消')

  // A job that has not started yet can be cancelled outright.
  if (updated.status === 'QUEUED') {
    const [cancelled] = await db
      .update(aiJobs)
      .set({
        status: 'CANCELLED',
        finishedAt: new Date(),
        progressNote: '已取消',
        updatedAt: new Date(),
      })
      .where(and(eq(aiJobs.id, jobId), eq(aiJobs.status, 'QUEUED')))
      .returning()

    if (cancelled) return cancelled
  }

  return updated
}

/** Re-queues a failed job. Clears the error but keeps the attempt history. */
export async function requeueJob(jobId: string): Promise<AiJobRow> {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, jobId)).limit(1)
  if (!job) throw ApiError.notFound('找不到該 AI 任務')

  if (job.status !== 'FAILED' && job.status !== 'CANCELLED') {
    throw ApiError.badRequest('只有失敗或已取消的任務可以重試')
  }

  const [updated] = await db
    .update(aiJobs)
    .set({
      status: 'QUEUED',
      // Give the retry a fresh allowance rather than resetting the counter,
      // so the attempt history stays truthful.
      maxAttempts: job.attemptCount + 3,
      nextAttemptAt: new Date(),
      cancelRequestedAt: null,
      errorCode: '',
      errorMessage: '',
      lockedAt: null,
      lockedBy: '',
      progress: 0,
      progressNote: '已重新排入佇列',
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(aiJobs.id, jobId))
    .returning()

  if (!updated) throw new Error('Failed to requeue job')
  return updated
}
