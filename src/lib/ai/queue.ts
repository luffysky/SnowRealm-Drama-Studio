import crypto from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { aiJobAttempts, aiJobs, aiOutputs, expenses } from '@/db/schema'
import { ApiError } from '@/lib/api'
import { assertWithinBudget, recordActual, recordEstimate } from '@/lib/usage'
import type { SessionUser } from '@/lib/auth/session'
import { adapterFor, envOnlyAnthropicAdapter, loadMediaAdapter } from './registry'
import { aiProviders } from '@/db/schema'
import {
  AiAdapterError,
  type AiAdapter,
  type AiContext,
  type AiRunRequest,
  type AiTaskKind,
  type MediaAdapter,
  type MediaResult,
} from './types'

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

/**
 * A claimed job whose lease has not been renewed for this long is assumed
 * abandoned (Z126).
 *
 * Ninety seconds, not ten minutes, because a living job now renews its own
 * lease while it works (`heartbeat` below). Ten minutes was sized for a
 * worker that could not say it was still there, and it meant a job killed
 * mid-flight — which is what happens when the browser that nudged the worker
 * navigates away — blocked its own retry for ten minutes. For somebody
 * sitting in front of the screen waiting, that is forever.
 */
const LEASE_TIMEOUT_MS = 90 * 1000

/** How often a running job renews its lease. Comfortably inside the timeout. */
const HEARTBEAT_MS = 20 * 1000

/**
 * How long to wait between asking a media provider whether it has finished.
 *
 * Polling is cheap but not free — most providers rate-limit status calls — and
 * a video takes minutes, so asking every second buys nothing.
 */
const POLL_INTERVAL_SECONDS = 15

/**
 * How long a job may sit at the provider before we give up on it.
 *
 * Without this a provider that accepts a submission and never answers leaves
 * the job polling forever, holding a slot and reporting 「處理中」 to someone
 * who will eventually conclude the whole feature is broken.
 */
const MAX_PROVIDER_WAIT_MS = 30 * 60 * 1000

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
            /*
             * A media job already submitted to the provider, due for its next
             * status check. `next_attempt_at` spaces these out.
             */
            eq(aiJobs.status, 'AWAITING_PROVIDER'),
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
        /*
         * A poll is not an attempt.
         *
         * Counting it as one would exhaust `max_attempts` in three status
         * checks — about 45 seconds — and fail a video that was generating
         * perfectly well. The right-hand side sees the pre-update status, so
         * this tests what the row was before being set to RUNNING.
         */
        attemptCount: sql`case when ${aiJobs.status} = 'AWAITING_PROVIDER'
                               then ${aiJobs.attemptCount}
                               else ${aiJobs.attemptCount} + 1 end`,
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

  const swept = await sweepAbandoned()
  const jobs = await claimJobs(workerId, options.limit ?? 2)

  const report: WorkerReport = {
    workerId,
    claimed: jobs.length,
    succeeded: 0,
    failed: 0,
    retrying: 0,
    cancelled: swept,
  }

  for (const job of jobs) {
    /*
     * Renew the lease while the model works (Z126).
     *
     * Without this the lease is a guess about how long a job *might* take,
     * and it has to be generous enough for the slowest one — which is what
     * made a dead job block its own retry for ten minutes. A job that is
     * still alive says so; one that stopped saying so is gone.
     */
    const beat = setInterval(() => {
      void db
        .update(aiJobs)
        .set({ lockedAt: new Date() })
        .where(and(eq(aiJobs.id, job.id), eq(aiJobs.lockedBy, workerId)))
        .catch(() => {})
    }, HEARTBEAT_MS)

    try {
      const outcome = await executeJob(job)
      report[outcome] += 1
    } finally {
      clearInterval(beat)
    }
  }

  return report
}

/**
 * Finishes off jobs that were cancelled while running and then abandoned.
 *
 * `requestCancel` only flags a RUNNING job and leaves the worker to honour
 * it — which never happens if that worker died. And the claim query skips
 * anything carrying a cancel flag, so such a row sat at 執行中 **forever**,
 * holding a slot and telling everyone a model was working on it. One of
 * these had been running since the previous day.
 */
async function sweepAbandoned(): Promise<number> {
  const stale = sql`${aiJobs.lockedAt} <= now() - ${sql.raw(
    `interval '${LEASE_TIMEOUT_MS} milliseconds'`
  )}`

  const finished = await db
    .update(aiJobs)
    .set({
      status: 'CANCELLED',
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: '',
      progressNote: '已取消（執行中斷）',
      updatedAt: new Date(),
    })
    .where(
      and(eq(aiJobs.status, 'RUNNING'), isNotNull(aiJobs.cancelRequestedAt), stale)
    )
    .returning({ id: aiJobs.id })

  return finished.length
}

type Outcome = 'succeeded' | 'failed' | 'retrying' | 'cancelled'

/* -------------------------------------------------------------------------- */
/* 媒體任務的狀態機                                                              */
/* -------------------------------------------------------------------------- */

/**
 * What to do next with a media job.
 *
 * Pulled out as a pure function so the decision can be tested without a
 * provider, a network or a clock: the interesting cases are "already submitted"
 * and "waited too long", and both are awkward to reach through the real path.
 */
export type MediaStep =
  | { action: 'submit' }
  | { action: 'poll'; externalId: string }
  | { action: 'timeout'; waitedMs: number }

