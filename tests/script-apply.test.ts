import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyTargetFor } from '@/lib/ai/apply-targets'
import { BATCH_TASKS } from '@/lib/ai/batch-view'
import { describeScenes, parseSceneList, sceneCodeFor } from '@/lib/ai/scene-draft'
import { testDatabaseReady } from './helpers/database'

/**
 * 小說轉劇本的套用 (Z30).
 *
 * 這一支盯的是四件事，而其中兩件「做半套」的後果是毀資料不是少功能：
 *
 *  1. 讀得出場次就寫得進 `scenes`，而**片長由伺服器算**，不是模型說了算。
 *  2. **覆蓋之前一定先存版本**，而且在同一個 transaction 裡。
 *  3. **讀不出東西就一個字都不要改。** 先清空再發現讀不出來，等於按一次
 *     「採用」把整份劇本刪了。
 *  4. **寫的是 SCRIPT 那一份，不是 NOVEL。** `documents` 是
 *     unique(episode_id, kind)，一集有兩列——篩錯就是把小說清掉。
 */

describe('parseSceneList（純函式，不碰資料庫）', () => {
  it('讀得出裸陣列，也讀得出被 ```json 包起來的', () => {
    const rows = [{ heading: '開張', location: '小灶房', timeOfDay: '日', content: '<p>灶火升起。</p>' }]

    const bare = parseSceneList(JSON.stringify(rows))
    const fenced = parseSceneList('```json\n' + JSON.stringify(rows) + '\n```')

    expect(bare.scenes).toHaveLength(1)
    expect(fenced.scenes).toEqual(bare.scenes)
    expect(bare.scenes[0]!.location).toBe('小灶房')
  })

  it('相容層會把陣列包成物件，那也要讀得出來', () => {
    const parsed = parseSceneList(
      JSON.stringify({ scenes: [{ heading: '開張', content: '<p>灶火升起。</p>' }] })
    )
    expect(parsed.scenes).toHaveLength(1)
  })

  it('沒有內容的場次要退回，不要建成一場 0 秒的空戲', () => {
    const parsed = parseSceneList(
      JSON.stringify([
        { heading: '有內容', content: '<p>灶火升起。</p>' },
        { heading: '空的', content: '' },
        { heading: '沒這一欄' },
      ])
    )

    expect(parsed.scenes).toHaveLength(1)
    expect(parsed.rejected).toHaveLength(2)
    expect(parsed.rejected[0]).toContain('第 2 場')
  })

  it('整段不是 JSON 就回零場，而不是丟例外', () => {
    const parsed = parseSceneList('第一場：小灶房。許山河推開門。')
    expect(parsed.scenes).toHaveLength(0)
    expect(parsed.rejected[0]).toContain('讀不出 JSON')
  })

  it('場次代號由位置算，模型寫的 code 一律不理', () => {
    // 模型跳號、重號、從 0 開始都遇過；代號跟著位置走就不可能對不起來。
    expect(sceneCodeFor(1)).toBe('S01')
    expect(sceneCodeFor(12)).toBe('S12')

    const parsed = parseSceneList(
      JSON.stringify([{ code: 'S99', heading: '開張', content: '<p>灶火。</p>' }])
    )
    expect(parsed.scenes[0]).not.toHaveProperty('code')
  })

  it('describeScenes 對散文回 null，面板才知道要照舊顯示原文', () => {
    expect(describeScenes('這不是 JSON，是一段改編稿。')).toBeNull()
    expect(describeScenes(JSON.stringify([{ heading: 'A', content: '<p>一二三四五</p>' }])))
      .toContain('1 場')
  })
})

describe('applyTargetFor（兩個發動點共用的那張表）', () => {
  it('結構化任務有目標，分析類沒有', () => {
    expect(applyTargetFor('NOVEL_TO_SCRIPT')).toBe('episode_scenes')
    expect(applyTargetFor('STORYBOARD_GENERATE')).toBe('episode_shots')
    // 分析的產出是給人讀的意見，不該覆蓋任何東西。
    expect(applyTargetFor('SCRIPT_ANALYZE')).toBe('')
    expect(applyTargetFor('NOVEL_REVIEW')).toBe('')
  })

  it('批次跑得了、而採用時有地方可寫的任務，不可以回空字串', () => {
    /*
     * 這一條盯的是「兩個發動點分岔」。
     *
     * 批次本來寫死 `targetType: ''`，於是批次產生的改編與分鏡採用之後什麼都
     * 不會建——而從編輯器跑的同一個任務可以。這種差別只有真的跑一次才會發
     * 現，而批次正是那個「跑一次要十五集的錢」的地方。
     */
    for (const task of ['NOVEL_TO_SCRIPT', 'STORYBOARD_GENERATE'] as const) {
      expect(BATCH_TASKS).toContain(task)
      expect(applyTargetFor(task)).not.toBe('')
    }
  })
})

