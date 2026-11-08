import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  episodeLabel,
  voiceReadiness,
  type VoiceAttribution,
  type VoiceAudio,
  type VoiceEpisodeInput,
} from '@/lib/voice-readiness'
import { testDatabaseReady } from './helpers/database'

/**
 * 跨集的對白歸屬與配音狀態（Z147）。
 *
 * `scripts/probe-voice-readiness.mjs` 量的是「頁面有沒有把這兩支函式的結果正
 * 確畫出來」，所以它抓不到這兩支函式**自己**算錯。而它們算的是會被拿去做決定
 * 的數字——「這一集判過沒有」決定要不要再花一次錢，「有沒有聲音」決定要不要
 * 重新合成。
 *
 * 特別要測的是**旁白列**。schema 寫著：`character_id` 是 null 且 `spoken_as`
 * 是空字串＝「這一段確定沒有人在說話」，而**沒有那一列**才是「還沒判斷過」。
 * 今天這部作品一列旁白都沒有（套用時只寫有說話人的段落），所以兩個數字剛好
 * 一樣——而「剛好一樣」正是這種區別會悄悄壞掉的條件。
 */
const hasDb = testDatabaseReady()

describe.skipIf(!hasDb)('attributionStatus 與 audiobooksByEpisode（Z147）', () => {
  let attributionStatus: typeof import('@/lib/attribution-job').attributionStatus
  let audiobooksByEpisode: typeof import('@/lib/assets').audiobooksByEpisode

  let projectId = ''
  let judgedEpisodeId = ''
  let silentEpisodeId = ''

  beforeAll(async () => {
    if (!hasDb) return
    ;({ attributionStatus } = await import('@/lib/attribution-job'))
    ;({ audiobooksByEpisode } = await import('@/lib/assets'))

    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const stamp = Date.now()

    const [project] = await db
      .insert(schema.projects)
      .values({ title: 'Z147 測試', slug: `z147-${stamp}` })
      .returning({ id: schema.projects.id })
    projectId = project!.id

    const [arc] = await db
      .insert(schema.arcs)
      .values({ projectId, index: 1, title: 'Z147 卷一' })
      .returning({ id: schema.arcs.id })

    const made = await db
      .insert(schema.episodes)
      .values([
        { projectId, arcId: arc!.id, number: 1, title: '判過的' },
        { projectId, arcId: arc!.id, number: 2, title: '沒判過的' },
      ])
      .returning({ id: schema.episodes.id })

    judgedEpisodeId = made[0]!.id
    silentEpisodeId = made[1]!.id

    await db.insert(schema.episodeLineSpeakers).values([
      // 有人說話的五句，兩個說話人，其中兩句是人工改的。
      { episodeId: judgedEpisodeId, paragraphIndex: 1, spokenAs: '沈知味', gender: '女' },
      { episodeId: judgedEpisodeId, paragraphIndex: 3, spokenAs: '沈知味', gender: '女' },
      { episodeId: judgedEpisodeId, paragraphIndex: 5, spokenAs: '沈知味', gender: '女' },
      {
        episodeId: judgedEpisodeId,
        paragraphIndex: 7,
        spokenAs: '錢管事',
        gender: '男',
        source: 'manual',
      },
      {
        episodeId: judgedEpisodeId,
        paragraphIndex: 9,
        spokenAs: '錢管事',
        gender: '男',
        source: 'manual',
      },
      // 旁白兩段：判斷過了，而答案是「沒有人在說話」。
      { episodeId: judgedEpisodeId, paragraphIndex: 2, spokenAs: '' },
      { episodeId: judgedEpisodeId, paragraphIndex: 4, spokenAs: '' },
    ])

    // 同一集做過兩次有聲書（換了音色重做），外加一個不該被算進來的對照組。
    await db.insert(schema.assets).values([
      {
        projectId,
        episodeId: judgedEpisodeId,
        kind: 'VOICE',
        name: 'old.mp3',
        title: '舊的那一版',
        objectKey: `z147/${stamp}/old.mp3`,
        mimeType: 'audio/mpeg',
        sizeBytes: 100,
        durationSec: 111,
        generationMeta: { source: 'NOVEL_TO_AUDIO', kind: 'AUDIOBOOK' },
        uploadStatus: 'COMPLETED',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        projectId,
        episodeId: judgedEpisodeId,
        kind: 'VOICE',
        name: 'new.mp3',
        title: '新的那一版',
        objectKey: `z147/${stamp}/new.mp3`,
        mimeType: 'audio/mpeg',
        sizeBytes: 200,
        durationSec: 222,
        generationMeta: { source: 'NOVEL_TO_AUDIO', kind: 'AUDIOBOOK' },
        uploadStatus: 'COMPLETED',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      },
      {
        projectId,
        episodeId: silentEpisodeId,
        kind: 'VOICE',
        name: 'half.mp3',
        title: '還沒傳完的',
        objectKey: `z147/${stamp}/half.mp3`,
        mimeType: 'audio/mpeg',
        sizeBytes: 300,
        uploadStatus: 'PENDING',
      },
      /*
       * 集數素材頁手傳的一段參考音：kind、origin、episodeId 全部跟有聲書一
       * 樣，而且**比真的那一份新**。少了 `generation_meta` 這道，它會把成品
       * 頂掉——閱讀器顯示三秒、下載鍵指向它。
       */
      {
        projectId,
        episodeId: judgedEpisodeId,
        kind: 'VOICE',
        name: 'ref.mp3',
        title: '手傳的參考音',
        objectKey: `z147/${stamp}/ref.mp3`,
        mimeType: 'audio/mpeg',
        sizeBytes: 50,
        durationSec: 3,
        uploadStatus: 'COMPLETED',
        createdAt: new Date('2026-03-01T00:00:00Z'),
      },
      {
        projectId,
        episodeId: silentEpisodeId,
        kind: 'VOICE',
        origin: 'CHAT',
        name: 'chat.mp3',
        title: '聊天室的語音訊息',
        objectKey: `z147/${stamp}/chat.mp3`,
        mimeType: 'audio/mpeg',
        sizeBytes: 400,
        durationSec: 9,
        uploadStatus: 'COMPLETED',
      },
    ])
  })

  afterAll(async () => {
    if (!hasDb || !projectId) return
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq } = await import('drizzle-orm')
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId))
  })

  it('fixture 真的建起來了', () => {
    expect(projectId).not.toBe('')
    expect(judgedEpisodeId).not.toBe('')
    expect(silentEpisodeId).not.toBe('')
  })

  it('判過的段數與真的有人說話的句數是兩個數字', async () => {
    const status = await attributionStatus([judgedEpisodeId, silentEpisodeId])
    const judged = status.get(judgedEpisodeId)

    expect(judged?.judged).toBe(7)
    // 旁白那兩段判斷過了，但沒有人在說話。
    expect(judged?.spoken).toBe(5)
  })

  it('說話人去重，而旁白不算一個人', async () => {
    const status = await attributionStatus([judgedEpisodeId])
    /*
     * 旁白列的 `coalesce(character_id, spoken_as)` 會折成空字串。少了排除那一
     * 步，這裡會是 3——而「三個說話人」看起來完全合理，沒有人會去數。
     */
    expect(status.get(judgedEpisodeId)?.speakers).toBe(2)
  })

  it('人工改過的句數分開數', async () => {
    const status = await attributionStatus([judgedEpisodeId])
    expect(status.get(judgedEpisodeId)?.manual).toBe(2)
  })

  it('沒判過的集數不在回傳裡——那跟「判了零句」不一樣', async () => {
    const status = await attributionStatus([judgedEpisodeId, silentEpisodeId])
    expect(status.has(silentEpisodeId)).toBe(false)
  })

  it('空清單不會去查資料庫', async () => {
    expect((await attributionStatus([])).size).toBe(0)
  })

  it('一集取最新的那一份有聲書', async () => {
    const audio = await audiobooksByEpisode(projectId)
    expect(audio.get(judgedEpisodeId)?.title).toBe('新的那一版')
    expect(audio.get(judgedEpisodeId)?.durationSec).toBe(222)
  })

  it('集數素材頁手傳的語音不會把有聲書頂掉', async () => {
    /*
     * 這一筆的 kind、origin、episodeId 全部跟有聲書一樣，而且比它新。靠那三
     * 個條件判斷的話，這一集的「有聲書」會變成三秒。
     */
    const audio = await audiobooksByEpisode(projectId)
    expect(audio.get(judgedEpisodeId)?.title).not.toBe('手傳的參考音')
    expect(audio.get(judgedEpisodeId)?.durationSec).toBe(222)
  })

  it('沒傳完的、以及聊天室的語音訊息，都不算有聲音', async () => {
    /*
     * PENDING 的素材在 R2 裡可能根本沒有位元組，連結點下去是壞的。
     *
     * 聊天室的語音訊息也是 `kind = 'VOICE'`（Z116）。今天它們進不來是因為
     * `ChatRoom` 的上傳沒帶 `episodeId`——那是一個呼叫端的習慣，不是查詢的保
     * 證。這一條把它變成查詢的保證：這一集有一段九秒的聊天語音，而它不該讓
     * 這一集看起來「有聲書」。
     */
    const audio = await audiobooksByEpisode(projectId)
    expect(audio.has(silentEpisodeId)).toBe(false)
  })

  it('整個查詢綁在這個作品上', async () => {
    // 少了 `eq(assets.projectId, …)`，別的作品的有聲書會出現在這裡。
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const [other] = await db
      .insert(schema.projects)
      .values({ title: 'Z147 隔壁棚', slug: `z147-other-${Date.now()}` })
      .returning({ id: schema.projects.id })

    expect((await audiobooksByEpisode(other!.id)).size).toBe(0)

    const { eq } = await import('drizzle-orm')
    await db.delete(schema.projects).where(eq(schema.projects.id, other!.id))
  })

  it('軟刪除的也不算', async () => {
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { and, eq } = await import('drizzle-orm')

    await db
      .update(schema.assets)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(schema.assets.projectId, projectId), eq(schema.assets.title, '新的那一版'))
      )

    const audio = await audiobooksByEpisode(projectId)
    // 刪掉最新的那一份，就該退回舊的那一份，而不是整集變成沒聲音。
    expect(audio.get(judgedEpisodeId)?.title).toBe('舊的那一版')

    await db
      .update(schema.assets)
      .set({ deletedAt: null })
      .where(
        and(eq(schema.assets.projectId, projectId), eq(schema.assets.title, '新的那一版'))
      )
  })
})

