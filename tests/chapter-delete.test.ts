import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 刪除章節（小說編輯）。
 *
 * 這個功能最重要的保證只有一條：**刪掉的東西拿得回來。**
 * 這個專案的規矩是「覆蓋之前先備份」——AI 助理的提案是這樣，
 * 人自己按下刪除更該是這樣，因為刪除連 diff 都沒得看。
 *
 * 所以備份不是刪除旁邊的一個步驟，是刪除的一部分，而且在同一個 transaction 裡。
 * 分開做的話：備份 commit 了而刪除 rollback，版本紀錄就留下一筆
 * 「刪除章節前」卻沒有東西被刪；反過來更糟——章節沒了，沒有快照可以還原。
 */

const ready = testDatabaseReady()

describe.skipIf(!ready)('deleteChapter', () => {
  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let writing: typeof import('@/lib/writing')
  let versions: typeof import('@/lib/versions')

  let projectId = ''
  let documentId = ''
  let user: import('@/lib/auth/session').SessionUser

  beforeAll(async () => {
    db = (await import('@/db')).db
    schema = await import('@/db/schema')
    writing = await import('@/lib/writing')
    versions = await import('@/lib/versions')

    const [project] = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .limit(1)
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

    const [episode] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .limit(1)
    if (!episode) throw new Error('先跑 npm run db:seed')

    const { eq } = await import('drizzle-orm')
    await db.delete(schema.documents).where(eq(schema.documents.episodeId, episode.id))

    const [doc] = await db
      .insert(schema.documents)
      .values({ episodeId: episode.id, kind: 'NOVEL' })
      .returning({ id: schema.documents.id })

    documentId = doc!.id
  })

  afterAll(async () => {
    const { and, eq } = await import('drizzle-orm')
    if (documentId) {
      await db
        .delete(schema.versions)
        .where(
          and(
            eq(schema.versions.targetType, 'DOCUMENT'),
            eq(schema.versions.targetId, documentId)
          )
        )
      await db.delete(schema.documents).where(eq(schema.documents.id, documentId))
    }
    const { closeDb } = await import('@/db')
    await closeDb()
  })

  /**
   * Three chapters with content, returning them and the live revision.
   *
   * Also clears this document's version history. The suite reuses one
   * document, so without this a test asserting 「沒有留下備份」 would see the
   *備份 an earlier test legitimately created.
   */
  async function threeChapters() {
    const { and, eq } = await import('drizzle-orm')
    await db.delete(schema.chapters).where(eq(schema.chapters.documentId, documentId))
    await db
      .delete(schema.versions)
      .where(
        and(
          eq(schema.versions.targetType, 'DOCUMENT'),
          eq(schema.versions.targetId, documentId)
        )
      )

    const made = []
    let revision = 0
    for (const title of ['第一章', '第二章', '第三章']) {
      const created = await writing.createChapter({ documentId, title, user })
      revision = created.lockRevision

      const saved = await writing.saveChapter({
        chapterId: created.chapter.id,
        content: `<p>${title}的正文，大約這麼長。</p>`,
        expectedRevision: revision,
        user,
      })
      revision = saved.lockRevision
      made.push(saved.chapter)
    }
    return { made, revision }
  }

  it('刪掉之前先把整份文件存成版本，而且標題寫得出是哪一章', async () => {
    const { made, revision } = await threeChapters()
    const victim = made[1]!

    const result = await writing.deleteChapter({
      chapterId: victim.id,
      expectedRevision: revision,
      user,
    })

    expect(result.title).toBe('第二章')
    expect(result.backupVersion).toBeGreaterThan(0)

    const list = await versions.listVersions(projectId, {})
    const backup = list.find((row) => row.version === result.backupVersion)
    expect(backup?.label).toContain('刪除章節前')
    expect(backup?.label).toContain('第二章')
  })

  it('那個版本真的還原得回來，而且 id 不變', async () => {
    const { made, revision } = await threeChapters()
    const victim = made[1]!

    const result = await writing.deleteChapter({
      chapterId: victim.id,
      expectedRevision: revision,
      user,
    })

    const { and, eq } = await import('drizzle-orm')

    // 真的不見了。
    const after = await db
      .select({ id: schema.chapters.id })
      .from(schema.chapters)
      .where(eq(schema.chapters.documentId, documentId))
    expect(after.map((r) => r.id)).not.toContain(victim.id)
    expect(after).toHaveLength(2)

    // 還原。
    const [backup] = await db
      .select({ id: schema.versions.id })
      .from(schema.versions)
      .where(
        and(
          eq(schema.versions.targetType, 'DOCUMENT'),
          eq(schema.versions.targetId, documentId),
          eq(schema.versions.version, result.backupVersion)
        )
      )

    await versions.restoreVersion({ projectId, versionId: backup!.id, user })

    const restored = await db
      .select({ id: schema.chapters.id, title: schema.chapters.title, content: schema.chapters.content })
      .from(schema.chapters)
      .where(eq(schema.chapters.documentId, documentId))

    expect(restored).toHaveLength(3)

    // 同一個 id，所以指著這一章的東西還指得到。
    const back = restored.find((r) => r.id === victim.id)
    expect(back).toBeDefined()
    expect(back?.title).toBe('第二章')
    expect(back?.content).toContain('第二章的正文')
  })

  it('刪掉中間那一章之後，編號不會留洞', async () => {
    const { made, revision } = await threeChapters()

    await writing.deleteChapter({
      chapterId: made[0]!.id,
      expectedRevision: revision,
      user,
    })

    const { asc, eq } = await import('drizzle-orm')
    const left = await db
      .select({ title: schema.chapters.title, sortOrder: schema.chapters.sortOrder })
      .from(schema.chapters)
      .where(eq(schema.chapters.documentId, documentId))
      .orderBy(asc(schema.chapters.sortOrder))

    // 01、02，不是 02、03。側邊欄直接把 sortOrder 當章號顯示。
    expect(left.map((r) => r.sortOrder)).toEqual([1, 2])
    expect(left.map((r) => r.title)).toEqual(['第二章', '第三章'])
  })

  it('文件的總字數會重算，不是減一個差值', async () => {
    const { made, revision } = await threeChapters()

    const before = made.reduce((n, c) => n + c.charCount, 0)
    const result = await writing.deleteChapter({
      chapterId: made[2]!.id,
      expectedRevision: revision,
      user,
    })

    expect(result.documentCharCount).toBe(before - made[2]!.charCount)

    const { eq } = await import('drizzle-orm')
    const [doc] = await db
      .select({ charCount: schema.documents.charCount })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))

    expect(doc?.charCount).toBe(result.documentCharCount)
  })

  it('版本號過期就拒絕，不會把別人正在打的那一章刪掉', async () => {
    const { made, revision } = await threeChapters()

    await expect(
      writing.deleteChapter({
        chapterId: made[0]!.id,
        expectedRevision: revision - 1,
        user,
      })
    ).rejects.toThrow()

    // 被拒絕之後什麼都沒動——連備份都不該留下。
    const { and, eq } = await import('drizzle-orm')
    const still = await db
      .select({ id: schema.chapters.id })
      .from(schema.chapters)
      .where(eq(schema.chapters.documentId, documentId))
    expect(still).toHaveLength(3)

    const labels = await db
      .select({ label: schema.versions.label })
      .from(schema.versions)
      .where(
        and(
          eq(schema.versions.targetType, 'DOCUMENT'),
          eq(schema.versions.targetId, documentId)
        )
      )
    expect(labels.some((r) => r.label.includes('刪除章節前'))).toBe(false)
  })

  it('找不到的章節會說找不到，不會默默成功', async () => {
    await expect(
      writing.deleteChapter({
        chapterId: '00000000-0000-0000-0000-000000000000',
        expectedRevision: 1,
        user,
      })
    ).rejects.toThrow()
  })
})
