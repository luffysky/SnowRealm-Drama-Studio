import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * Integration tests for the governance layer added in slice B: approval locks,
 * the usage ledger, and server-side budget enforcement.
 *
 * These need a real database — the behaviour being asserted lives in SQL
 * (the "estimate not yet settled" subquery, the unique indexes, the cascade).
 */

/**
 * Destructive: truncates tables between tests. Runs only against a local
 * database — set TEST_DATABASE_URL when DATABASE_URL points at Neon.
 */
const hasDb = testDatabaseReady()

let db: typeof import('@/db').db
let schema: typeof import('@/db/schema')
let approvals: typeof import('@/lib/approvals')
let usage: typeof import('@/lib/usage')

let projectId: string
let userId: string

const user = {
  id: '',
  email: '',
  name: '測試',
  title: '',
  role: 'OWNER' as const,
  color: '#fff',
  displayCurrency: 'TWD' as const,
}

beforeAll(async () => {
  if (!hasDb) return
  ;({ db } = await import('@/db'))
  schema = await import('@/db/schema')
  approvals = await import('@/lib/approvals')
  usage = await import('@/lib/usage')

  const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1)
  if (!project) throw new Error('Run `npm run db:seed` first')
  projectId = project.id

  const [u] = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
  if (!u) throw new Error('Run `npm run db:seed` first')
  userId = u.id
  user.id = userId
})

beforeEach(async () => {
  if (!hasDb) return
  await db.delete(schema.approvalRecords)
  await db.delete(schema.usageLedger)
  await db.delete(schema.budgets)
})

afterAll(async () => {
  if (!hasDb) return
  await db.delete(schema.approvalRecords)
  await db.delete(schema.usageLedger)
  await db.delete(schema.budgets)
  const { closeDb } = await import('@/db')
  await closeDb()
})

/** Creates a document plus one version, returning both ids. */
async function makeDocument(): Promise<{ documentId: string; versionId: string }> {
  const [episode] = await db.select({ id: schema.episodes.id }).from(schema.episodes).limit(1)
  if (!episode) throw new Error('no episode')

  await db.delete(schema.documents).where(eq(schema.documents.episodeId, episode.id))

  const [doc] = await db
    .insert(schema.documents)
    .values({ episodeId: episode.id, kind: 'NOVEL', content: 'draft', charCount: 5 })
    .returning({ id: schema.documents.id })

  const [version] = await db
    .insert(schema.versions)
    .values({
      targetType: 'DOCUMENT',
      targetId: doc!.id,
      version: 1,
      snapshot: { content: 'draft' },
      charCount: 5,
    })
    .returning({ id: schema.versions.id })

  return { documentId: doc!.id, versionId: version!.id }
}

describe.skipIf(!hasDb)('approval locking (spec v2 §6.5)', () => {
  it('starts unlocked', async () => {
    const { documentId } = await makeDocument()
    expect(await approvals.isLocked('DOCUMENT', documentId)).toBe(false)
    await expect(approvals.assertNotLocked('DOCUMENT', documentId)).resolves.toBeUndefined()
  })

  it('locks the target once a version is approved', async () => {
    const { documentId, versionId } = await makeDocument()

    await approvals.approve({ user, projectId, targetType: 'DOCUMENT', targetId: documentId, versionId })

    expect(await approvals.isLocked('DOCUMENT', documentId)).toBe(true)
    await expect(approvals.assertNotLocked('DOCUMENT', documentId)).rejects.toThrow(/定稿/)
  })

  it('pins the exact version and marks it approved', async () => {
    const { documentId, versionId } = await makeDocument()

    await approvals.approve({ user, projectId, targetType: 'DOCUMENT', targetId: documentId, versionId })

    const [version] = await db
      .select({ isApproved: schema.versions.isApproved })
      .from(schema.versions)
      .where(eq(schema.versions.id, versionId))
      .limit(1)
    expect(version!.isApproved).toBe(true)

    const [doc] = await db
      .select({ approvedVersionId: schema.documents.approvedVersionId })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .limit(1)
    expect(doc!.approvedVersionId).toBe(versionId)
  })

  it('refuses to approve a version belonging to another document', async () => {
    const a = await makeDocument()
    const [stray] = await db
      .insert(schema.versions)
      .values({
        targetType: 'DOCUMENT',
        targetId: a.documentId,
        version: 99,
        snapshot: {},
      })
      .returning({ id: schema.versions.id })

    // Same document, so this one is fine; now try a genuinely foreign target.
    await expect(
      approvals.approve({
        user,
        projectId,
        targetType: 'DOCUMENT',
        targetId: '11111111-1111-4111-8111-111111111111',
        versionId: stray!.id,
      })
    ).rejects.toThrow(/不屬於/)
  })

  it('refuses a second approval while still locked', async () => {
    const { documentId, versionId } = await makeDocument()
    await approvals.approve({ user, projectId, targetType: 'DOCUMENT', targetId: documentId, versionId })

    await expect(
      approvals.approve({ user, projectId, targetType: 'DOCUMENT', targetId: documentId, versionId })
    ).rejects.toThrow(/已經定稿/)
  })

  it('unlocks only with a stated reason, and keeps the history', async () => {
    const { documentId, versionId } = await makeDocument()
    await approvals.approve({ user, projectId, targetType: 'DOCUMENT', targetId: documentId, versionId })

    await expect(
      approvals.unlock({ user, projectId, targetType: 'DOCUMENT', targetId: documentId, reason: '   ' })
    ).rejects.toThrow(/原因/)

    await approvals.unlock({
      user,
      projectId,
      targetType: 'DOCUMENT',
      targetId: documentId,
      reason: '導演要求改結尾',
    })

    expect(await approvals.isLocked('DOCUMENT', documentId)).toBe(false)

    // Nothing was deleted: approval and unlock both remain.
    const history = await approvals.approvalHistory('DOCUMENT', documentId)
    expect(history).toHaveLength(2)
    expect(history[0]!.state).toBe('UNLOCKED')
    expect(history[0]!.unlockReason).toBe('導演要求改結尾')
    expect(history[1]!.state).toBe('APPROVED')
    // The unlock points back at what it superseded.
    expect(history[0]!.supersedesId).toBe(history[1]!.id)
  })

  it('refuses to unlock something that is not locked', async () => {
    const { documentId } = await makeDocument()
    await expect(
      approvals.unlock({ user, projectId, targetType: 'DOCUMENT', targetId: documentId, reason: 'x' })
    ).rejects.toThrow(/沒有被鎖定/)
  })
})