/* -------------------------------------------------------------------------- */

/**
 * 總覽那一區的判斷，純算的部分（Z147，子代理審出來的兩條）。
 *
 * 這一組**不碰資料庫**，所以它在任何機器上都會跑。而它守的兩條，是這一區會
 * 「畫出與事實相反的話」的兩個地方。
 */
describe('voiceReadiness', () => {
  const at = (iso: string) => new Date(iso)
  const make = (
    over: Partial<VoiceEpisodeInput> & { number: number }
  ): VoiceEpisodeInput => ({
    episodeId: `ep-${over.number}`,
    title: `第 ${over.number} 集`,
    attribution: null,
    audio: null,
    ...over,
  })
  const attribution = (over: Partial<VoiceAttribution>): VoiceAttribution => ({
    judged: 0,
    spoken: 0,
    speakers: 0,
    manual: 0,
    lastAt: null,
    ...over,
  })
  const audio = (createdAt: string): VoiceAudio => ({
    assetId: 'a1',
    durationSec: 900,
    createdAt: at(createdAt),
  })

  it('判過但整集都是旁白，算「判過」', () => {
    /*
     * schema：`character_id` 是 null 且 `spoken_as` 空＝「判過了，答案是沒人
     * 說話」，**沒有那一列**才是沒判過。第一版一律用 `spoken > 0` 當「判過」
     * 的代理，於是純敘事的一集會被說成「沒判過」——跟事實相反，而且會害人再
     * 花一次錢重判。
     */
    const [row] = voiceReadiness([
      make({ number: 1, attribution: attribution({ judged: 40, spoken: 0 }) }),
    ]).started

    expect(row?.judged).toBe(true)
    expect(row?.hasSpeakers).toBe(false)
  })

  it('沒有那幾列才是沒判過', () => {
    const summary = voiceReadiness([make({ number: 1 })])
    expect(summary.judgedCount).toBe(0)
    expect(summary.started).toHaveLength(0)
    expect(summary.untouched).toBe(1)
  })

  it('判過的集數用 judged 數，不是用 spoken', () => {
    const summary = voiceReadiness([
      make({ number: 1, attribution: attribution({ judged: 40, spoken: 0 }) }),
      make({ number: 2, attribution: attribution({ judged: 73, spoken: 73, speakers: 10 }) }),
      make({ number: 3 }),
    ])

    expect(summary.judgedCount).toBe(2)
    expect(summary.untouched).toBe(1)
  })

  it('先合成、後判斷的那一集仍然要被標出來', () => {
    /*
     * 決定音檔內容的是**合成那一刻**的歸屬（`audiobook/route.ts` 是跑的時候才
     * 去查）。所以「先合成（整集旁白）→ 再跑歸屬」走完之後，`spoken > 0` 成
     * 立、警示消失、列上顯示「判過 73 段 · 10 人」加一個時長，看起來完全就緒
     * ——而那個 mp3 裡還是只有一個人在唸。
     */
    const summary = voiceReadiness([
      make({
        number: 1,
        attribution: attribution({
          judged: 73,
          spoken: 73,
          speakers: 10,
          lastAt: at('2026-03-01T00:00:00Z'),
        }),
        audio: audio('2026-02-01T00:00:00Z'),
      }),
    ])

    expect(summary.stale).toHaveLength(1)
    expect(summary.stale[0]?.freshness).toBe('outdated')
  })

  it('歸屬在前、合成在後，就不算舊', () => {
    // 沒有這一條，上面那條用「一律標舊」也會綠。
    const summary = voiceReadiness([
      make({
        number: 1,
        attribution: attribution({
          judged: 73,
          spoken: 73,
          speakers: 10,
          lastAt: at('2026-02-01T00:00:00Z'),
        }),
        audio: audio('2026-03-01T00:00:00Z'),
      }),
    ])

    expect(summary.stale).toHaveLength(0)
    expect(summary.started[0]?.freshness).toBe('ok')
  })

  it('有音檔但沒有任何說話人，兩種成因都歸 no-speakers', () => {
    const summary = voiceReadiness([
      // 沒判過
      make({ number: 1, audio: audio('2026-02-01T00:00:00Z') }),
      // 判過，而答案是整集旁白
      make({
        number: 2,
        attribution: attribution({ judged: 40, spoken: 0, lastAt: at('2026-01-01T00:00:00Z') }),
        audio: audio('2026-02-01T00:00:00Z'),
      }),
    ])

    expect(summary.stale.map((row) => row.freshness)).toEqual(['no-speakers', 'no-speakers'])
    // 成因一樣，但下一步的說法不一樣——所以 `judged` 要分得出來。
    expect(summary.stale.map((row) => row.judged)).toEqual([false, true])
  })

  it('沒有音檔就沒有「舊」這回事', () => {
    const summary = voiceReadiness([
      make({
        number: 1,
        attribution: attribution({ judged: 10, spoken: 10, speakers: 2, lastAt: at('2026-05-01T00:00:00Z') }),
      }),
    ])
    expect(summary.stale).toHaveLength(0)
  })

  it('沒有 lastAt 的舊資料不會被誤判成舊', () => {
    // `lastAt` 是後來才加的欄位；拿 null 去比會讓每一集都變成「舊」。
    const summary = voiceReadiness([
      make({
        number: 1,
        attribution: attribution({ judged: 10, spoken: 10, speakers: 2, lastAt: null }),
        audio: audio('2026-02-01T00:00:00Z'),
      }),
    ])
    expect(summary.stale).toHaveLength(0)
  })

  it('列出來的照集號排，而且 untouched 不會變負數', () => {
    const summary = voiceReadiness([
      make({ number: 9, audio: audio('2026-02-01T00:00:00Z') }),
      make({ number: 2, attribution: attribution({ judged: 5, spoken: 5, speakers: 1 }) }),
      make({ number: 5 }),
    ])

    expect(summary.started.map((row) => row.number)).toEqual([2, 9])
    expect(summary.untouched).toBe(1)
    expect(summary.written).toBe(3)
  })

  it('空的就是空的', () => {
    const summary = voiceReadiness([])
    expect(summary).toMatchObject({
      written: 0,
      judgedCount: 0,
      voicedCount: 0,
      untouched: 0,
    })
    expect(summary.started).toEqual([])
    expect(summary.stale).toEqual([])
  })

  it('集號補到三位數', () => {
    expect(episodeLabel(7)).toBe('EP007')
    expect(episodeLabel(120)).toBe('EP120')
  })
})