describe('json_object 模式回來的形狀', () => {
  /*
   * 這一組是審稿抓到最貴的一條：prompt 要「只回一個 JSON 陣列」，而
   * `STRUCTURED_TASKS` 會送 `response_format: json_object`，那個模式的契約
   * 就是最上層一定是物件。模型只好自己包一層，而原本的 `arrayIn` 只接受
   * 「唯一的那個陣列」——多一個 `notes: []` 就整份退回。
   *
   * 一整集改編的錢付了，東西拿不到，而畫面上只有一句「讀不出任何場次」。
   */
  const one = { heading: '開張', location: '小灶房', timeOfDay: '日', content: '<p>灶火升起。</p>' }

  it('{"scenes":[…],"notes":[…]} —— 兩個都非空時要認得 scenes 這個鍵', () => {
    /*
     * `notes` 故意放比 `scenes` 多的東西。
     *
     * 第一版這裡的 notes 是空陣列，於是「挑最長的物件陣列」那條後路就足夠
     * 了——把 `scenes` 捷徑拆掉測試還是綠的。要逼到那一條，雜訊陣列必須比
     * 正文長。
     */
    const parsed = parseSceneList(
      JSON.stringify({
        scenes: [one],
        notes: [{ msg: 'a' }, { msg: 'b' }, { msg: 'c' }],
      })
    )
    expect(parsed.scenes).toHaveLength(1)
    expect(parsed.scenes[0]!.heading).toBe('開張')
  })

  it('{"result":{"scenes":[…]}} —— 包兩層也要讀得出來', () => {
    const parsed = parseSceneList(JSON.stringify({ result: { scenes: [one] } }))
    expect(parsed.scenes).toHaveLength(1)
  })

  it('JSON 後面多寫一句話也要讀得出來', () => {
    // 換行用 fromCharCode 組，免得這一行的跳脫字元自己變成一個 bug。
    const nl = String.fromCharCode(10)
    const parsed = parseSceneList(
      '```json' + nl + JSON.stringify({ scenes: [one] }) + nl + '```' + nl + '以上是改編稿。'
    )
    expect(parsed.scenes).toHaveLength(1)
  })

  it('沒有 code fence、前後都是散文，也要挖得出來', () => {
    const parsed = parseSceneList(
      '以下是改編稿：' + JSON.stringify({ scenes: [one] }) + ' 以上，請確認。'
    )
    expect(parsed.scenes).toHaveLength(1)
  })

  it('有好幾個物件陣列時挑最長的那個，而不是整份退回', () => {
    const parsed = parseSceneList(
      JSON.stringify({ warnings: [{ msg: 'x' }], acts: [one, one, one] })
    )
    expect(parsed.scenes).toHaveLength(3)
  })
})

describe('aiApplySchema 的契約', () => {
  /*
   * 這一條在補一個**測試照不到的洞**，不是補程式。
   *
   * `acknowledge` 是必填的，而編輯器面板的「採用這份」從來沒送——所以它一直
   * 回 400，而分鏡的採用走同一支也一樣壞著。十五個測試全綠，因為它們直接呼
   * 叫 `applyScript`，一次都沒有經過那條路由。
   */
  it('少了 acknowledge 就不給過，而且錯誤訊息講得出原因', async () => {
    const { aiApplySchema } = await import('@/lib/validators')
    const body = aiApplySchema.omit({ jobId: true })

    const without = body.safeParse({ candidateIndex: 0 })
    expect(without.success).toBe(false)
    expect(JSON.stringify(without.error)).toContain('必須確認')

    expect(body.safeParse({ candidateIndex: 0, acknowledge: true }).success).toBe(true)
  })
})

const hasDb = testDatabaseReady()

let applyScript: typeof import('@/lib/script-apply').applyScript

let projectId: string
let episodeId: string
let scriptDocId: string
let novelDocId: string
let userId: string
const createdJobIds: string[] = []
const suffix = Math.random().toString(36).slice(2, 8)

/** 排在最後面的集號，免得撞到 seed 的集數。 */
let episodeNumber = 0

