import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 存起來的編劇整理（Z200）。
 *
 * 守三件在畫面上看不出來的事：
 *
 * 1. **歸屬**：集數要屬於那個作品，整理也要屬於那個作品才刪得掉。外鍵只保證
 *    那個 id 存在，不保證它是誰的——跟 Z190／Z194／Z197 同一條規矩。
 * 2. **種類擋在應用程式**：`kind` 是 text 不是 enum（Z184 的教訓），所以資料
 *    庫擋不住認不得的值，要在這裡擋。
 * 3. **存的是結果不是原字串**：`payload` 原樣進原樣出，不經過解析器——解析器
 *    會改，而存起來的東西必須永遠畫得出來。
 */
const hasDb = testDatabaseReady()

describe.skipIf(!hasDb)('存起來的編劇整理（Z200）', () => {
  let saveReport: typeof import('@/lib/ai/writer-reports').saveReport
  let listReports: typeof import('@/lib/ai/writer-reports').listReports
  let deleteReport: typeof import('@/lib/ai/writer-reports').deleteReport

  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let eq: typeof import('drizzle-orm').eq

  let projectId = ''
  let otherProjectId = ''
  let otherEpisodeId = ''
  let userId = ''
  let user = {} as never

  beforeAll(async () => {
    if (!hasDb) return
    ;({ saveReport, listReports, deleteReport } = await import('@/lib/ai/writer-reports'))
    ;({ db } = await import('@/db'))
    schema = await import('@/db/schema')
    ;({ eq } = await import('drizzle-orm'))

    const stamp = Date.now()
    const [row] = await db
      .insert(schema.users)
      .values({
        name: 'Z200 測試用',
        email: `z200-${stamp}@example.invalid`,
        account: `z200-${stamp}`,
        passwordHash: 'x',
        role: 'OWNER',
      })
      .returning({ id: schema.users.id })
    userId = row!.id
    user = { id: userId, name: 'Z200 測試用', role: 'OWNER' } as never

    const made = await db
      .insert(schema.projects)
      .values([
        { title: 'Z200 甲', slug: `z200-a-${stamp}` },
        { title: 'Z200 乙', slug: `z200-b-${stamp}` },
      ])
      .returning({ id: schema.projects.id })
    projectId = made[0]!.id
    otherProjectId = made[1]!.id

    const [arc] = await db
      .insert(schema.arcs)
      .values({ projectId: otherProjectId, index: 1, title: '乙卷一' })
      .returning({ id: schema.arcs.id })
    const [episode] = await db
      .insert(schema.episodes)
      .values({ projectId: otherProjectId, arcId: arc!.id, number: 1, title: '乙第一集' })
      .returning({ id: schema.episodes.id })
    otherEpisodeId = episode!.id
  })

  afterAll(async () => {
    if (!hasDb) return
    for (const id of [projectId, otherProjectId]) {
      if (id) await db.delete(schema.projects).where(eq(schema.projects.id, id))
    }
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId))
  })

  it('存進去，列得出來，而且 payload 原樣回來', async () => {
    const payload = {
      mainline: '沈知味用三文錢起家。',
      threads: ['醉仙樓合作'],
      characters: [{ name: '沈知味', now: '店主', wants: '查清楚', changed: '從攤販到店主' }],
      issues: [],
    }

    const { id } = await saveReport({
      projectId,
      kind: 'DIGEST',
      title: '主線與人設・11/10 03:00',
      payload,
      model: 'claude-opus-5',
      user,
    })
    expect(id).toBeTruthy()

    const rows = await listReports(projectId)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.kind).toBe('DIGEST')
    expect(rows[0]!.createdByName).toBe('Z200 測試用')
    // 原樣進原樣出——不經過解析器。
    expect(rows[0]!.payload).toEqual(payload)
    // 伺服器端元件要把它傳給用戶端元件，所以時間是字串不是 Date。
    expect(typeof rows[0]!.createdAt).toBe('string')
  })

  it('認不得的種類會被擋下來', async () => {
    await expect(
      saveReport({ projectId, kind: 'WHATEVER', title: '亂寫', payload: { a: 1 }, user })
    ).rejects.toThrow(/認不得/)
  })

  it('空的 payload 存不進去', async () => {
    await expect(
      saveReport({ projectId, kind: 'ASK', title: '空的', payload: null, user })
    ).rejects.toThrow(/沒有東西/)
  })

  it('別部作品的集數掛不上來', async () => {
    await expect(
      saveReport({
        projectId,
        episodeId: otherEpisodeId,
        kind: 'EPISODE',
        title: '亂掛',
        payload: { events: ['x'] },
        user,
      })
    ).rejects.toThrow(/不屬於這個作品/)
  })

  it('別部作品的整理刪不掉', async () => {
    const { id } = await saveReport({
      projectId: otherProjectId,
      kind: 'ASK',
      title: '乙的問答',
      payload: [{ question: '甲', answer: '乙' }],
      user,
    })

    await expect(deleteReport({ projectId, reportId: id, user })).rejects.toThrow(/找不到/)

    // 真的還在——上面那一條不可以因為「它本來就不存在」而通過。
    const still = await listReports(otherProjectId)
    expect(still.map((r) => r.id)).toContain(id)

    // 用對的作品就刪得掉。
    await deleteReport({ projectId: otherProjectId, reportId: id, user })
    const after = await listReports(otherProjectId)
    expect(after.map((r) => r.id)).not.toContain(id)
  })

  it('最新的排在前面', async () => {
    await saveReport({ projectId, kind: 'ASK', title: '第二份', payload: [{ question: 'q', answer: 'a' }], user })
    const rows = await listReports(projectId)
    expect(rows[0]!.title).toBe('第二份')
  })
})
