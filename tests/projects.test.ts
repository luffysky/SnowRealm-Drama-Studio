import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * Integration tests for the 作品列表 query layer (design 03).
 *
 * The interesting behaviour is all in SQL — per-status counts that ignore the
 * active filter, progress derived from stage rows, and a favourite scoped to
 * one member — so these run against a real database rather than mocks.
 */

/**
 * Destructive: truncates tables between tests. Runs only against a local
 * database — set TEST_DATABASE_URL when DATABASE_URL points at Neon.
 */
const hasDb = testDatabaseReady()

let db: typeof import('@/db').db
let schema: typeof import('@/db/schema')
let projectsLib: typeof import('@/lib/projects')

let projectId: string
let ownerId: string
let otherId: string

beforeAll(async () => {
  if (!hasDb) return
  ;({ db } = await import('@/db'))
  schema = await import('@/db/schema')
  projectsLib = await import('@/lib/projects')

  const [p] = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1)
  if (!p) throw new Error('Run `npm run db:seed` first')
  projectId = p.id

  const members = await db.select({ id: schema.users.id }).from(schema.users).limit(2)
  if (members.length < 2) throw new Error('Run `npm run db:seed` first')
  ownerId = members[0]!.id
  otherId = members[1]!.id
})

beforeEach(async () => {
  if (!hasDb) return
  await db.delete(schema.projectFavourites)
})

afterAll(async () => {
  if (!hasDb) return
  await db.delete(schema.projectFavourites)
  const { closeDb } = await import('@/db')
  await closeDb()
})

describe.skipIf(!hasDb)('listProjects', () => {
  /*
   * Put the stage board back to 未開始 before each case.
   *
   * These tests used to rely on the seed still being pristine, which held
   * only because **nothing in the app ever wrote to that table** — the bug
   * Z117 fixed. The moment saving a chapter started marking 小說 as
   * in_progress, a chapter created by another suite made 「zero progress」
   * fail here for a reason that had nothing to do with this code.
   *
   * A test that needs a precondition should establish it rather than hope.
   */
  beforeEach(async () => {
    if (!hasDb) return
    await db
      .update(schema.episodeProductionStages)
      .set({ status: 'not_started', progressPercent: 0, startedAt: null, completedAt: null })
      .where(eq(schema.episodeProductionStages.projectId, projectId))
  })

  it('returns the seeded project with its real episode count', async () => {
    const { cards } = await projectsLib.listProjects(ownerId)

    const card = cards.find((c) => c.id === projectId)
    expect(card).toBeDefined()
    expect(card!.title).toBe('一灶見山河')
    // 120 seeded episodes — not a figure from the mockup.
    expect(card!.episodeCount).toBe(120)
    expect(card!.plannedEpisodes).toBe(120)
  })

  it('reports zero progress while every stage is still TODO', async () => {
    const { cards } = await projectsLib.listProjects(ownerId)
    const card = cards.find((c) => c.id === projectId)!

    expect(card.progress).toBe(0)
  })

  it('derives progress from completed stages', async () => {
    const [episode] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(eq(schema.episodes.projectId, projectId))
      .limit(1)

    // Mark one stage done, then put it back.
    const [stage] = await db
      .select({ id: schema.episodeProductionStages.id })
      .from(schema.episodeProductionStages)
      .where(eq(schema.episodeProductionStages.episodeId, episode!.id))
      .limit(1)

    await db
      .update(schema.episodeProductionStages)
      .set({ status: 'completed', progressPercent: 100 })
      .where(eq(schema.episodeProductionStages.id, stage!.id))

    try {
      const { cards } = await projectsLib.listProjects(ownerId)
      const card = cards.find((c) => c.id === projectId)!

      // 1 of 1080 stage rows.
      expect(card.progress).toBeGreaterThan(0)
      expect(card.progress).toBeLessThan(0.01)
    } finally {
      await db
        .update(schema.episodeProductionStages)
        .set({ status: 'not_started', progressPercent: 0 })
        .where(eq(schema.episodeProductionStages.id, stage!.id))
    }
  })

  it('counts a half-finished stage as half, and a blocked one as not done', async () => {
    /*
     * spec v3 §11.2: `completed` counts 1, `in_progress` counts its verified
     * percentage, and a blocked stage must never be treated as complete.
     */
    const [episode] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(eq(schema.episodes.projectId, projectId))
      .limit(1)

    const [stage] = await db
      .select({ id: schema.episodeProductionStages.id })
      .from(schema.episodeProductionStages)
      .where(eq(schema.episodeProductionStages.episodeId, episode!.id))
      .limit(1)

    const progressOf = async () => {
      const { cards } = await projectsLib.listProjects(ownerId)
      return cards.find((c) => c.id === projectId)!.progress
    }

    try {
      await db
        .update(schema.episodeProductionStages)
        .set({ status: 'completed', progressPercent: 100 })
        .where(eq(schema.episodeProductionStages.id, stage!.id))
      const whole = await progressOf()

      await db
        .update(schema.episodeProductionStages)
        .set({ status: 'in_progress', progressPercent: 50 })
        .where(eq(schema.episodeProductionStages.id, stage!.id))
      const half = await progressOf()

      expect(half).toBeGreaterThan(0)
      expect(half).toBeLessThan(whole)

      // Blocked at 0% contributes nothing, however urgent it feels.
      await db
        .update(schema.episodeProductionStages)
        .set({ status: 'blocked', progressPercent: 0 })
        .where(eq(schema.episodeProductionStages.id, stage!.id))
      expect(await progressOf()).toBe(0)
    } finally {
      await db
        .update(schema.episodeProductionStages)
        .set({ status: 'not_started', progressPercent: 0 })
        .where(eq(schema.episodeProductionStages.id, stage!.id))
    }
  })

  it('counts every status even when a filter is applied', async () => {
    // The pills must keep showing real totals, not the filtered subset.
    const unfiltered = await projectsLib.listProjects(ownerId)
    const filtered = await projectsLib.listProjects(ownerId, { status: 'ARCHIVED' })

    expect(filtered.cards).toHaveLength(0)
    expect(filtered.counts).toEqual(unfiltered.counts)
    expect(filtered.counts.ALL).toBeGreaterThan(0)
  })

  it('matches on title and on a tag', async () => {
    const byTitle = await projectsLib.listProjects(ownerId, { search: '一灶' })
    expect(byTitle.cards.map((c) => c.id)).toContain(projectId)

    const byTag = await projectsLib.listProjects(ownerId, { search: '古風' })
    expect(byTag.cards.map((c) => c.id)).toContain(projectId)

    const noMatch = await projectsLib.listProjects(ownerId, { search: '不存在的關鍵字' })
    expect(noMatch.cards).toHaveLength(0)
  })

  it('puts the flagship first regardless of sort', async () => {
    for (const sort of ['UPDATED', 'TITLE', 'PROGRESS'] as const) {
      const { cards } = await projectsLib.listProjects(ownerId, { sort })
      if (cards.length > 1) expect(cards[0]!.isFlagship).toBe(true)
    }
  })
})

