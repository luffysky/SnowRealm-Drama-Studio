import { describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 劇本的 AI 讀得到小說嗎，而且讀的是對的那一集嗎（Z113）。
 *
 * 這組測試在守三件事：
 *
 *  1. `buildContext` **自己**會去把小說撈出來。正文不經過瀏覽器——
 *     一集一萬字，客戶端只需要說出是哪一集。
 *  2. 撈到的是**指定那一集**的，不是隨便一集。集數對錯是這個功能的全部。
 *  3. 空的一集回空字串，而不是回別集的內容湊數。
 */

const ready = testDatabaseReady()

describe.skipIf(!ready)('依小說生成劇本的素材', () => {
  it('buildContext 自己讀小說，而且讀的是指定的那一集', async () => {
    const { buildContext, novelSources } = await import('@/lib/ai/jobs')
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { eq, isNull } = await import('drizzle-orm')

    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(isNull(schema.projects.deletedAt))
      .limit(1)
    if (!project) return

    const sources = await novelSources(project.id)
    if (sources.length === 0) return

    const first = sources[0]!

    // 沒有指定就沒有正文：context 不會自己去猜要讀哪一集。
    const without = await buildContext({ projectId: project.id })
    expect(without.sourceText ?? '').toBe('')

    // 指定了就讀得到。
    const withNovel = await buildContext({
      projectId: project.id,
      novelEpisodeId: first.id,
    })
    expect((withNovel.sourceText ?? '').length).toBeGreaterThan(100)

    // 而且讀到的是那一集的字，不是別集的。
    const [chapter] = await db
      .select({ title: schema.chapters.title })
      .from(schema.chapters)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.chapters.documentId))
      .where(eq(schema.documents.episodeId, first.id))
      .limit(1)

    if (chapter?.title) {
      expect(withNovel.sourceText).toContain(chapter.title)
    }
  })

  it('不同集拿到不同的正文', async () => {
    const { buildContext, novelSources } = await import('@/lib/ai/jobs')
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { isNull } = await import('drizzle-orm')

    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(isNull(schema.projects.deletedAt))
      .limit(1)
    if (!project) return

    const sources = await novelSources(project.id)
    if (sources.length < 2) return

    const a = await buildContext({ projectId: project.id, novelEpisodeId: sources[0]!.id })
    const b = await buildContext({ projectId: project.id, novelEpisodeId: sources[1]!.id })

    // 集數對錯就是這個功能的全部；兩集拿到一樣的東西等於沒有分集。
    expect(a.sourceText).not.toBe(b.sourceText)
  })

  it('novelSources 只列出真的寫了字的集數', async () => {
    const { novelSources } = await import('@/lib/ai/jobs')
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { isNull } = await import('drizzle-orm')

    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(isNull(schema.projects.deletedAt))
      .limit(1)
    if (!project) return

    const sources = await novelSources(project.id)
    // 空的一集不是素材。列出來等於提供一個「花錢換到『沒東西可讀』」的按鈕。
    for (const source of sources) {
      expect(source.charCount, `EP${source.number}`).toBeGreaterThan(0)
    }
  })

  it('沒有寫過的集數回空字串，不會拿別集的湊數', async () => {
    const { episodeNovelText } = await import('@/lib/ai/jobs')
    const { db } = await import('@/db')
    const schema = await import('@/db/schema')
    const { and, eq, isNull, notInArray } = await import('drizzle-orm')

    const written = await db
      .selectDistinct({ id: schema.documents.episodeId })
      .from(schema.documents)
      .where(and(eq(schema.documents.kind, 'NOVEL'), isNull(schema.documents.deletedAt)))

    const ids = written.map((r) => r.id).filter((id): id is string => Boolean(id))

    const [blank] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(ids.length > 0 ? notInArray(schema.episodes.id, ids) : undefined)
      .limit(1)

    if (!blank) return
    expect(await episodeNovelText(blank.id)).toBe('')
  })
})
