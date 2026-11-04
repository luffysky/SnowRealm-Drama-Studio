import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 一集小說 → 可以送去合成的 SSML（Z129）。
 *
 * 合成是最容易「看起來做完了其實錯了」的一步：唸錯角色、語氣跑掉、某一段
 * 漏掉，都要聽完三十分鐘才會發現。所以能在送出之前算清楚的，全部在這裡算。
 *
 * 盯三件事：**一個字都不能掉**、**批次不能超過單次上限**、**配音要跟閱讀器
 * 用的是同一份切段與分配**。
 */

const ready = testDatabaseReady()

/**
 * A stand-in for Azure's voice list, so the test needs no network.
 *
 * Genders are the real ones Azure reports for the zh-TW voices, because the
 * gendered pools only engage when the list carries them — a fixture without
 * genders would quietly test the browser path instead.
 */
const VOICES = [
  { id: 'zh-TW-HsiaoChenNeural', lang: 'zh-TW', gender: 'Female' },
  { id: 'zh-TW-YunJheNeural', lang: 'zh-TW', gender: 'Male' },
  { id: 'zh-TW-HsiaoYuNeural', lang: 'zh-TW', gender: 'Female' },
]

const NARRATOR = 'zh-TW-HsiaoChenNeural'

/** Paragraph separator, spelled without an escape — see the note in beforeAll. */
const BREAK = String.fromCharCode(10, 10)

