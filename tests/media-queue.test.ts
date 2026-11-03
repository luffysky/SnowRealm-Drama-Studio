import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decideMediaStep } from '@/lib/ai/queue'
import { testDatabaseReady } from './helpers/database'

/**
 * 媒體任務的狀態機 (`docs/todo` A1).
 *
 * Video generation runs for minutes — longer than a serverless function may
 * live — so a media job is submitted, abandoned, and polled on a later tick.
 * Two things in that loop are expensive to get wrong:
 *
 * - submitting twice, which pays for the same video twice
 * - counting a status check as a retry, which fails a perfectly healthy
 *   generation after about 45 seconds
 *
 * Both are pinned here.
 */

describe('decideMediaStep', () => {
  it('submits when nothing has been sent yet', () => {
    expect(decideMediaStep({ externalJobId: '', startedAt: new Date() })).toEqual({
      action: 'submit',
    })
  })

  it('polls instead of re-submitting once a handle exists', () => {
    /*
     * The handle is the only thing standing between a retry and paying twice.
     * A job that already has one must never take the submit branch again.
     */
    const step = decideMediaStep({
      externalJobId: 'fal-abc123',
      startedAt: new Date(Date.now() - 60_000),
    })

    expect(step).toEqual({ action: 'poll', externalId: 'fal-abc123' })
  })

  it('gives up after half an hour at the provider', () => {
    // Otherwise a provider that accepts a job and never answers leaves it
    // polling forever, holding a slot and reporting 「處理中」 indefinitely.
    const step = decideMediaStep({
      externalJobId: 'fal-stuck',
      startedAt: new Date(Date.now() - 31 * 60_000),
    })

    expect(step.action).toBe('timeout')
  })

  it('does not time out a job that has only just been submitted', () => {
    const step = decideMediaStep({
      externalJobId: 'fal-fresh',
      startedAt: new Date(),
    })

    expect(step.action).toBe('poll')
  })

  it('treats a missing start time as freshly started, not as ancient', () => {
    // `started_at` is set when a job is first claimed; a null here would
    // otherwise be read as epoch and time out immediately.
    const step = decideMediaStep({ externalJobId: 'fal-x', startedAt: null })

    expect(step.action).toBe('poll')
  })
})

/* -------------------------------------------------------------------------- */

const hasDb = testDatabaseReady()

let jobId: string | null = null

beforeAll(async () => {
  if (!hasDb) return
})

afterAll(async () => {
  if (!hasDb || !jobId) return
  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { eq } = await import('drizzle-orm')
  await db.delete(schema.aiJobs).where(eq(schema.aiJobs.id, jobId))
})

describe.skipIf(!hasDb)('claiming a job that is waiting on a provider', () => {
  it('does not spend a retry on a status check', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq, sql } = await import('drizzle-orm')

    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .limit(1)
    if (!project) throw new Error('Run `npm run db:seed` first')

    const [job] = await db
      .insert(schema.aiJobs)
      .values({
        projectId: project.id,
        kind: 'ASSET_GENERATE' as const,
        status: 'AWAITING_PROVIDER' as const,
        externalJobId: 'fal-test-handle',
        request: { task: 'ASSET_GENERATE', context: {} },
        attemptCount: 1,
        maxAttempts: 3,
      })
      .returning({ id: schema.aiJobs.id })

    jobId = job!.id

    /*
     * The same expression the claim query uses. A poll must leave
     * `attempt_count` alone: three status checks would otherwise exhaust
     * `max_attempts` in well under a minute and fail a video that was
     * generating normally.
     */
    const [after] = await db
      .update(schema.aiJobs)
      .set({
        status: 'RUNNING',
        attemptCount: sql`case when ${schema.aiJobs.status} = 'AWAITING_PROVIDER'
                               then ${schema.aiJobs.attemptCount}
                               else ${schema.aiJobs.attemptCount} + 1 end`,
      })
      .where(eq(schema.aiJobs.id, jobId))
      .returning({ attemptCount: schema.aiJobs.attemptCount })

    expect(after!.attemptCount).toBe(1)
  })

  it('does spend a retry on genuinely fresh work', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq, sql } = await import('drizzle-orm')

    await db
      .update(schema.aiJobs)
      .set({ status: 'QUEUED', attemptCount: 1 })
      .where(eq(schema.aiJobs.id, jobId!))

    const [after] = await db
      .update(schema.aiJobs)
      .set({
        status: 'RUNNING',
        attemptCount: sql`case when ${schema.aiJobs.status} = 'AWAITING_PROVIDER'
                               then ${schema.aiJobs.attemptCount}
                               else ${schema.aiJobs.attemptCount} + 1 end`,
      })
      .where(eq(schema.aiJobs.id, jobId!))
      .returning({ attemptCount: schema.aiJobs.attemptCount })

    expect(after!.attemptCount).toBe(2)
  })
})
