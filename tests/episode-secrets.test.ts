import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 編劇已確認的隱藏設定（Z201）。
 *
 * 守三件事：
 *
 * 1. **歸屬**：集數要屬於那個作品才存得進去。這一欄的內容是劇透——掛錯作品等於
 *    把 A 的底牌寫進 B 的檔案裡。
 * 2. **活動紀錄不可以寫內容**：動態是兩個人互相看對方做了什麼的地方，而這一欄
 *    正是不該被順手看到的東西。寫「改了隱藏設定」就夠了。
 * 3. **自己一張表**：`select * from episodes` 撈不到它。這是雙視角隔離的第一
 *    道，而它靠的是 schema 的形狀而不是程式的自律。
 */
const hasDb = testDatabaseReady()

describe.skipIf(!hasDb)('隱藏設定（Z201）', () => {
  let getSecret: typeof import('@/lib/ai/episode-secrets').getSecret
  let setSecret: typeof import('@/lib/ai/episode-secrets').setSecret
  let secretEpisodeIds: typeof import('@/lib/ai/episode-secrets').secretEpisodeIds

  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let eq: typeof import('drizzle-orm').eq
  let and: typeof import('drizzle-orm').and

  let projectId = ''
  let episodeId = ''
  let otherProjectId = ''
  let otherEpisodeId = ''
  let userId = ''
  let user = {} as never

  const SECRET = '梅花印其實是沈家與許家的共營商契，第 28 集才揭曉。'

  beforeAll(async () => {
    if (!hasDb) return
    ;({ getSecret, setSecret, secretEpisodeIds } = await import('@/lib/ai/episode-secrets'))
    ;({ db } = await import('@/db'))
    schema = await import('@/db/schema')
    ;({ eq, and } = await import('drizzle-orm'))

    const stamp = Date.now()
    const [row] = await db
      .insert(schema.users)
      .values({
        name: 'Z201 測試用',
        email: `z201-${stamp}@example.invalid`,
        account: `z201-${stamp}`,
        passwordHash: 'x',
        role: 'OWNER',
      })
      .returning({ id: schema.users.id })
    userId = row!.id
    user = { id: userId, name: 'Z201 測試用', role: 'OWNER' } as never

    const made = await db
      .insert(schema.projects)
      .values([
        { title: 'Z201 甲', slug: `z201-a-${stamp}` },
        { title: 'Z201 乙', slug: `z201-b-${stamp}` },
      ])
      .returning({ id: schema.projects.id })
    projectId = made[0]!.id
    otherProjectId = made[1]!.id

    for (const [index, pid] of [projectId, otherProjectId].entries()) {
      const [arc] = await db
        .insert(schema.arcs)
        .values({ projectId: pid, index: 1, title: '卷一' })
        .returning({ id: schema.arcs.id })
      const [episode] = await db
        .insert(schema.episodes)
        .values({ projectId: pid, arcId: arc!.id, number: 1, title: '第一集' })
        .returning({ id: schema.episodes.id })
      if (index === 0) episodeId = episode!.id
      else otherEpisodeId = episode!.id
    }
  })

  afterAll(async () => {
    if (!hasDb) return
    for (const id of [projectId, otherProjectId]) {
      if (id) await db.delete(schema.projects).where(eq(schema.projects.id, id))
    }
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId))
  })

  it('沒填過的時候是空字串，不是 null', async () => {
    // 呼叫端拿到 null 會多一條分支，而「沒填」本來就是「空的」。
    expect(await getSecret(projectId, episodeId)).toBe('')
  })

  it('存得進去、讀得回來，再存一次是覆蓋不是長出第二筆', async () => {
    await setSecret({ projectId, episodeId, notes: SECRET, user })
    expect(await getSecret(projectId, episodeId)).toBe(SECRET)

    await setSecret({ projectId, episodeId, notes: '改過了', user })
    expect(await getSecret(projectId, episodeId)).toBe('改過了')

    const rows = await db
      .select({ episodeId: schema.episodeSecrets.episodeId })
      .from(schema.episodeSecrets)
      .where(eq(schema.episodeSecrets.projectId, projectId))
    expect(rows).toHaveLength(1)
  })

  it('別部作品的集數存不進去', async () => {
    await expect(
      setSecret({ projectId, episodeId: otherEpisodeId, notes: '亂掛', user })
    ).rejects.toThrow(/不屬於這個作品/)
  })

  it('活動紀錄裡沒有內容，只說改過了', async () => {
    const rows = await db
      .select({ summary: schema.activities.summary })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.projectId, projectId),
          eq(schema.activities.entityType, 'episode_secret')
        )
      )

    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.summary).toContain('隱藏設定')
      // 內容不可以出現在動態上——那等於把劇透貼到儀表板。
      expect(row.summary).not.toContain('梅花')
      expect(row.summary).not.toContain('改過了')
    }
  })

  it('`select * from episodes` 撈不到它', async () => {
    /*
     * 這是隔離的第一道，而它靠的是 schema 的形狀不是程式的自律：隱藏設定在自己
     * 一張表，所以任何一個「順手多撈一欄」的集數查詢都帶不出去。
     */
    const [row] = await db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId))

    // 整列序列化之後一個字都沒有。
    expect(JSON.stringify(row)).not.toContain('改過了')
    expect(JSON.stringify(row)).not.toContain('梅花')

    /*
     * `episodes` 自己有一個 `notes`，而那是**製作備註**，另一回事。
     *
     * 這正好是隱藏設定不該長在 `episodes` 上的第二個理由：連名字都會打架，而
     * 「哪一個 notes」這種問題在 code review 上看不出來。
     */
    expect(row!.notes).toBe('')
  })

  it('列得出哪幾集填過——空白的不算', async () => {
    expect(await secretEpisodeIds(projectId)).toEqual([episodeId])

    await setSecret({ projectId, episodeId, notes: '   ', user })
    expect(await secretEpisodeIds(projectId)).toEqual([])
  })
})