export function decideMediaStep(
  job: { externalJobId: string; startedAt: Date | null },
  now: Date = new Date()
): MediaStep {
  /*
   * An empty handle means nothing has been sent yet. Its presence is the only
   * thing standing between a retry and paying twice for the same video, so it
   * is written before anything else can interrupt.
   */
  if (!job.externalJobId) return { action: 'submit' }

  const waitedMs = job.startedAt ? now.getTime() - job.startedAt.getTime() : 0
  if (waitedMs > MAX_PROVIDER_WAIT_MS) return { action: 'timeout', waitedMs }

  return { action: 'poll', externalId: job.externalJobId }
}

/**
 * Parks a job until its next status check.
 *
 * Deliberately not a failure and not a retry: the work is proceeding at the
 * provider, so `attempt_count` is untouched and the lease is released for the
 * next worker tick.
 */
async function parkUntilNextPoll(
  jobId: string,
  externalId: string,
  update: { progress?: number; note?: string }
): Promise<void> {
  await db
    .update(aiJobs)
    .set({
      status: 'AWAITING_PROVIDER',
      externalJobId: externalId,
      lockedAt: null,
      lockedBy: '',
      nextAttemptAt: new Date(Date.now() + POLL_INTERVAL_SECONDS * 1000),
      ...(update.progress !== undefined ? { progress: update.progress } : {}),
      progressNote: update.note ?? '供應商處理中',
      updatedAt: new Date(),
    })
    .where(eq(aiJobs.id, jobId))
}


async function executeJob(job: AiJobRow): Promise<Outcome> {
  /*
   * A media job is driven by submit/poll rather than a single call. The text
   * path never sets an external handle, so this branch only catches media —
   * and catching it *first* is what stops a retry from submitting the same
   * video twice.
   */
  if (job.externalJobId) return advanceMediaJob(job)

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
 * Moves a media job one step: submit, poll, or give up waiting.
 *
 * Called for a fresh media job and again on every status check. The provider
 * holds the work; this only moves the row between states.
 */
async function advanceMediaJob(job: AiJobRow): Promise<Outcome> {
  const startedAt = Date.now()
  const step = decideMediaStep(job)

  if (step.action === 'timeout') {
    return finishFailed(job, undefined, {
      code: 'provider_timeout',
      message:
        `供應商超過 ${Math.round(MAX_PROVIDER_WAIT_MS / 60000)} 分鐘沒有回應` +
        `（已等 ${Math.round(step.waitedMs / 60000)} 分鐘）。` +
        '該次生成可能仍在供應商端執行並計費，請到供應商後台確認。',
      // Not retryable: re-submitting would pay for the work a second time.
      retryable: false,
      durationMs: Date.now() - startedAt,
    })
  }

  const adapter = await loadMediaAdapter(job.providerId)
  if (!adapter) {
    return finishFailed(job, undefined, {
      code: 'not_configured',
      message: '這類供應商尚未實作適配器。',
      retryable: false,
      durationMs: Date.now() - startedAt,
    })
  }

  try {
    if (step.action === 'poll') {
      const result = await adapter.poll(step.externalId)

      if (result.state === 'pending') {
        await parkUntilNextPoll(job.id, step.externalId, {
          ...(result.progress !== undefined ? { progress: result.progress } : {}),
          ...(result.note ? { note: result.note } : {}),
        })
        return 'retrying'
      }

      if (result.state === 'failed') {
        return finishFailed(job, undefined, {
          code: 'provider_failed',
          message: result.message,
          retryable: result.retryable,
          durationMs: Date.now() - startedAt,
        })
      }

      return finishMedia(job, result.result)
    }

    const media = (job.request as { media?: unknown }).media
    if (!media) {
      return finishFailed(job, undefined, {
        code: 'invalid_request',
        message: '這個任務沒有帶媒體生成參數。',
        retryable: false,
        durationMs: Date.now() - startedAt,
      })
    }

    const submission = await adapter.submit(media as Parameters<MediaAdapter['submit']>[0])

    if (submission.state === 'pending') {
      await parkUntilNextPoll(job.id, submission.externalId, {
        progress: 20,
        ...(submission.note ? { note: submission.note } : {}),
      })
      return 'retrying'
    }

    return finishMedia(job, submission.result)
  } catch (error) {
    const adapterError = error instanceof AiAdapterError ? error : null
    return finishFailed(job, undefined, {
      code: adapterError?.code ?? 'provider_error',
      message: error instanceof Error ? error.message : String(error),
      retryable: adapterError?.retryable ?? false,
      durationMs: Date.now() - startedAt,
    })
  }
}

/**
 * Stores a finished media result.
 *
 * `AWAITING_REVIEW`, never `SUCCEEDED` — same rule as the text path. The
 * artifacts are candidates until a human accepts them.
 */
async function finishMedia(job: AiJobRow, result: MediaResult): Promise<Outcome> {
  await db
    .update(aiJobs)
    .set({
      status: 'AWAITING_REVIEW',
      result: { artifacts: result.artifacts, model: result.model },
      model: result.model || job.model,
      ...(result.costUsd !== null ? { actualCostUsd: String(result.costUsd) } : {}),
      lockedAt: null,
      lockedBy: '',
      progress: 100,
      progressNote: '已完成，待人工確認',
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(aiJobs.id, job.id))

  return 'succeeded'
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
