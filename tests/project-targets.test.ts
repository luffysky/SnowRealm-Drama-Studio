import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 改了單集片長，現有集數要跟著走（Z130）。
 *
 * `episodes.target_sec` 只在建立作品時寫過一次（取上下限中點），之後
 * **沒有任何地方**再寫過它。所以在作品設定改片長，改的是一個沒人讀的數字：
 * 體檢和劇本進度比的都是每一集自己的 `target_sec`，120 集會安靜地留在舊值。
 *
 * 這是這個 repo 已經出現過三次的同一種病——`episode_production_stages`、
 * `episode_characters`、AI 的 `targetType`——欄位有人讀、沒人寫。
 *
 * 第一版的實作想聰明一點：只搬「`target_sec` 還等於作品目前範圍中點」的集數，
 * 當作那些是沒人動過的。**一筆都沒配到**——因為集數正是「沒被傳播到」才會跟
 * 作品不同步，而那就是這次要修的東西本身。這份測試就是抓到那件事的。
 *
 * 所以現在的行為是：勾了就**全部**改。目前也沒有東西要保護——沒有任何畫面
 * 可以設定單集片長。等那個畫面出現，它該一起帶一個「這個值是選的不是繼承的」
 * 欄位；從數字去猜是行不通的，這次已經證明過一次。
 */

const ready = testDatabaseReady()

describe.skipIf(!ready)('單集片長的傳播', () => {
  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let projects: typeof import('@/lib/projects')

  let projectId = ''
  let userId = ''
  let original = { min: 0, max: 0 }

  beforeAll(async () => {
    db = (await import('@/db')).db
    schema = await import('@/db/schema')
    projects = await import('@/lib/projects')

    const [project] = await db
      .select({
        id: schema.projects.id,
        min: schema.projects.targetMinSec,
        max: schema.projects.targetMaxSec,
      })
      .from(schema.projects)
      .limit(1)
    if (!project) throw new Error('先跑 npm run db:seed')

    projectId = project.id
    original = { min: project.min, max: project.max }

    const [u] = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
    if (!u) throw new Error('先跑 npm run db:seed')
    userId = u.id
  })

  afterAll(async () => {
    const { and, eq, isNull } = await import('drizzle-orm')

    // Put the work back exactly as it was found.
    await projects.updateProject(projectId, userId, {
      targetMinSec: original.min,
      targetMaxSec: original.max,
      applyTargetToEpisodes: false,
    })
    await db
      .update(schema.episodes)
      .set({ targetSec: Math.round((original.min + original.max) / 2) })
      .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))

    const { closeDb } = await import('@/db')
    await closeDb()
  })

  async function targets() {
    const { and, eq, isNull } = await import('drizzle-orm')
    const rows = await db
      .select({ id: schema.episodes.id, targetSec: schema.episodes.targetSec })
      .from(schema.episodes)
      .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))
    return rows
  }

  it('不勾的話，集數一動也不動', async () => {
    const before = await targets()

    await projects.updateProject(projectId, userId, {
      targetMinSec: 200,
      targetMaxSec: 400,
      applyTargetToEpisodes: false,
    })

    const after = await targets()
    const byId = new Map(after.map((row) => [row.id, row.targetSec]))
    for (const row of before) expect(byId.get(row.id)).toBe(row.targetSec)
  })

  it('勾了就跟著走，而且回報動了幾集', async () => {
    const before = await targets()

    const result = await projects.updateProject(projectId, userId, {
      targetMinSec: 240,
      targetMaxSec: 360,
      applyTargetToEpisodes: true,
    })

    const newMid = Math.round((240 + 360) / 2)
    expect(result?.episodesRetargeted).toBe(before.length)

    const after = await targets()
    expect(after.every((row) => row.targetSec === newMid)).toBe(true)
  })

  it('集數跟作品不同步時照樣搬得動', async () => {
    /*
     * The case the first implementation got wrong. Saving once without the
     * box, then once with it, leaves the episodes on a value that matches
     * neither the old nor the new project range — and they still have to
     * move, because that drift is the bug being fixed.
     */
    const { and, eq, isNull } = await import('drizzle-orm')
    await db
      .update(schema.episodes)
      .set({ targetSec: 77 })
      .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))

    const all = await targets()
    const result = await projects.updateProject(projectId, userId, {
      targetMinSec: 180,
      targetMaxSec: 180,
      applyTargetToEpisodes: true,
    })

    expect(result?.episodesRetargeted).toBe(all.length)
    expect((await targets()).every((row) => row.targetSec === 180)).toBe(true)
  })

  it('回報的是真的改了幾集，不是全部', async () => {
    const { inArray } = await import('drizzle-orm')
    const all = await targets()

    // Everything is already on 180 from the test above; move two away.
    const moved = all.slice(0, 2).map((row) => row.id)
    await db
      .update(schema.episodes)
      .set({ targetSec: 90 })
      .where(inArray(schema.episodes.id, moved))

    const result = await projects.updateProject(projectId, userId, {
      targetMinSec: 180,
      targetMaxSec: 180,
      applyTargetToEpisodes: true,
    })

    // Only the two that were off it. Reporting 120 here would be the kind of
    // confirmation that teaches people to stop reading them.
    expect(result?.episodesRetargeted).toBe(2)
  })

  it('片長沒變就不會去碰集數', async () => {
    const result = await projects.updateProject(projectId, userId, {
      // Only the word count moved.
      targetChars: 5000,
      applyTargetToEpisodes: true,
    })

    expect(result?.episodesRetargeted).toBe(0)
  })
})
