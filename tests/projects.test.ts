import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv } from '@/lib/load-env'

/**
 * Integration tests for the 作品列表 query layer (design 03).
 *
 * The interesting behaviour is all in SQL — per-status counts that ignore the
 * active filter, progress derived from stage rows, and a favourite scoped to
 * one member — so these run against a real database rather than mocks.
 */

loadEnv()

const dbUrl = process.env.DATABASE_URL ?? ''
const hasDb = Boolean(dbUrl) && !/neon\.(tech|build)/.test(dbUrl)

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
      .select({ id: schema.episodeStages.id })
      .from(schema.episodeStages)
      .where(eq(schema.episodeStages.episodeId, episode!.id))
      .limit(1)

    await db
      .update(schema.episodeStages)
      .set({ state: 'DONE' })
      .where(eq(schema.episodeStages.id, stage!.id))

    try {
      const { cards } = await projectsLib.listProjects(ownerId)
      const card = cards.find((c) => c.id === projectId)!

      // 1 of 1080 stage rows.
      expect(card.progress).toBeGreaterThan(0)
      expect(card.progress).toBeLessThan(0.01)
    } finally {
      await db
        .update(schema.episodeStages)
        .set({ state: 'TODO' })
        .where(eq(schema.episodeStages.id, stage!.id))
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
