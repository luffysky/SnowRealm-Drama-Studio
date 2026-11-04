import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 卷（Z128）。
 *
 * 卷被要求是「單純一個單位跟收納器」，不能影響劇本對接跟其他數據。
 * 這份測試盯的就是那幾個「會影響到別人」的地方，而不是 CRUD 本身：
 *
 *  1. **搬卷不改集號。** `episodes.number` 是小說、劇本、分鏡和正文裡每一句
 *     「第 007 集」共用的編號。搬動只能寫 `arc_id`。
 *  2. **刪卷不刪集。** `episodes.arc_id` 是 `on delete cascade`——真的把卷
 *     刪掉會連集數一起帶走。這是整個功能唯一能毀掉東西的操作。
 *  3. **新卷的規劃集數是 0。** `plannedEpisodes` 在作品卡片上是**跨卷加總**
 *     的，新卷若吃 schema 預設的 120，「規劃 120 集」會變成 240。
 */

const ready = testDatabaseReady()

describe.skipIf(!ready)('卷', () => {
  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let arcs: typeof import('@/lib/arcs')

  let projectId = ''
  let originalArcId = ''
  let user: import('@/lib/auth/session').SessionUser

  /** Arcs this test made, removed for real afterwards. */
  const made: string[] = []

  beforeAll(async () => {
    db = (await import('@/db')).db
    schema = await import('@/db/schema')
    arcs = await import('@/lib/arcs')

    const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1)
    if (!project) throw new Error('先跑 npm run db:seed')
    projectId = project.id

    const [u] = await db.select().from(schema.users).limit(1)
    if (!u) throw new Error('先跑 npm run db:seed')
    user = {
      id: u.id,
      email: u.email,
      name: u.name,
      title: u.title,
      role: u.role,
      color: u.color,
      displayCurrency: u.displayCurrency as import('@/lib/money').CurrencyValue,
    }

    const existing = await arcs.listArcs(projectId)
    if (existing.length === 0) throw new Error('這個作品沒有任何卷')
    originalArcId = existing[0]!.id
  })

  afterAll(async () => {
    const { eq, inArray } = await import('drizzle-orm')

    /*
     * Everything goes back where it came from. A test that leaves episodes
     * filed under 「測試卷」 would be a test that broke the app it checked.
     */
    if (made.length > 0 && originalArcId) {
      await db
        .update(schema.episodes)
        .set({ arcId: originalArcId })
        .where(inArray(schema.episodes.arcId, made))
      for (const id of made) {
        await db.delete(schema.arcs).where(eq(schema.arcs.id, id))
      }
    }

    const { closeDb } = await import('@/db')
    await closeDb()
  })

  async function freshArc(title: string) {
    const arc = await arcs.createArc({ projectId, title, user })
    made.push(arc.id)
    return arc
  }

  it('新卷的規劃集數是 0，不會把作品的規劃集數灌水', async () => {
    const arc = await freshArc(`測試卷 A ${Date.now()}`)

    // The schema default is 120. Taking it would double a 120-episode work.
    expect(arc.plannedEpisodes).toBe(0)
    expect(arc.episodeCount).toBe(0)
  })

  it('搬卷只改 arc_id，集號原封不動', async () => {
    const arc = await freshArc(`測試卷 B ${Date.now()}`)

    const { and, asc, eq, isNull } = await import('drizzle-orm')
    const sample = await db
      .select({ id: schema.episodes.id, number: schema.episodes.number })
      .from(schema.episodes)
      .where(
        and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt))
      )
      .orderBy(asc(schema.episodes.number))
      .limit(3)

    expect(sample.length).toBe(3)
    const before = sample.map((row) => row.number)

    const moved = await arcs.moveEpisodesToArc({
      projectId,
      arcId: arc.id,
      episodeIds: sample.map((row) => row.id),
      user,
    })
    expect(moved).toBe(3)

    const after = await db
      .select({ id: schema.episodes.id, number: schema.episodes.number, arcId: schema.episodes.arcId })
      .from(schema.episodes)
      .where(
        and(
          eq(schema.episodes.projectId, projectId),
          isNull(schema.episodes.deletedAt),
          eq(schema.episodes.arcId, arc.id)
        )
      )
      .orderBy(asc(schema.episodes.number))

    expect(after.map((row) => row.number)).toEqual(before)
    expect(new Set(after.map((row) => row.arcId))).toEqual(new Set([arc.id]))

    // Put them back before the next test looks at the counts.
    await arcs.moveEpisodesToArc({
      projectId,
      arcId: originalArcId,
      episodeIds: sample.map((row) => row.id),
      user,
    })
  })

  it('別的作品的集數搬不動', async () => {
    const arc = await freshArc(`測試卷 C ${Date.now()}`)

    const { ne } = await import('drizzle-orm')
    const [stranger] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(ne(schema.episodes.projectId, projectId))
      .limit(1)

    if (!stranger) return // Only one project seeded; nothing to prove against.

    const moved = await arcs.moveEpisodesToArc({
      projectId,
      arcId: arc.id,
      episodeIds: [stranger.id],
      user,
    })
    expect(moved).toBe(0)
  })

  it('有集數的卷，沒指定去處時不准刪', async () => {
    const arc = await freshArc(`測試卷 D ${Date.now()}`)

    const { and, eq, isNull } = await import('drizzle-orm')
    const [episode] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))
      .limit(1)

    await arcs.moveEpisodesToArc({
      projectId,
      arcId: arc.id,
      episodeIds: [episode!.id],
      user,
    })

    await expect(arcs.deleteArc({ projectId, arcId: arc.id, user })).rejects.toThrow(/搬去/)

    // And the episode is still there, which is the whole point.
    const [still] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episode!.id))
      .limit(1)
    expect(still?.id).toBe(episode!.id)

    await arcs.moveEpisodesToArc({
      projectId,
      arcId: originalArcId,
      episodeIds: [episode!.id],
      user,
    })
  })

  it('刪卷會把集數搬走，而不是連著刪掉', async () => {
    const arc = await freshArc(`測試卷 E ${Date.now()}`)

    const { and, asc, eq, isNull } = await import('drizzle-orm')
    const sample = await db
      .select({ id: schema.episodes.id, number: schema.episodes.number })
      .from(schema.episodes)
      .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))
      .orderBy(asc(schema.episodes.number))
      .limit(2)

    await arcs.moveEpisodesToArc({
      projectId,
      arcId: arc.id,
      episodeIds: sample.map((row) => row.id),
      user,
    })

    const { moved } = await arcs.deleteArc({
      projectId,
      arcId: arc.id,
      moveTo: originalArcId,
      user,
    })
    expect(moved).toBe(2)

    /*
     * The cascade test. `episodes.arc_id` is `on delete cascade`, so a
     * hard delete of the arc would have taken these with it.
     */
    const survivors = await db
      .select({ id: schema.episodes.id, number: schema.episodes.number, arcId: schema.episodes.arcId })
      .from(schema.episodes)
      .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))
      .orderBy(asc(schema.episodes.number))
      .limit(2)

    expect(survivors.map((row) => row.number)).toEqual(sample.map((row) => row.number))
    expect(survivors.every((row) => row.arcId === originalArcId)).toBe(true)

    // Soft-deleted, so it is gone from the list but the row is still there.
    const listed = await arcs.listArcs(projectId)
    expect(listed.some((row) => row.id === arc.id)).toBe(false)
  })

  it('最後一卷不准刪', async () => {
    /*
     * This first wound up as `if (listed.length !== 1) return`, which meant
     * the arcs left behind by the tests above made it assert nothing at all
     * while still reporting green. So it establishes the precondition rather
     * than waiting for it: clear every arc this file made, then there really
     * is one left and the refusal is the thing being tested.
     */
    for (const id of [...made]) {
      const current = await arcs.listArcs(projectId)
      if (!current.some((row) => row.id === id)) continue
      await arcs.deleteArc({ projectId, arcId: id, moveTo: originalArcId, user })
    }

    const listed = await arcs.listArcs(projectId)
    expect(listed).toHaveLength(1)
    expect(listed[0]!.id).toBe(originalArcId)

    await expect(arcs.deleteArc({ projectId, arcId: originalArcId, user })).rejects.toThrow(
      /最後一卷/
    )
  })

  it('列出的卷會帶上集數範圍', async () => {
    const listed = await arcs.listArcs(projectId)
    const main = listed.find((row) => row.id === originalArcId)

    expect(main).toBeDefined()
    expect(main!.episodeCount).toBeGreaterThan(0)
    expect(main!.firstNumber).not.toBeNull()
    expect(main!.lastNumber).toBeGreaterThanOrEqual(main!.firstNumber!)
  })
})