describe.skipIf(!hasDb)('usage ledger (spec v2 §6.7)', () => {
  it('keeps an estimate and its actual as separate rows', async () => {
    const refId = crypto.randomUUID()

    await usage.recordEstimate({
      projectId,
      source: 'AI_JOB',
      refId,
      description: 'estimate',
      amountUsd: 1.5,
    })
    await usage.recordActual({
      projectId,
      source: 'AI_JOB',
      refId,
      description: 'actual',
      amountUsd: 1.2,
    })

    const rows = await db
      .select({ kind: schema.usageLedger.kind, amount: schema.usageLedger.amount })
      .from(schema.usageLedger)
      .where(eq(schema.usageLedger.refId, refId))

    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.kind).sort()).toEqual(['ACTUAL', 'ESTIMATE'])
  })

  it('does not double-count an estimate once its actual settles it', async () => {
    const refId = crypto.randomUUID()

    await usage.recordEstimate({ projectId, source: 'AI_JOB', refId, description: 'e', amountUsd: 10 })

    let summary = await usage.spendForPeriod(projectId)
    expect(summary.committedUsd).toBeCloseTo(10, 4)
    expect(summary.actualUsd).toBeCloseTo(0, 4)
    expect(summary.totalUsd).toBeCloseTo(10, 4)

    await usage.recordActual({ projectId, source: 'AI_JOB', refId, description: 'a', amountUsd: 7 })

    summary = await usage.spendForPeriod(projectId)
    // The estimate is now settled, so it stops counting as committed.
    expect(summary.committedUsd).toBeCloseTo(0, 4)
    expect(summary.actualUsd).toBeCloseTo(7, 4)
    expect(summary.totalUsd).toBeCloseTo(7, 4)
  })

  it('counts an unsettled estimate from a different job as still committed', async () => {
    const settled = crypto.randomUUID()
    const pending = crypto.randomUUID()

    await usage.recordEstimate({ projectId, source: 'AI_JOB', refId: settled, description: 'e1', amountUsd: 4 })
    await usage.recordEstimate({ projectId, source: 'AI_JOB', refId: pending, description: 'e2', amountUsd: 6 })
    await usage.recordActual({ projectId, source: 'AI_JOB', refId: settled, description: 'a1', amountUsd: 3 })

    const summary = await usage.spendForPeriod(projectId)
    expect(summary.actualUsd).toBeCloseTo(3, 4)
    expect(summary.committedUsd).toBeCloseTo(6, 4)
    expect(summary.totalUsd).toBeCloseTo(9, 4)
  })

  it('stores money without float drift', async () => {
    const refId = crypto.randomUUID()
    await usage.recordEstimate({
      projectId,
      source: 'AI_JOB',
      refId,
      description: 'precision',
      amountUsd: 0.000123,
    })

    const [row] = await db
      .select({ amount: schema.usageLedger.amount })
      .from(schema.usageLedger)
      .where(eq(schema.usageLedger.refId, refId))
      .limit(1)

    expect(row!.amount).toBe('0.000123')
  })
})

