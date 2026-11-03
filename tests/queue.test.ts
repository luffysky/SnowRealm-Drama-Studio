import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * Integration tests for the AI job queue against a real database.
 *
 * These cover the parts the HTTP smoke test cannot reach without a provider
 * key: claiming, the lease, attempt logging, backoff, and — most importantly —
 * that two concurrent workers never take the same job.
 *
 * Jobs are inserted directly rather than through `enqueueJob`, which refuses
 * when no provider is configured. Each job therefore fails at adapter
 * resolution, which is exactly the path being asserted.
 */


/**
 * Destructive: truncates tables between tests. Runs only against a local
 * database — set TEST_DATABASE_URL when DATABASE_URL points at Neon.
 */
const hasDb = testDatabaseReady()

// Imported lazily so the file can be collected even without a database.
let db: typeof import('@/db').db
let schema: typeof import('@/db/schema')
let queue: typeof import('@/lib/ai/queue')

beforeAll(async () => {
  if (!hasDb) return
  ;({ db } = await import('@/db'))
  schema = await import('@/db/schema')
  queue = await import('@/lib/ai/queue')
})

beforeEach(async () => {
  if (!hasDb) return
  // Isolation: a leftover due job would be claimed instead of the one under
  // test, because the worker claims by priority and due time, not by id.
  await db.delete(schema.aiJobs)
})

afterAll(async () => {
  if (!hasDb) return
  await db.delete(schema.aiJobs)
  const { closeDb } = await import('@/db')
  await closeDb()
})

async function insertJob(
  overrides: Partial<typeof schema.aiJobs.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(schema.aiJobs)
    .values({
      kind: 'NOVEL_CONTINUE',
      status: 'QUEUED',
      request: { task: 'NOVEL_CONTINUE', context: {}, candidates: 1 },
      ...overrides,
    })
    .returning({ id: schema.aiJobs.id })

  if (!row) throw new Error('insert failed')
  return row.id
}

describe.skipIf(!hasDb)('AI queue', () => {
  it('claims a due job, logs an attempt, and releases the lease', async () => {
    const jobId = await insertJob()

    const report = await queue.runDueJobs({ limit: 5 })
    expect(report.claimed).toBeGreaterThanOrEqual(1)

    const [job] = await db
      .select()
      .from(schema.aiJobs)
      .where(eq(schema.aiJobs.id, jobId))
      .limit(1)

    expect(job).toBeDefined()
    // No provider is configured, so the job fails — but it must fail cleanly.
    expect(job!.status).toBe('FAILED')
    expect(job!.attemptCount).toBe(1)
    expect(job!.errorCode).toBe('not_configured')
    // The lease must be released whatever the outcome, or the row is stuck.
    expect(job!.lockedAt).toBeNull()
    expect(job!.lockedBy).toBe('')
    expect(job!.finishedAt).not.toBeNull()

    const attempts = await db
      .select()
      .from(schema.aiJobAttempts)
      .where(eq(schema.aiJobAttempts.jobId, jobId))

    expect(attempts).toHaveLength(1)
    expect(attempts[0]!.attempt).toBe(1)
    expect(attempts[0]!.status).toBe('FAILED')
  })

  it('does not claim a job scheduled for the future', async () => {
    const jobId = await insertJob({
      nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
    })

    await queue.runDueJobs({ limit: 5 })

    const [job] = await db
      .select({ status: schema.aiJobs.status, attemptCount: schema.aiJobs.attemptCount })
      .from(schema.aiJobs)
      .where(eq(schema.aiJobs.id, jobId))
      .limit(1)

    expect(job!.status).toBe('QUEUED')
    expect(job!.attemptCount).toBe(0)
  })

  it('does not claim a job whose cancellation was requested', async () => {
    const jobId = await insertJob({ cancelRequestedAt: new Date() })

    await queue.runDueJobs({ limit: 5 })

    const [job] = await db
      .select({ attemptCount: schema.aiJobs.attemptCount })
      .from(schema.aiJobs)
      .where(eq(schema.aiJobs.id, jobId))
      .limit(1)

    expect(job!.attemptCount).toBe(0)
  })

  it('never lets two concurrent workers claim the same job', async () => {
    const jobId = await insertJob()

    // Both run against the same single due job. SKIP LOCKED must give it to
    // exactly one of them; a double-claim would mean paying a provider twice.
    const [a, b] = await Promise.all([
      queue.runDueJobs({ limit: 5 }),
      queue.runDueJobs({ limit: 5 }),
    ])

    const attempts = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.aiJobAttempts)
      .where(eq(schema.aiJobAttempts.jobId, jobId))

    expect(Number(attempts[0]!.n)).toBe(1)
    expect(a.claimed + b.claimed).toBeGreaterThanOrEqual(1)

    const [job] = await db
      .select({ attemptCount: schema.aiJobs.attemptCount })
      .from(schema.aiJobs)
      .where(eq(schema.aiJobs.id, jobId))
      .limit(1)

    expect(job!.attemptCount).toBe(1)
  })

  it('enforces idempotency with a unique key', async () => {
    const key = `test-key-${Date.now()}`
    await insertJob({ idempotencyKey: key })

    // A second row with the same key must be rejected by the partial index.
    await expect(insertJob({ idempotencyKey: key })).rejects.toThrow()
  })

  it('allows many jobs without an idempotency key', async () => {
    // The index is partial, so nulls must not collide with each other.
    await insertJob({ idempotencyKey: null })
    await insertJob({ idempotencyKey: null })

    const [row] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.aiJobs)
      .where(sql`${schema.aiJobs.idempotencyKey} is null`)

    expect(Number(row!.n)).toBeGreaterThanOrEqual(2)
  })

  it('reclaims a lease abandoned by a dead worker', async () => {
    // A RUNNING job whose lock is older than the lease timeout.
    const jobId = await insertJob({
      status: 'RUNNING',
      lockedAt: new Date(Date.now() - 30 * 60 * 1000),
      lockedBy: 'w_dead',
      attemptCount: 1,
    })

    await queue.runDueJobs({ limit: 5 })

    const [job] = await db
      .select({ attemptCount: schema.aiJobs.attemptCount, lockedBy: schema.aiJobs.lockedBy })
      .from(schema.aiJobs)
      .where(eq(schema.aiJobs.id, jobId))
      .limit(1)

    expect(job!.attemptCount).toBe(2)
    expect(job!.lockedBy).toBe('')
  })

  it('cancels a queued job outright', async () => {
    const jobId = await insertJob()

    const job = await queue.requestCancel(jobId)
    expect(job.status).toBe('CANCELLED')
  })

  it('requeues a failed job and extends its attempt allowance', async () => {
    const jobId = await insertJob({
      status: 'FAILED',
      attemptCount: 3,
      maxAttempts: 3,
      errorCode: 'rate_limit',
      errorMessage: 'too many requests',
    })

    const job = await queue.requeueJob(jobId)

    expect(job.status).toBe('QUEUED')
    expect(job.errorCode).toBe('')
    // The counter is not reset — history stays truthful; the budget grows.
    expect(job.attemptCount).toBe(3)
    expect(job.maxAttempts).toBe(6)
  })

  it('refuses to requeue a job that is still queued', async () => {
    const jobId = await insertJob()
    await expect(queue.requeueJob(jobId)).rejects.toThrow()
  })
})