describe.skipIf(!hasDb)('favourites', () => {
  it('toggles on and off', async () => {
    expect(await projectsLib.toggleFavourite(ownerId, projectId)).toEqual({ isFavourite: true })
    expect(await projectsLib.toggleFavourite(ownerId, projectId)).toEqual({ isFavourite: false })
  })

  it('is per member — one heart does not set the other', async () => {
    await projectsLib.toggleFavourite(ownerId, projectId)

    const mine = await projectsLib.listProjects(ownerId)
    const theirs = await projectsLib.listProjects(otherId)

    expect(mine.cards.find((c) => c.id === projectId)!.isFavourite).toBe(true)
    expect(theirs.cards.find((c) => c.id === projectId)!.isFavourite).toBe(false)
  })
})

describe.skipIf(!hasDb)('project access (docs/ROUTES.md §5)', () => {
  it('resolves a project the member may open', async () => {
    const access = await import('@/lib/project-access')
    const project = await access.findAccessibleProject(projectId, ownerId)

    expect(project).not.toBeNull()
    expect(project!.id).toBe(projectId)
  })

  it('returns null for an id that does not exist', async () => {
    const access = await import('@/lib/project-access')
    const missing = await access.findAccessibleProject(
      '11111111-1111-4111-8111-111111111111',
      ownerId
    )
    expect(missing).toBeNull()
  })

  it('returns null — not a database error — for a malformed id', async () => {
    /*
     * Postgres rejects a malformed uuid with an error rather than an empty
     * result, so an unguarded id straight from the URL turns /projects/garbage
     * into a 500 instead of a 404.
     */
    const access = await import('@/lib/project-access')

    for (const bad of ['garbage', '_', '', '1; drop table projects', '../admin']) {
      await expect(access.findAccessibleProject(bad, ownerId)).resolves.toBeNull()
    }
  })

  it('recognises a well-formed id without touching the database', async () => {
    const access = await import('@/lib/project-access')

    expect(access.isProjectId(projectId)).toBe(true)
    expect(access.isProjectId('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(access.isProjectId('garbage')).toBe(false)
    expect(access.isProjectId(undefined)).toBe(false)
    // Wrong version/variant nibbles.
    expect(access.isProjectId('11111111-1111-9111-0111-111111111111')).toBe(false)
  })
})

describe.skipIf(!hasDb)('getProjectDetail', () => {
  it('resolves the owner and tech lead to readable names', async () => {
    const detail = await projectsLib.getProjectDetail(projectId, ownerId)

    expect(detail).not.toBeNull()
    expect(detail!.ownerName).toMatch(/暖寶/)
    expect(detail!.techLeadName).toMatch(/林鍶恩/)
  })

  it('lists the arcs in order', async () => {
    const detail = await projectsLib.getProjectDetail(projectId, ownerId)

    expect(detail!.arcs.length).toBeGreaterThan(0)
    expect(detail!.arcs[0]!.title).toBe('萬家燈火')
  })

  it('leaves undecided story fields empty rather than inventing them', async () => {
    const detail = await projectsLib.getProjectDetail(projectId, ownerId)

    // spec v2 §0 / §10: the logline and synopsis are not settled yet.
    expect(detail!.logline).toBe('')
    expect(detail!.synopsis).toBe('')
  })

  it('returns null for an unknown project', async () => {
    const missing = await projectsLib.getProjectDetail(
      '11111111-1111-4111-8111-111111111111',
      ownerId
    )
    expect(missing).toBeNull()
  })
})
