import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 新增章節：在這一集，還是下一集 (Z128).
 *
 * 「應該加一個看要在這裡新增還是下一集」。真正有風險的是「下一集」那條路：
 *
 *  - 下一集可能**還沒有小說文件**。編輯器拿不到一個不存在的 id，所以這個
 *    決定不能在前端做，伺服器要負責開或建。
 *  - 「下一集」不是 `number + 1`。集數是整批建的，中間有洞是正常的，所以
 *    要找的是「下一個真的存在的集數」。
 */

const ready = testDatabaseReady()

describe.skipIf(!ready)('新增章節的落點', () => {
  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let writing: typeof import('@/lib/writing')

  let projectId = ''
  let user: import('@/lib/auth/session').SessionUser

  /** Documents this test caused to exist, torn down afterwards. */
  const madeDocuments: string[] = []

  beforeAll(async () => {
    db = (await import('@/db')).db
    schema = await import('@/db/schema')
    writing = await import('@/lib/writing')

    const [project] = await db.select({ id: schema.projects.id }).from(schema.projects).limit(1)
    if (!project) throw new Error('先跑 npm run db:seed')
    projectId = project.id

    const [u] = await db.select().from(schema.users).limit(1)
    if (!u) throw new Error('先跑 npm run db:seed')
    user = {
      id: u.id,
      email: u.email,
      name: u.name,
      title: u.title,
      role: u.role,
      color: u.color,
      displayCurrency: u.displayCurrency as import('@/lib/money').CurrencyValue,
    }
  })

  afterAll(async () => {
    const { eq, inArray } = await import('drizzle-orm')
    if (madeDocuments.length > 0) {
      await db
        .delete(schema.chapters)
        .where(inArray(schema.chapters.documentId, madeDocuments))
      for (const id of madeDocuments) {
        await db.delete(schema.documents).where(eq(schema.documents.id, id))
      }
    }
    const { closeDb } = await import('@/db')
    await closeDb()
  })

  /** An episode with no 小說 document at all, which is the interesting case. */
  async function episodeWithoutNovel() {
    const { and, asc, eq, isNull, sql } = await import('drizzle-orm')
    const [row] = await db
      .select({ id: schema.episodes.id, number: schema.episodes.number })
      .from(schema.episodes)
      .where(
        and(
          eq(schema.episodes.projectId, projectId),
          isNull(schema.episodes.deletedAt),
          sql`not exists (
            select 1 from documents d
             where d.episode_id = ${schema.episodes.id}
               and d.kind = 'NOVEL'
               and d.deleted_at is null
          )`
        )
      )
      .orderBy(asc(schema.episodes.number))
      .limit(1)
    return row ?? null
  }

  it('下一集是「下一個存在的集數」，不是 number + 1', async () => {
    const { and, asc, eq, isNull } = await import('drizzle-orm')
    const rows = await db
      .select({ id: schema.episodes.id, number: schema.episodes.number })
      .from(schema.episodes)
      .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))
      .orderBy(asc(schema.episodes.number))
      .limit(2)

    expect(rows.length).toBe(2)

    const next = await writing.nextEpisodeAfter(projectId, rows[0]!.id)
    expect(next?.id).toBe(rows[1]!.id)
    // Whatever the seed's numbering is, it is the next row, not an arithmetic
    // guess at one — which is what a gap in the numbering would break.
    expect(next?.number).toBe(rows[1]!.number)
  })

  it('最後一集沒有下一集', async () => {
    const { and, desc, eq, isNull } = await import('drizzle-orm')
    const [last] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(and(eq(schema.episodes.projectId, projectId), isNull(schema.episodes.deletedAt)))
      .orderBy(desc(schema.episodes.number))
      .limit(1)

    expect(await writing.nextEpisodeAfter(projectId, last!.id)).toBeNull()
  })

  it('目標集數還沒有小說文件時，會自己開一份', async () => {
    const target = await episodeWithoutNovel()
    if (!target) return expect(true).toBe(true) // Every episode already has one.

    const created = await writing.createChapterInEpisode({
      projectId,
      episodeId: target.id,
      user,
    })
    madeDocuments.push(created.documentId)

    expect(created.episodeNumber).toBe(target.number)
    expect(created.chapter.id).toBeTruthy()
    expect(created.lockRevision).toBeGreaterThanOrEqual(0)

    const { and, eq, isNull } = await import('drizzle-orm')
    const docs = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.episodeId, target.id),
          eq(schema.documents.kind, 'NOVEL'),
          isNull(schema.documents.deletedAt)
        )
      )

    // Exactly one — `openDocument` must not race itself into two.
    expect(docs).toHaveLength(1)
    expect(docs[0]!.id).toBe(created.documentId)
  })

  it('同一集連加兩章，排序遞增且不重號', async () => {
    const target = await episodeWithoutNovel()
    if (!target) return expect(true).toBe(true)

    const first = await writing.createChapterInEpisode({
      projectId,
      episodeId: target.id,
      user,
    })
    madeDocuments.push(first.documentId)

    const second = await writing.createChapterInEpisode({
      projectId,
      episodeId: target.id,
      user,
    })

    expect(second.documentId).toBe(first.documentId)
    expect(second.chapter.sortOrder).toBeGreaterThan(first.chapter.sortOrder)
  })

  it('不是這個作品的集數，開不出章節', async () => {
    const { ne } = await import('drizzle-orm')
    const [stranger] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(ne(schema.episodes.projectId, projectId))
      .limit(1)

    if (!stranger) return expect(true).toBe(true)

    await expect(
      writing.createChapterInEpisode({ projectId, episodeId: stranger.id, user })
    ).rejects.toThrow(/找不到/)
  })
})
