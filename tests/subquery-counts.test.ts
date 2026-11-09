import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 關聯子查詢算出來的那幾個數字（Z199）。
 *
 * 兩處真的壞過，而且壞法一樣：`sql` 模板裡用 `${episodes.id}` 內插外層欄位，
 * 在**單表 select**（沒有 join）的情況下 drizzle 渲染成不帶表名的 `"id"`，於是
 * 它綁到子查詢最內層那張表的同名欄位，條件永遠不成立。
 *
 * - `storyboardIndex` 的 `shotCount`／`totalSec`／`approved`／`hasScript`
 *   ——集數下拉對每一集都寫「0 鏡」，而那一集有三十個鏡頭。
 * - `listOutline` 的 `charCount`——每集字數一律 0，而二十集裡有正文。
 *
 * `check:subquery` 擋的是**寫法**，這一支守的是**數字**。兩個都要：掃描器看不
 * 懂 SQL 的語意，而測試只看得到它跑過的那幾條查詢。
 *
 * 這裡刻意用「自己建的 fixture」而不是 seed 資料——`shotCount` 回 0 的時候，
 * 「真的沒有鏡頭」跟「條件永遠不成立」長得一模一樣，所以要先證明鏡頭真的建起
 * 來了。
 */
const hasDb = testDatabaseReady()

describe.skipIf(!hasDb)('子查詢算出來的數字（Z199）', () => {
  let storyboardIndex: typeof import('@/lib/storyboard').storyboardIndex
  let listOutline: typeof import('@/lib/episodes').listOutline

  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let eq: typeof import('drizzle-orm').eq

  let projectId = ''
  let episodeId = ''

  beforeAll(async () => {
    if (!hasDb) return
    ;({ storyboardIndex } = await import('@/lib/storyboard'))
    ;({ listOutline } = await import('@/lib/episodes'))
    ;({ db } = await import('@/db'))
    schema = await import('@/db/schema')
    ;({ eq } = await import('drizzle-orm'))

    const stamp = Date.now()
    const [project] = await db
      .insert(schema.projects)
      .values({ title: 'Z199 驗收用', slug: `z199-${stamp}` })
      .returning({ id: schema.projects.id })
    projectId = project!.id

    const [arc] = await db
      .insert(schema.arcs)
      .values({ projectId, index: 1, title: 'Z199 卷一' })
      .returning({ id: schema.arcs.id })

    const [episode] = await db
      .insert(schema.episodes)
      .values({ projectId, arcId: arc!.id, number: 1, title: 'Z199 第一集' })
      .returning({ id: schema.episodes.id })
    episodeId = episode!.id

    // 三個鏡頭，秒數 5 + 7 + 9 = 21，其中一個已核准。
    await db.insert(schema.shots).values([
      { episodeId, order: 1, durationSec: 5 },
      { episodeId, order: 2, durationSec: 7 },
      { episodeId, order: 3, durationSec: 9, status: 'APPROVED' },
    ])

    // 一份有字的小說，一份有字的劇本。
    const docs = await db
      .insert(schema.documents)
      .values([
        { episodeId, kind: 'NOVEL', charCount: 1234 },
        { episodeId, kind: 'SCRIPT', charCount: 88 },
      ])
      .returning({ id: schema.documents.id })
    expect(docs).toHaveLength(2)
  })

  afterAll(async () => {
    if (!hasDb || !projectId) return
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId))
  })

  it('fixture 真的建起來了', async () => {
    const shots = await db
      .select({ id: schema.shots.id })
      .from(schema.shots)
      .where(eq(schema.shots.episodeId, episodeId))
    expect(shots).toHaveLength(3)
  })

  it('storyboardIndex 數得出鏡頭、秒數、已核准與有沒有劇本', async () => {
    const [row] = await storyboardIndex(projectId)
    expect(row, '這個作品只有一集，應該剛好一列').toBeDefined()

    // 壞掉的版本這四個全部是 0／false。
    expect(row!.shotCount).toBe(3)
    expect(row!.totalSec).toBe(21)
    expect(row!.approved).toBe(1)
    expect(row!.hasScript).toBe(true)
  })

  it('listOutline 數得出每一集的字數', async () => {
    const rows = await listOutline(projectId, {})
    expect(rows).toHaveLength(1)
    // 壞掉的版本是 0。取的是 NOVEL 那一份，不是 SCRIPT 的 88。
    expect(rows[0]!.charCount).toBe(1234)
  })
})
