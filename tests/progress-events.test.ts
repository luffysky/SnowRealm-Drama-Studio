import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 階段異動要留下稽核列（Z197）。
 *
 * `production_progress_events` 這張表從建好那天起**沒有任何程式寫過它**，而製
 * 作頁與儀表板的「製作進度趨勢」都讀它——所以那兩張圖從上線到現在畫的一直是空
 * 狀態，而空狀態寫著「階段狀態第一次變更後，這裡會以稽核紀錄繪出趨勢」。等不
 * 到，因為沒有人在寫。
 *
 * 這一支要守的是兩條路都寫，而且**只在狀態真的變了的時候寫**：
 *
 * - `syncEpisodeStages`（依正文重算，每一次存檔後都跑）。正式庫裡一筆
 *   `episode_stage` 活動紀錄都沒有，也就是從來沒有人手動改過階段——二十三格不
 *   是未開始的全部是這裡寫的。只記人工那條路的話那張圖還是會一直空著。
 * - `updateEpisodeStage`（人按下去的）。
 *
 * 而「只在真的變了」這件事比「有寫」更要緊：重算在每一次存檔後都跑，每跑一次
 * 記一筆的話趨勢圖會把同一次進度數很多次。
 */
const hasDb = testDatabaseReady()

describe.skipIf(!hasDb)('進度稽核列（Z197）', () => {
  let syncEpisodeStages: typeof import('@/lib/stage-sync').syncEpisodeStages
  let updateEpisodeStage: typeof import('@/lib/episode-stages').updateEpisodeStage

  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let eq: typeof import('drizzle-orm').eq
  let and: typeof import('drizzle-orm').and

  let projectId = ''
  let episodeId = ''
  let userId = ''

  const events = async () => {
    const rows = await db
      .select({
        stageKey: schema.productionProgressEvents.stageKey,
        fromStatus: schema.productionProgressEvents.fromStatus,
        toStatus: schema.productionProgressEvents.toStatus,
        reason: schema.productionProgressEvents.reason,
      })
      .from(schema.productionProgressEvents)
      .where(eq(schema.productionProgressEvents.projectId, projectId))
    return rows
  }

  beforeAll(async () => {
    if (!hasDb) return
    ;({ syncEpisodeStages } = await import('@/lib/stage-sync'))
    ;({ updateEpisodeStage } = await import('@/lib/episode-stages'))
    ;({ db } = await import('@/db'))
    schema = await import('@/db/schema')
    ;({ eq, and } = await import('drizzle-orm'))

    const stamp = Date.now()

    /*
     * 自己把人建起來。
     *
     * `production_progress_events.actor_id` 是 FK，而寫死一個 id 的話這一支會
     * 在「那個人不存在」的環境上紅——而紅的理由跟它要測的事無關。
     */
    const [user] = await db
      .insert(schema.users)
      .values({
        name: 'Z197 測試用',
        email: `z197-${stamp}@example.invalid`,
        account: `z197-${stamp}`,
        passwordHash: 'x',
        role: 'OWNER',
      })
      .returning({ id: schema.users.id })
    userId = user!.id

    /* `target_chars` 要有值，不然 novel 那一格的 fraction 是 null。 */
    const [project] = await db
      .insert(schema.projects)
      .values({ title: 'Z197 驗收用', slug: `z197-${stamp}`, targetChars: 1000 })
      .returning({ id: schema.projects.id })
    projectId = project!.id

    const [arc] = await db
      .insert(schema.arcs)
      .values({ projectId, index: 1, title: 'Z197 卷一' })
      .returning({ id: schema.arcs.id })

    const [episode] = await db
      .insert(schema.episodes)
      .values({ projectId, arcId: arc!.id, number: 1, title: 'Z197 第一集' })
      .returning({ id: schema.episodes.id })
    episodeId = episode!.id

    /* 九格階段。正式流程是建立集數時長出來的，這裡自己補。 */
    const { PRODUCTION_STAGE_KEYS } = await import('@/lib/production')
    await db.insert(schema.episodeProductionStages).values(
      PRODUCTION_STAGE_KEYS.map((stageKey) => ({
        projectId,
        episodeId,
        stageKey,
        status: 'not_started' as const,
      }))
    )

    const [document] = await db
      .insert(schema.documents)
      .values({ episodeId, kind: 'NOVEL' })
      .returning({ id: schema.documents.id })

    await db.insert(schema.chapters).values({
      documentId: document!.id,
      sortOrder: 1,
      title: '第一章',
      content: '沈知味推開門，灶上的火還沒熄。',
      charCount: 400,
    })
  })

  afterAll(async () => {
    if (!hasDb || !projectId) return
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId))
    if (userId) await db.delete(schema.users).where(eq(schema.users.id, userId))
  })

  it('fixture 真的建起來了', async () => {
    const rows = await db
      .select({ id: schema.episodeProductionStages.id })
      .from(schema.episodeProductionStages)
      .where(eq(schema.episodeProductionStages.episodeId, episodeId))
    expect(rows).toHaveLength(9)
    expect(await events()).toEqual([])
  })

  it('依正文重算會留下 from → to 的稽核列', async () => {
    const changed = await syncEpisodeStages(episodeId)
    // 回傳的是「改了幾列」。改成 CTE 之後最後一句是 SELECT，rowCount 永遠是 1
    // ——這一條守的就是那個數字沒有被換掉。
    expect(changed).toBeGreaterThan(0)

    const rows = await events()
    const novel = rows.find((row) => row.stageKey === 'novel')
    expect(novel, JSON.stringify(rows)).toBeDefined()
    expect(novel!.fromStatus).toBe('not_started')
    expect(novel!.toStatus).toBe('in_progress')
    expect(novel!.reason).toContain('重算')
  })

  it('再跑一次不會多記一筆——狀態沒變就不是一次異動', async () => {
    const before = (await events()).length
    await syncEpisodeStages(episodeId)
    await syncEpisodeStages(episodeId)
    expect(await events()).toHaveLength(before)
  })

  it('百分比爬了但狀態沒變，不算一次階段異動', async () => {
    /*
     * 這一條才是那道守衛真正要擋的事。
     *
     * 「再跑一次」那條其實抓不到它——UPDATE 自己的 where 就已經擋掉「什麼都
     * 不會改」的重跑了，所以把守衛拿掉那一條還是綠的。真正會漏的是**字數往上
     * 爬**：UPDATE 會動（progress_percent 從 40 變 80），而狀態還是進行中。
     * 少了守衛，作者每存一次檔趨勢圖就多一格「有進度」。
     */
    const before = (await events()).length

    const [document] = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(eq(schema.documents.episodeId, episodeId))

    await db
      .update(schema.chapters)
      .set({ charCount: 800 })
      .where(eq(schema.chapters.documentId, document!.id))

    const changed = await syncEpisodeStages(episodeId)
    // 真的有改到東西——不然這條測試會因為「什麼都沒發生」而通過。
    expect(changed).toBeGreaterThan(0)

    const [stage] = await db
      .select({
        status: schema.episodeProductionStages.status,
        progressPercent: schema.episodeProductionStages.progressPercent,
      })
      .from(schema.episodeProductionStages)
      .where(
        and(
          eq(schema.episodeProductionStages.episodeId, episodeId),
          eq(schema.episodeProductionStages.stageKey, 'novel')
        )
      )
    expect(stage!.status).toBe('in_progress')
    expect(stage!.progressPercent).toBeGreaterThan(40)

    expect(await events()).toHaveLength(before)
  })

  it('人把階段改成完成也會留下稽核列', async () => {
    const before = (await events()).length

    await updateEpisodeStage({
      projectId,
      episodeId,
      stage: 'storyboard',
      state: 'completed',
      user: { id: userId, name: 'Z197 測試用', role: 'OWNER' } as never,
    })

    const rows = await events()
    expect(rows).toHaveLength(before + 1)
    const last = rows.find((row) => row.stageKey === 'storyboard')
    expect(last!.fromStatus).toBe('not_started')
    expect(last!.toStatus).toBe('completed')
  })

  it('只改備註不算一次階段異動', async () => {
    const before = (await events()).length
    await updateEpisodeStage({
      projectId,
      episodeId,
      stage: 'storyboard',
      note: '這一句不該產生稽核列',
      user: { id: userId, name: 'Z197 測試用', role: 'OWNER' } as never,
    })
    expect(await events()).toHaveLength(before)

    // 而備註真的寫進去了——上面那一條不可以因為「什麼都沒做」而通過。
    const [row] = await db
      .select({ note: schema.episodeProductionStages.note })
      .from(schema.episodeProductionStages)
      .where(
        and(
          eq(schema.episodeProductionStages.episodeId, episodeId),
          eq(schema.episodeProductionStages.stageKey, 'storyboard')
        )
      )
    expect(row!.note).toBe('這一句不該產生稽核列')
  })

  it('把已完成再設成已完成，不會多一筆', async () => {
    const before = (await events()).length
    await updateEpisodeStage({
      projectId,
      episodeId,
      stage: 'storyboard',
      state: 'completed',
      user: { id: userId, name: 'Z197 測試用', role: 'OWNER' } as never,
    })
    expect(await events()).toHaveLength(before)
  })
})