describe.skipIf(!ready)('有聲小說的 SSML 規劃', () => {
  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let audiobook: typeof import('@/lib/tts/audiobook')
  let limits: typeof import('@/lib/tts/ssml').TTS_LIMITS

  let projectId = ''
  let episodeId = ''
  let documentId = ''

  /**
   * 測試自己建正文。
   *
   * 測試庫裡的 120 集是空殼（`db:seed` 不寫正文，真正的稿子只在 Neon），而且
   * `chapter-placement.test.ts` 還會留下幾個空章節。第一版靠「找一集剛好有字
   * 的」當前置條件，結果整組被 skip 掉還報綠燈——跟 `arcs.test.ts` 那次是同一
   * 種病。所以這裡自己建、自己清。
   *
   * 內容是為測試寫的假稿，刻意包含對白與旁白各幾段，因為分角色配音只有在
   * 兩種都有的時候才測得出來。
   */
  const CAST = ['測試甲', '測試乙']

  const FIXTURE = [
    [
      '灶上的火光跳了一下。',
      '測試甲把最後三文錢擱在案板上，看著它們。',
      '測試甲說：「這能買什麼？」',
      '沒有人回答。',
      '測試乙站在門口，沒有進來。',
      '測試乙說：「買一鍋雞皮，夠了。」',
      '測試甲抬頭看他，眼裡沒有笑意。',
    ].join(BREAK),
    [
      '油下鍋的時候，整條巷子都安靜了。',
      '那不是香味該有的安靜。',
      '測試乙說：「你這樣會燒起來。」',
      '測試甲說：「我知道。」',
    ].join(BREAK),
  ]

  beforeAll(async () => {
    db = (await import('@/db')).db
    schema = await import('@/db/schema')
    audiobook = await import('@/lib/tts/audiobook')
    limits = (await import('@/lib/tts/ssml')).TTS_LIMITS

    const { and, asc, eq, isNull } = await import('drizzle-orm')

    const [row] = await db
      .select({ projectId: schema.episodes.projectId, id: schema.episodes.id })
      .from(schema.episodes)
      .where(isNull(schema.episodes.deletedAt))
      .orderBy(asc(schema.episodes.number))
      .limit(1)

    if (!row) throw new Error('先跑 npm run db:seed')
    projectId = row.projectId
    episodeId = row.id

    // Start from a clean document, whatever other tests left behind.
    await db
      .delete(schema.documents)
      .where(and(eq(schema.documents.episodeId, episodeId), eq(schema.documents.kind, 'NOVEL')))

    const [doc] = await db
      .insert(schema.documents)
      .values({ episodeId, kind: 'NOVEL' })
      .returning({ id: schema.documents.id })

    documentId = doc!.id

    /*
     * 角色也要自己建.
     *
     * `castChunks` 對空的 cast 是**刻意**原封不動還回來的（narration 那邊有
     * 測試在守），所以測試庫沒有角色時連語氣都不會套——那會讓「分角色配音」
     * 這件事根本沒被測到。正文裡也必須點到名，否則 `speakerOf` 歸屬不了。
     */
    await db.insert(schema.characters).values(
      CAST.map((name, index) => ({
        projectId,
        name,
        tier: 'LEAD' as const,
        gender: index === 0 ? '女' : '男',
      }))
    )

    await db.insert(schema.chapters).values(
      FIXTURE.map((content, index) => ({
        documentId,
        sortOrder: index + 1,
        title: `測試章 ${index + 1}`,
        content: content
          .split(BREAK)
          .map((line) => `<p>${line}</p>`)
          .join(''),
        charCount: [...content].filter((char) => char.trim()).length,
      }))
    )
  })

  afterAll(async () => {
    const { eq, inArray } = await import('drizzle-orm')

    await db.delete(schema.characters).where(inArray(schema.characters.name, CAST))

    if (documentId) {
      await db.delete(schema.chapters).where(eq(schema.chapters.documentId, documentId))
      await db.delete(schema.documents).where(eq(schema.documents.id, documentId))
    }
    const { closeDb } = await import('@/db')
    await closeDb()
  })

  async function plan() {
    return audiobook.planEpisodeAudio({
      projectId,
      episodeId,
      voices: VOICES,
      narratorVoice: NARRATOR,
    })
  }

  it('一個字都不會掉', async () => {
    const result = await plan()

    const fromBatches = result.batches
      .flatMap((batch) => batch.chunks)
      .map((chunk) => chunk.text.trim())
      .join('')

    expect(fromBatches.length).toBe(result.billableChars)
    expect(result.billableChars).toBeGreaterThan(100)
  })

  it('兩個章節都在裡面，不是只有第一章', async () => {
    const result = await plan()
    expect(result.chapters).toHaveLength(2)

    const everything = result.batches
      .flatMap((batch) => batch.chunks)
      .map((chunk) => chunk.text)
      .join('')

    expect(everything).toContain('灶上的火光')
    expect(everything).toContain('整條巷子都安靜了')
  })

  it('每一批都在 Azure 單次請求的上限內', async () => {
    const result = await plan()

    expect(result.batches.length).toBeGreaterThan(0)
    for (const batch of result.batches) {
      expect(batch.chars).toBeLessThanOrEqual(limits.MAX_CHARS_PER_REQUEST)
      expect(batch.estimatedSec).toBeLessThanOrEqual(limits.MAX_SECONDS_PER_REQUEST + 1)
    }
  })

  it('每一批都產生一份結構完整的 SSML', async () => {
    const result = await plan()

    expect(result.ssml).toHaveLength(result.batches.length)
    for (const xml of result.ssml) {
      expect(xml.startsWith('<speak')).toBe(true)
      expect(xml.endsWith('</speak>')).toBe(true)
      expect((xml.match(/<voice /g) ?? []).length).toBe((xml.match(/<\/voice>/g) ?? []).length)
      expect((xml.match(/<prosody /g) ?? []).length).toBe(
        (xml.match(/<\/prosody>/g) ?? []).length
      )
      // Nothing unescaped slipped into a text node.
      expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/)
    }
  })

  it('只用提供的音色，沒有別的冒出來', async () => {
    const result = await plan()
    const allowed = new Set([NARRATOR, ...VOICES.map((v) => v.id)])

    for (const xml of result.ssml) {
      for (const match of xml.matchAll(/<voice name="([^"]+)"/g)) {
        expect(allowed.has(match[1]!)).toBe(true)
      }
    }
  })

  it('對白聽起來跟旁白不一樣——不然分角色就沒有意義', async () => {
    const result = await plan()
    const rates = new Set<string>()

    for (const xml of result.ssml) {
      for (const match of xml.matchAll(/<prosody rate="([^"]+)" pitch="([^"]+)"/g)) {
        rates.add(`${match[1]}|${match[2]}`)
      }
    }

    // The fixture has narration, questions and two named speakers, so
    // several different prosodies must have been emitted.
    expect(rates.size).toBeGreaterThan(1)
  })

  it('兩個角色拿到不同的音色', async () => {
    const result = await plan()

    expect(result.cast.map((row) => row.name).sort()).toEqual([...CAST].sort())

    const voices = result.cast.map((row) => row.voiceId)
    expect(new Set(voices).size).toBe(2)
    for (const voice of voices) expect(voice).not.toBeNull()

    // And the woman is in a woman's voice, which pitch alone cannot fake.
    const female = result.cast.find((row) => row.name === '測試甲')
    const male = result.cast.find((row) => row.name === '測試乙')
    expect(VOICES.find((v) => v.id === female?.voiceId)?.gender).toBe('Female')
    expect(VOICES.find((v) => v.id === male?.voiceId)?.gender).toBe('Male')
  })

  it('配音跟閱讀器用的是同一份切段與分配', async () => {
    /*
     * The claim this whole file exists to protect: a different chunking or
     * casting in the export would make the same character start speaking in
     * a different place in the audio than on the page.
     */
    const { novelForReading } = await import('@/lib/novel-export')
    const { splitForSpeech } = await import('@/lib/speech-split')
    const { castChunks } = await import('@/lib/narration')
    const { and, eq, isNull } = await import('drizzle-orm')

    const chapters = (await novelForReading(projectId)).filter((c) => c.episodeId === episodeId)
    const paragraphs = chapters.flatMap((c) => c.paragraphs)

    const cast = await db
      .select({
        id: schema.characters.id,
        name: schema.characters.name,
        gender: schema.characters.gender,
        tier: schema.characters.tier,
      })
      .from(schema.characters)
      .where(and(eq(schema.characters.projectId, projectId), isNull(schema.characters.deletedAt)))

    const expected = castChunks(
      splitForSpeech(paragraphs),
      paragraphs,
      cast.map((row) => ({
        id: row.id,
        name: row.name,
        gender: row.gender ?? '',
        tier: row.tier,
      })),
      VOICES,
      undefined,
      // 旁白的音色要留給旁白——真實呼叫會傳，所以這裡也要傳，不然比的是
      // 兩種不同的設定。
      [NARRATOR]
    ).filter((chunk) => chunk.text.trim().length > 0)

    const actual = (await plan()).batches.flatMap((b) => b.chunks)

    expect(actual.map((c) => c.text)).toEqual(expected.map((c) => c.text))
    expect(actual.map((c) => c.voiceId ?? null)).toEqual(expected.map((c) => c.voiceId ?? null))
  })

  it('算得出時間與費用，而且費用是照字元不是照標籤', async () => {
    const result = await plan()

    expect(result.estimatedSec).toBeGreaterThan(0)
    expect(result.estimatedCostUsd).not.toBeNull()

    const expectedCost = (result.billableChars / 1_000_000) * 15
    expect(result.estimatedCostUsd!).toBeCloseTo(expectedCost, 8)

    // The markup is several times the prose; billing it would be badly wrong.
    expect(result.ssml.join('').length).toBeGreaterThan(result.billableChars * 2)
  })

  it('沒有正文的集數會被擋下來，不會送一份空的去花錢', async () => {
    const { and, asc, eq, isNull, sql } = await import('drizzle-orm')
    const [empty] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(
        and(
          eq(schema.episodes.projectId, projectId),
          isNull(schema.episodes.deletedAt),
          sql`not exists (
            select 1 from documents d
              join chapters ch on ch.document_id = d.id
             where d.episode_id = ${schema.episodes.id}
               and d.kind = 'NOVEL' and d.deleted_at is null
          )`
        )
      )
      .orderBy(asc(schema.episodes.number))
      .limit(1)

    if (!empty) throw new Error('找不到任何沒有正文的集數可以測')

    await expect(
      audiobook.planEpisodeAudio({
        projectId,
        episodeId: empty.id,
        voices: VOICES,
        narratorVoice: NARRATOR,
      })
    ).rejects.toThrow(/還沒有小說內容/)
  })

  it('不是這個作品的集數開不出來', async () => {
    await expect(
      audiobook.planEpisodeAudio({
        projectId: '00000000-0000-0000-0000-000000000000',
        episodeId,
        voices: VOICES,
        narratorVoice: NARRATOR,
      })
    ).rejects.toThrow(/找不到/)
  })
})
