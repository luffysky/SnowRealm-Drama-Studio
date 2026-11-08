import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 鏡頭的參考圖（Z183）。
 *
 * 瀏覽器那一支（`scripts/probe-reference-images.mjs`）驗的是上傳、顯示與放大
 * 鏡，而它需要一個跑起來的站台加真的 R2 憑證，所以不在提交門檻上。這裡守的
 * 是沒有它也會壞的兩件事：**分組**（一集所有鏡頭的參考圖一次查完，不能串到
 * 隔壁鏡頭）與**歸屬**（拆連結之前要先確認那個鏡頭是這個作品的）。
 */
const hasDb = testDatabaseReady()

describe.skipIf(!hasDb)('鏡頭參考圖（Z183）', () => {
  let storyboardFor: typeof import('@/lib/storyboard').storyboardFor
  let unlinkShotReference: typeof import('@/lib/storyboard').unlinkShotReference

  let projectId = ''
  let strangerProjectId = ''
  let episodeId = ''
  let firstShotId = ''
  let secondShotId = ''
  const assetIds: string[] = []

  beforeAll(async () => {
    if (!hasDb) return
    ;({ storyboardFor, unlinkShotReference } = await import('@/lib/storyboard'))

    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { SHOT_REFERENCE_SLOT } = await import('@/lib/constants')
    const stamp = Date.now()

    const made = await db
      .insert(schema.projects)
      .values([
        { title: 'Z183 甲', slug: `z183-a-${stamp}` },
        { title: 'Z183 乙', slug: `z183-b-${stamp}` },
      ])
      .returning({ id: schema.projects.id })
    projectId = made[0]!.id
    strangerProjectId = made[1]!.id

    const [arc] = await db
      .insert(schema.arcs)
      .values({ projectId, index: 1, title: 'Z183 卷一' })
      .returning({ id: schema.arcs.id })

    const [episode] = await db
      .insert(schema.episodes)
      .values({ projectId, arcId: arc!.id, number: 1, title: 'Z183 第一集' })
      .returning({ id: schema.episodes.id })
    episodeId = episode!.id

    const shots = await db
      .insert(schema.shots)
      .values([
        { episodeId, order: 1 },
        { episodeId, order: 2 },
      ])
      .returning({ id: schema.shots.id })
    firstShotId = shots[0]!.id
    secondShotId = shots[1]!.id

    /*
     * 四張圖：第一鏡兩張、第二鏡一張，外加一張沒傳完的。
     *
     * 沒傳完的那一張是對照組——R2 裡可能根本沒有位元組，顯示出來是破圖。
     */
    const images = await db
      .insert(schema.assets)
      .values(
        (
          [
            ['一號參考', 'COMPLETED'],
            ['二號參考', 'COMPLETED'],
            ['別的鏡頭的', 'COMPLETED'],
            ['還沒傳完的', 'PENDING'],
          ] as const
        ).map(([title, status], index) => ({
          projectId,
          episodeId,
          kind: 'IMAGE' as const,
          name: `z183-${index}.png`,
          title,
          objectKey: `z183/${stamp}/${index}.png`,
          mimeType: 'image/png',
          sizeBytes: 100,
          uploadStatus: status,
        }))
      )
      .returning({ id: schema.assets.id })
    assetIds.push(...images.map((row) => row.id))

    /*
     * `createdAt` 明寫出來，不要靠 `now()`。
     *
     * 預設值是**交易時間戳**，所以同一個 INSERT 的每一列完全相同——那時候順
     * 序由 `id`（隨機 uuid）決定，也就是沒有意義。而這一組要測的正是「參考圖
     * 照上傳順序排」，所以時間戳必須是測試說了算的。
     *
     * 真實流程一張一個交易，所以時間戳本來就不同；`asc(id)` 那個第二順位是
     * 給「同一瞬間撞在一起」用的，只保證穩定，不保證有意義。
     */
    const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute))

    await db.insert(schema.assetLinks).values([
      {
        assetId: assetIds[0]!,
        entityType: 'shot',
        entityId: firstShotId,
        slot: SHOT_REFERENCE_SLOT,
        createdAt: at(1),
      },
      {
        assetId: assetIds[1]!,
        entityType: 'shot',
        entityId: firstShotId,
        slot: SHOT_REFERENCE_SLOT,
        createdAt: at(2),
      },
      {
        assetId: assetIds[2]!,
        entityType: 'shot',
        entityId: secondShotId,
        slot: SHOT_REFERENCE_SLOT,
        createdAt: at(3),
      },
      {
        assetId: assetIds[3]!,
        entityType: 'shot',
        entityId: firstShotId,
        slot: SHOT_REFERENCE_SLOT,
        createdAt: at(4),
      },
      /*
       * 同一張圖、同一個鏡頭，但 slot 是首尾幀。
       *
       * 參考圖是人給模型看的，首尾幀是生出來的結果——混在一起之後要分只能靠
       * 猜。這一列在這裡是為了確認查詢真的有看 slot。
       */
      { assetId: assetIds[0]!, entityType: 'shot', entityId: firstShotId, slot: 'first_frame' },
      /*
       * 同一張圖也掛在第二鏡上。
       *
       * 拆連結的 where 如果少了 `entityId`，這一列會被一起刪掉——而第一版沒
       * 有這種列，所以那個缺漏是綠的。
       */
      {
        assetId: assetIds[0]!,
        entityType: 'shot',
        entityId: secondShotId,
        slot: SHOT_REFERENCE_SLOT,
        createdAt: at(5),
      },
    ])
  })

  afterAll(async () => {
    if (!hasDb || !projectId) return
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { inArray } = await import('drizzle-orm')
    await db
      .delete(schema.projects)
      .where(inArray(schema.projects.id, [projectId, strangerProjectId].filter(Boolean)))
  })

  it('fixture 真的建起來了', () => {
    expect(projectId).not.toBe('')
    expect(firstShotId).not.toBe('')
    expect(secondShotId).not.toBe('')
    expect(assetIds).toHaveLength(4)
  })

  it('每一鏡拿到自己的那幾張，不會串到隔壁', async () => {
    const view = await storyboardFor(projectId, episodeId)
    const first = view?.shots.find((shot) => shot.id === firstShotId)
    const second = view?.shots.find((shot) => shot.id === secondShotId)

    expect(first?.references.map((item) => item.label)).toEqual(['一號參考', '二號參考'])
    // 第二鏡：`別的鏡頭的` 在 00:03、`一號參考` 在 00:05，所以照這個順序。
    expect(second?.references.map((item) => item.label)).toEqual(['別的鏡頭的', '一號參考'])
  })

  it('沒傳完的不算，首尾幀也不算', async () => {
    const view = await storyboardFor(projectId, episodeId)
    const first = view?.shots.find((shot) => shot.id === firstShotId)

    // 沒傳完的 `還沒傳完的`、以及 slot 是 first_frame 的那一列，都不該出現。
    expect(first?.references).toHaveLength(2)
    expect(first?.references.some((item) => item.label === '還沒傳完的')).toBe(false)
  })

  it('沒有參考圖的鏡頭回空陣列，不是 undefined', async () => {
    // 介面直接 `.map()` 它，undefined 會整頁炸掉。
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const [bare] = await db
      .insert(schema.shots)
      .values({ episodeId, order: 3 })
      .returning({ id: schema.shots.id })

    const view = await storyboardFor(projectId, episodeId)
    expect(view?.shots.find((shot) => shot.id === bare!.id)?.references).toEqual([])
  })

  it('軟刪除的素材不算', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    await db
      .update(schema.assets)
      .set({ deletedAt: new Date() })
      .where(eq(schema.assets.id, assetIds[0]!))

    const view = await storyboardFor(projectId, episodeId)
    expect(
      view?.shots.find((shot) => shot.id === firstShotId)?.references.map((i) => i.label)
    ).toEqual(['二號參考'])

    await db
      .update(schema.assets)
      .set({ deletedAt: null })
      .where(eq(schema.assets.id, assetIds[0]!))
  })

  it('拆連結之前先確認那個鏡頭是這個作品的', async () => {
    /*
     * 少了這一步，這支會變成「給我任何一個 shot id，我就幫你拆掉它的連結」
     * ——而 shot id 在網址列上。
     */
    await expect(
      unlinkShotReference({
        projectId: strangerProjectId,
        shotId: firstShotId,
        assetId: assetIds[0]!,
      })
    ).rejects.toThrow('找不到這個鏡頭')

    // 而且真的沒有拆到。
    const view = await storyboardFor(projectId, episodeId)
    expect(view?.shots.find((shot) => shot.id === firstShotId)?.references).toHaveLength(2)
  })

  it('自己作品的拆得掉，而且只拆那一張', async () => {
    await unlinkShotReference({ projectId, shotId: firstShotId, assetId: assetIds[0]! })

    const view = await storyboardFor(projectId, episodeId)
    expect(
      view?.shots.find((shot) => shot.id === firstShotId)?.references.map((i) => i.label)
    ).toEqual(['二號參考'])
    // 同一張圖掛在第二鏡上的那一列還在（where 少了 `entityId` 就會紅）。
    expect(
      view?.shots.find((shot) => shot.id === secondShotId)?.references.map((i) => i.label)
    ).toEqual(['別的鏡頭的', '一號參考'])
  })

  it('拆參考圖不會順手拆掉同一張圖的首尾幀連結', async () => {
    // where 少了 `slot` 就會紅：首尾幀是生出來的結果，不是人放的參考。
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { and, eq } = await import('drizzle-orm')

    const left = await db
      .select({ slot: schema.assetLinks.slot })
      .from(schema.assetLinks)
      .where(
        and(
          eq(schema.assetLinks.assetId, assetIds[0]!),
          eq(schema.assetLinks.entityId, firstShotId)
        )
      )

    expect(left.map((row) => row.slot)).toEqual(['first_frame'])
  })

  it('拆的是連結，不是檔案', async () => {
    // 檔案留在素材庫。要真的刪走素材中心，那條路會先檢查還有誰在引用它。
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const [asset] = await db
      .select({ id: schema.assets.id, deletedAt: schema.assets.deletedAt })
      .from(schema.assets)
      .where(eq(schema.assets.id, assetIds[0]!))

    expect(asset?.id).toBe(assetIds[0])
    expect(asset?.deletedAt).toBeNull()
  })
})