describe.skipIf(!hasDb)('budget enforcement (spec v2 §6.7)', () => {
  it('allows spending when no budget is set', async () => {
    const verdict = await usage.checkBudget({ projectId, additionalUsd: 1000 })
    expect(verdict.allowed).toBe(true)
  })

  it('refuses a task that would exceed the cap', async () => {
    await db.insert(schema.budgets).values({
      projectId,
      category: 'AI_API',
      period: usage.periodOf(),
      amount: '10.0000',
      currency: 'USD',
    })

    await usage.recordActual({
      projectId,
      source: 'AI_JOB',
      refId: crypto.randomUUID(),
      description: 'spent',
      amountUsd: 9,
    })

    const verdict = await usage.checkBudget({ projectId, additionalUsd: 5 })
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toMatch(/超出上限/)

    await expect(
      usage.assertWithinBudget({ projectId, additionalUsd: 5 })
    ).rejects.toThrow(/超出上限/)
  })

  it('treats a NT$ cap as NT$, not as the same number of dollars', async () => {
    /*
     * The regression this exists for: `budgets.currency` defaults to TWD while
     * the usage ledger is written in USD, and the gate used to compare the two
     * raw numbers. A NT$3,000 cap (~US$93) was therefore enforced as US$3,000 —
     * about 32x too permissive. Every other test here sets currency:'USD'
     * explicitly, which is why none of them caught it.
     */
    await db.insert(schema.budgets).values({
      projectId,
      category: 'AI_API',
      period: usage.periodOf(),
      amount: '3000.0000',
      currency: 'TWD',
    })

    const underCap = await usage.checkBudget({ projectId, additionalUsd: 50 })
    expect(underCap.allowed).toBe(true)

    const overCap = await usage.checkBudget({ projectId, additionalUsd: 200 })
    expect(overCap.allowed).toBe(false)
    if (!overCap.allowed) {
      // ~93, not 3000.
      expect(overCap.capUsd).toBeLessThan(200)
      // The refusal must name the cap as it was entered.
      expect(overCap.reason).toContain('NT$3,000')
    }
  })

  it('counts committed-but-unsettled work against the cap', async () => {
    await db.insert(schema.budgets).values({
      projectId,
      category: 'AI_API',
      period: usage.periodOf(),
      amount: '10.0000',
      currency: 'USD',
    })

    // Nothing has settled, but 9 USD of work is already queued.
    await usage.recordEstimate({
      projectId,
      source: 'AI_JOB',
      refId: crypto.randomUUID(),
      description: 'queued',
      amountUsd: 9,
    })

    const verdict = await usage.checkBudget({ projectId, additionalUsd: 5 })
    expect(verdict.allowed).toBe(false)
  })

  it('warns before refusing, once past the alert threshold', async () => {
    await db.insert(schema.budgets).values({
      projectId,
      category: 'AI_API',
      period: usage.periodOf(),
      amount: '100.0000',
      currency: 'USD',
      alertThresholdPct: 80,
    })

    await usage.recordActual({
      projectId,
      source: 'AI_JOB',
      refId: crypto.randomUUID(),
      description: 'spent',
      amountUsd: 75,
    })

    const verdict = await usage.checkBudget({ projectId, additionalUsd: 10 })
    expect(verdict.allowed).toBe(true)
    if (verdict.allowed) expect(verdict.warning).toMatch(/85%/)
  })

  it('prefers the most specific cap', async () => {
    // A generous project-wide cap and a tight one for this month.
    await db.insert(schema.budgets).values([
      { projectId, category: null, period: null, amount: '1000.0000', currency: 'USD' },
      {
        projectId,
        category: 'AI_API',
        period: usage.periodOf(),
        amount: '5.0000',
        currency: 'USD',
      },
    ])

    const verdict = await usage.checkBudget({ projectId, additionalUsd: 20 })
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.capUsd).toBeCloseTo(5, 4)
  })
})

describe.skipIf(!hasDb)('asset variants (spec v2 §6.2)', () => {
  it('keeps a derivative in its own row with its own object key', async () => {
    const [asset] = await db
      .insert(schema.assets)
      .values({
        projectId,
        kind: 'IMAGE',
        name: 'master.png',
        objectKey: `projects/${projectId}/image/${crypto.randomUUID()}.png`,
        uploadStatus: 'COMPLETED',
      })
      .returning({ id: schema.assets.id, objectKey: schema.assets.objectKey })

    const [variant] = await db
      .insert(schema.assetVariants)
      .values({
        assetId: asset!.id,
        kind: 'THUMBNAIL',
        objectKey: `projects/${projectId}/image/${crypto.randomUUID()}_thumb.webp`,
        mimeType: 'image/webp',
        width: 320,
        height: 180,
      })
      .returning({ objectKey: schema.assetVariants.objectKey })

    // The derivative must never share storage with the master.
    expect(variant!.objectKey).not.toBe(asset!.objectKey)

    // One variant per kind: regenerating replaces rather than accumulating.
    await expect(
      db.insert(schema.assetVariants).values({
        assetId: asset!.id,
        kind: 'THUMBNAIL',
        objectKey: `projects/${projectId}/image/${crypto.randomUUID()}_thumb2.webp`,
      })
    ).rejects.toThrow()

    // Deleting the master takes its derivatives with it, not the other way round.
    await db.delete(schema.assets).where(eq(schema.assets.id, asset!.id))
    const [remaining] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.assetVariants)
      .where(eq(schema.assetVariants.assetId, asset!.id))
    expect(Number(remaining!.n)).toBe(0)
  })
})
