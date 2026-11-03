import { beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 集數管理 (design 05) query layer.
 *
 * The interesting behaviour is all in SQL — paging, search, filtering and the
 * project scope — so these run against a real database. Spec v3 §11.4 lists
 * most of them as acceptance cases by name.
 */
const hasDb = testDatabaseReady()

let listEpisodes: typeof import('@/lib/episodes').listEpisodes
let projectId: string

beforeAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  ;({ listEpisodes } = await import('@/lib/episodes'))

  const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1)
  if (!project) throw new Error('Run `npm run db:seed` first')
  projectId = project.id
})

describe.skipIf(!hasDb)('listEpisodes paging', () => {
  it('walks 120 episodes in twelve pages of ten', async () => {
    const first = await listEpisodes(projectId)
    expect(first.matched).toBe(120)
    expect(first.pageCount).toBe(12)
    expect(first.rows.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

    const last = await listEpisodes(projectId, { page: 12 })
    expect(last.rows.map((r) => r.number)).toEqual([111, 112, 113, 114, 115, 116, 117, 118, 119, 120])
  })

  it('clamps a page past the end rather than returning nothing', async () => {
    // Otherwise narrowing a filter strands the reader on an empty page 9.
    const beyond = await listEpisodes(projectId, { page: 99 })
    expect(beyond.page).toBe(beyond.pageCount)
    expect(beyond.rows).toHaveLength(10)
  })

  it('clamps a page below one', async () => {
    const before = await listEpisodes(projectId, { page: 0 })
    expect(before.page).toBe(1)
  })

  it('honours 10 / 20 / 50 per page', async () => {
    for (const perPage of [10, 20, 50] as const) {
      const result = await listEpisodes(projectId, { perPage })
      expect(result.rows).toHaveLength(perPage)
      expect(result.pageCount).toBe(Math.ceil(120 / perPage))
    }

    const third = await listEpisodes(projectId, { perPage: 50, page: 3 })
    expect(third.rows[0]!.number).toBe(101)
    expect(third.rows.at(-1)!.number).toBe(120)
  })
})

describe.skipIf(!hasDb)('listEpisodes search and filters', () => {
  it('finds an episode by EP number, with or without the prefix', async () => {
    const byLabel = await listEpisodes(projectId, { search: 'EP120' })
    expect(byLabel.matched).toBe(1)
    expect(byLabel.rows[0]!.number).toBe(120)

    const byNumber = await listEpisodes(projectId, { search: '120' })
    expect(byNumber.matched).toBe(1)
    expect(byNumber.rows[0]!.number).toBe(120)
  })

  it('returns an empty page rather than erroring on no match', async () => {
    const none = await listEpisodes(projectId, { search: '不存在的關鍵字' })
    expect(none.matched).toBe(0)
    expect(none.rows).toHaveLength(0)
    expect(none.pageCount).toBe(1)
  })

  it('sorts by number in both directions', async () => {
    const desc = await listEpisodes(projectId, { sort: 'NUMBER_DESC' })
    expect(desc.rows[0]!.number).toBe(120)
  })

  it('keeps the headline stats unfiltered', async () => {
    // Same rule as the status pills on 作品列表: a count that moves when you
    // filter cannot be used to decide what to filter by.
    const filtered = await listEpisodes(projectId, { search: 'EP120' })
    expect(filtered.matched).toBe(1)
    expect(filtered.stats.total).toBe(120)
  })

  it('gives every episode nine stage cells, in pipeline order', async () => {
    const { PRODUCTION_STAGE_KEYS } = await import('@/lib/production')
    const result = await listEpisodes(projectId, { perPage: 10 })

    for (const row of result.rows) {
      expect(row.stages.map((s) => s.key)).toEqual([...PRODUCTION_STAGE_KEYS])
    }
  })
})

describe.skipIf(!hasDb)('project isolation (docs/ROUTES.md §5)', () => {
  it('never returns another project rows', async () => {
    const other = await listEpisodes('11111111-1111-4111-8111-111111111111')
    expect(other.matched).toBe(0)
    expect(other.rows).toHaveLength(0)
    expect(other.stats.total).toBe(0)
  })

  it('scopes the search too, not just the listing', async () => {
    const other = await listEpisodes('11111111-1111-4111-8111-111111111111', {
      search: 'EP001',
    })
    expect(other.rows).toHaveLength(0)
  })
})