async function seedJob(content: string): Promise<string> {
  const { db } = await import('@/db')
  const schema = await import('@/db/schema')

  const [job] = await db
    .insert(schema.aiJobs)
    .values({
      projectId,
      episodeId,
      kind: 'NOVEL_TO_SCRIPT',
      status: 'AWAITING_REVIEW',
      targetType: 'episode_scenes',
      requestedById: userId,
      // `request` 是 notNull 又沒有預設值，少了它 insert 會爆。
      request: { task: 'NOVEL_TO_SCRIPT' },
      result: { candidates: [{ label: '候選 1', content }] },
    })
    .returning({ id: schema.aiJobs.id })

  if (!job) throw new Error('Failed to seed the AI job')
  createdJobIds.push(job.id)
  return job.id
}

async function liveScenes() {
  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { asc, eq } = await import('drizzle-orm')

  return db
    .select()
    .from(schema.scenes)
    .where(eq(schema.scenes.documentId, scriptDocId))
    .orderBy(asc(schema.scenes.sortOrder))
}

beforeAll(async () => {
  if (!hasDb) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { desc, eq } = await import('drizzle-orm')
  ;({ applyScript } = await import('@/lib/script-apply'))

  const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1)
  if (!project) throw new Error('Run `npm run db:seed` first')
  projectId = project.id

  const [user] = await db.select({ id: schema.users.id }).from(schema.users).limit(1)
  if (!user) throw new Error('Run `npm run db:seed` first')
  userId = user.id

  const [highest] = await db
    .select({ number: schema.episodes.number })
    .from(schema.episodes)
    .orderBy(desc(schema.episodes.number))
    .limit(1)
  episodeNumber = (highest?.number ?? 0) + 1

  // `episodes.arc_id` 是 notNull——一集一定屬於某一卷。
  const [arc] = await db
    .select({ id: schema.arcs.id })
    .from(schema.arcs)
    .where(eq(schema.arcs.projectId, projectId))
    .limit(1)
  if (!arc) throw new Error('Run `npm run db:seed` first')

  const [episode] = await db
    .insert(schema.episodes)
    .values({ projectId, arcId: arc.id, number: episodeNumber, title: `改編測試-${suffix}` })
    .returning({ id: schema.episodes.id })
  if (!episode) throw new Error('Failed to create the test episode')
  episodeId = episode.id

  // 兩份文件都建：這一支要證明寫入只碰 SCRIPT 那一份。
  const [script] = await db
    .insert(schema.documents)
    .values({ episodeId, kind: 'SCRIPT' })
    .returning({ id: schema.documents.id })
  const [novel] = await db
    .insert(schema.documents)
    .values({ episodeId, kind: 'NOVEL' })
    .returning({ id: schema.documents.id })
  if (!script || !novel) throw new Error('Failed to create the test documents')
  scriptDocId = script.id
  novelDocId = novel.id
})

afterAll(async () => {
  if (!hasDb || !episodeId) return

  const { db } = await import('@/db')
  const schema = await import('@/db/schema')
  const { eq, inArray } = await import('drizzle-orm')

  if (createdJobIds.length > 0) {
    await db.delete(schema.aiJobs).where(inArray(schema.aiJobs.id, createdJobIds))
  }
  // versions 不是 cascade 的（targetId 沒有外鍵），所以自己清。
  await db
    .delete(schema.versions)
    .where(inArray(schema.versions.targetId, [scriptDocId, novelDocId]))
  // documents 與 scenes 都 cascade 自 episodes。
  await db.delete(schema.episodes).where(eq(schema.episodes.id, episodeId))
})

describe.runIf(hasDb)('applyScript（寫入）', () => {
  it('寫成場次，代號照位置排，片長由伺服器算', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    const { estimateSceneSeconds } = await import('@/lib/writing')

    const content = JSON.stringify([
      { heading: '開張', location: '小灶房', timeOfDay: '日', content: '<p>灶火升起，許山河忙碌。</p>' },
      {
        heading: '初遇',
        location: '小灶房',
        timeOfDay: '日',
        // 模型自己給一個秒數——應該被忽略。
        estimatedSec: 999,
        content: '<p>客人入座。</p><p>客人「這味道，倒有幾分當年的影子。」</p>',
      },
    ])

    const jobId = await seedJob(content)
    const applied = await applyScript({
      jobId,
      user: { id: userId, name: '測試' } as never,
    })

    expect(applied.created).toBe(2)
    expect(applied.replaced).toBe(0)
    // 第一次改編沒有舊場次可存，所以不該留下一個空版本。
    expect(applied.versionId).toBeNull()

    const rows = await liveScenes()
    expect(rows.map((row) => row.code)).toEqual(['S01', 'S02'])
    expect(rows[1]!.location).toBe('小灶房')

    // 模型寫的 999 不算數，算式算出來的才算。
    expect(rows[1]!.estimatedSec).toBe(estimateSceneSeconds(rows[1]!.content))
    expect(rows[1]!.estimatedSec).not.toBe(999)
    expect(applied.totalSeconds).toBe(rows.reduce((n, row) => n + row.estimatedSec, 0))

    // 任務要被標成已套用，不然它會留在待確認裡讓人再按一次。
    const [job] = await db.select().from(schema.aiJobs).where(eq(schema.aiJobs.id, jobId)).limit(1)
    expect(job!.status).toBe('SUCCEEDED')
    expect(job!.appliedAt).not.toBeNull()
  })

  it('第二次改編要先把舊場次存成版本，再取代', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const before = await liveScenes()
    expect(before.length).toBeGreaterThan(0)

    const jobId = await seedJob(
      JSON.stringify([{ heading: '重寫過的', content: '<p>完全不一樣的一場。</p>' }])
    )
    const applied = await applyScript({
      jobId,
      user: { id: userId, name: '測試' } as never,
    })

    expect(applied.created).toBe(1)
    expect(applied.replaced).toBe(before.length)
    expect(applied.versionId).not.toBeNull()

    // 取代，不是接在後面——不然場號會從 S01 跳到 S03 而片長加倍。
    const after = await liveScenes()
    expect(after).toHaveLength(1)
    expect(after[0]!.code).toBe('S01')

    const [version] = await db
      .select()
      .from(schema.versions)
      .where(eq(schema.versions.id, applied.versionId!))
      .limit(1)

    const snapshot = version!.snapshot as { scenes?: { heading: string }[] }
    expect(snapshot.scenes).toHaveLength(before.length)
    expect(snapshot.scenes![0]!.heading).toBe(before[0]!.heading)
    // 哪一個任務寫的，版本紀錄上要追得到。
    expect(version!.aiJobId).toBe(jobId)
  })

  it('套用的是選到的那一份候選，不是永遠第 0 份', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')

    const [job] = await db
      .insert(schema.aiJobs)
      .values({
        projectId,
        episodeId,
        kind: 'NOVEL_TO_SCRIPT',
        status: 'AWAITING_REVIEW',
        targetType: 'episode_scenes',
        requestedById: userId,
        request: { task: 'NOVEL_TO_SCRIPT' },
        result: {
          candidates: [
            { label: 'A', content: JSON.stringify([{ heading: '甲', content: '<p>甲。</p>' }]) },
            {
              label: 'B',
              content: JSON.stringify([
                { heading: '乙一', content: '<p>乙一。</p>' },
                { heading: '乙二', content: '<p>乙二。</p>' },
              ]),
            },
          ],
        },
      })
      .returning({ id: schema.aiJobs.id })
    createdJobIds.push(job!.id)

    await applyScript({
      jobId: job!.id,
      user: { id: userId, name: '測試' } as never,
      candidateIndex: 1,
    })

    const rows = await liveScenes()
    expect(rows.map((row) => row.heading)).toEqual(['乙一', '乙二'])
  })

  it('讀不出來的那幾筆要回報，不要安靜地少寫', async () => {
    const jobId = await seedJob(
      JSON.stringify([
        { heading: '有內容', content: '<p>一場戲。</p>' },
        { heading: '空的', content: '' },
      ])
    )
    const applied = await applyScript({
      jobId,
      user: { id: userId, name: '測試' } as never,
    })

    expect(applied.created).toBe(1)
    expect(applied.rejected).toHaveLength(1)
  })

  it('讀不出場次就丟錯，而且一個字都沒改', async () => {
    const before = await liveScenes()

    const jobId = await seedJob('模型這次回了一段散文，沒有照格式。')
    await expect(
      applyScript({ jobId, user: { id: userId, name: '測試' } as never })
    ).rejects.toThrow(/讀不出任何場次/)

    // 這一條是整支測試裡最重要的：先清空再發現讀不出來，等於按一次採用就把
    // 整份劇本刪了。
    const after = await liveScenes()
    expect(after).toEqual(before)
  })

  it('寫的是 SCRIPT 那一份，NOVEL 那一份一列都不該有', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const novelScenes = await db
      .select()
      .from(schema.scenes)
      .where(eq(schema.scenes.documentId, novelDocId))

    expect(novelScenes).toHaveLength(0)
  })

  /*
   * 上面那一條自己證明不了 `kind` 有被篩。
   *
   * 兩份文件都存在的時候，沒有 ORDER BY 的 `limit(1)` 回哪一列是未定義的——
   * 剛好先回 SCRIPT 的話，就算把 `kind` 條件拆掉它也會綠。
   *
   * 這一條是確定的：一集**只有** NOVEL，那麼「找不到劇本文件」是唯一正確的
   * 答案。少了 `kind` 條件，它會把場次寫進小說那一份。
   */
  it('只有小說、沒有劇本的那一集，要說找不到劇本文件，而不是寫進小說', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const [arc] = await db
      .select({ id: schema.arcs.id })
      .from(schema.arcs)
      .where(eq(schema.arcs.projectId, projectId))
      .limit(1)

    const [lonely] = await db
      .insert(schema.episodes)
      .values({
        projectId,
        arcId: arc!.id,
        number: episodeNumber + 1,
        title: `只有小說-${suffix}`,
      })
      .returning({ id: schema.episodes.id })

    const [novelOnly] = await db
      .insert(schema.documents)
      .values({ episodeId: lonely!.id, kind: 'NOVEL' })
      .returning({ id: schema.documents.id })

    try {
      const [job] = await db
        .insert(schema.aiJobs)
        .values({
          projectId,
          episodeId: lonely!.id,
          kind: 'NOVEL_TO_SCRIPT',
          status: 'AWAITING_REVIEW',
          targetType: 'episode_scenes',
          requestedById: userId,
          request: { task: 'NOVEL_TO_SCRIPT' },
          result: {
            candidates: [
              { label: '候選 1', content: JSON.stringify([{ heading: 'A', content: '<p>一</p>' }]) },
            ],
          },
        })
        .returning({ id: schema.aiJobs.id })
      createdJobIds.push(job!.id)

      await expect(
        applyScript({ jobId: job!.id, user: { id: userId, name: '測試' } as never })
      ).rejects.toThrow(/還沒有劇本文件/)

      const wrote = await db
        .select()
        .from(schema.scenes)
        .where(eq(schema.scenes.documentId, novelOnly!.id))
      expect(wrote).toHaveLength(0)
    } finally {
      await db.delete(schema.episodes).where(eq(schema.episodes.id, lonely!.id))
    }
  })

  it('lockRevision 要跳，不然開著舊場次的編輯器會覆蓋回去', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const [before] = await db
      .select({ lockRevision: schema.documents.lockRevision })
      .from(schema.documents)
      .where(eq(schema.documents.id, scriptDocId))
      .limit(1)

    const jobId = await seedJob(
      JSON.stringify([{ heading: '再一次', content: '<p>又改了一版。</p>' }])
    )
    await applyScript({ jobId, user: { id: userId, name: '測試' } as never })

    const [after] = await db
      .select({ lockRevision: schema.documents.lockRevision })
      .from(schema.documents)
      .where(eq(schema.documents.id, scriptDocId))
      .limit(1)

    expect(after!.lockRevision).toBeGreaterThan(before!.lockRevision)
  })

  /*
   * 定稿鎖要擋住**這一條**路 (Z41).
   *
   * `applyToDocument` 擋了，而這是 AI 產出寫進劇本的另一條。只擋一條等於沒
   * 擋，而且覆蓋還會留下一個版本快照，看起來完全正常。
   *
   * 鎖的依據是 `approval_records` 最新那一列的 `locks`，不是
   * `documents.approvedVersionId`——那一欄記的是「哪一版被核准」，跟「現在
   * 鎖不鎖」是兩件事。
   */
  it('定稿鎖住的劇本不給 AI 覆蓋', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')

    const [approval] = await db
      .insert(schema.approvalRecords)
      .values({
        projectId,
        targetType: 'DOCUMENT',
        targetId: scriptDocId,
        state: 'APPROVED',
        locks: true,
        requestedById: userId,
        decidedById: userId,
        decidedAt: new Date(),
      })
      .returning({ id: schema.approvalRecords.id })

    try {
      const before = await liveScenes()
      const jobId = await seedJob(
        JSON.stringify([{ heading: '想偷寫', content: '<p>不該寫進去。</p>' }])
      )

      await expect(
        applyScript({ jobId, user: { id: userId, name: '測試' } as never })
      ).rejects.toThrow(/定稿/)

      expect(await liveScenes()).toEqual(before)
    } finally {
      await db
        .delete(schema.approvalRecords)
        .where(eq(schema.approvalRecords.id, approval!.id))
    }
  })
})
