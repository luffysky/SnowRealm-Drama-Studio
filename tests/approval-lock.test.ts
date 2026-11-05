import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseReady } from './helpers/database'

/**
 * 定稿鎖 (Z41).
 *
 * `src/lib/approvals.ts` 從一開始就在，而 `assertNotLocked` 的註解寫著
 * 「Call this at the top of any write path for approvable content — a hidden
 * Save button is not an authorisation check」。
 *
 * 它**沒有被放在任何一條寫入路徑上**。所以 spec v2 §6.5「已定稿內容必須透過
 * 審核解鎖或建立修訂版」一直只是一句話：審核頁面會顯示「已鎖定」，而編輯器
 * 照樣存得進去。
 *
 * 這份測試盯的就是那件事，而不是 CRUD：
 *
 *  1. **定稿之後存檔要被拒絕**，而且內容真的沒變。
 *  2. **AI 採用也要被拒絕**——那是另一條寫回正文的路，只擋人手存檔等於只擋
 *     住了比較慢的那一條。
 *  3. **解鎖之後要能存回去**。一個解不開的鎖就是資料遺失。
 *  4. **解鎖必須說原因**。那是這個鎖的全部意義：重開是一個可歸屬的動作。
 */

const ready = testDatabaseReady()

describe.skipIf(!ready)('定稿鎖', () => {
  let db: typeof import('@/db').db
  let schema: typeof import('@/db/schema')
  let approvals: typeof import('@/lib/approvals')
  let writing: typeof import('@/lib/writing')

  let projectId = ''
  let documentId = ''
  let chapterId = ''
  let originalContent = ''
  let user: import('@/lib/auth/session').SessionUser

  /** 這份測試造出來的東西，最後真的刪掉。 */
  const approvalIds: string[] = []
  const versionIds: { id: string; targetId: string; version: number }[] = []

  beforeAll(async () => {
    db = (await import('@/db')).db
    schema = await import('@/db/schema')
    approvals = await import('@/lib/approvals')
    writing = await import('@/lib/writing')

    const { eq } = await import('drizzle-orm')

    const [target] = await db
      .select({
        documentId: schema.documents.id,
        projectId: schema.episodes.projectId,
      })
      .from(schema.documents)
      .innerJoin(schema.episodes, eq(schema.episodes.id, schema.documents.episodeId))
      .where(eq(schema.documents.kind, 'NOVEL'))
      .limit(1)

    if (!target) throw new Error('沒有任何小說文件，先跑 npm run db:seed')

    documentId = target.documentId
    projectId = target.projectId

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

    /*
     * 自己造一個章節，不要借現有的。
     *
     * 本機測試資料庫有 43 份文件、**零個章節**（正文在 Neon 那邊）。借現有的
     * 會讓這份測試在一台機器上跑、在另一台上整組跳過——而跳過的測試看起來跟
     * 通過的一樣綠。
     *
     * 造出來的那一個最後真的刪掉，內容也不碰別人的。
     */
    const created = await writing.createChapter({
      documentId,
      title: `定稿鎖測試 ${Date.now()}`,
      user,
    })
    chapterId = created.chapter.id
    originalContent = created.chapter.content
  })

  afterAll(async () => {
    const { eq } = await import('drizzle-orm')

    /*
     * beforeAll 可能在半途就失敗了（沒有可用的文件、沒有使用者），這時下面
     * 每一個 id 都還是空字串——而拿空字串當 uuid 查下去的錯誤訊息會指向這個
     * afterAll，把真正的原因蓋掉。
     */
    if (!documentId) {
      const { closeDb } = await import('@/db')
      await closeDb()
      return
    }

    /*
     * 鎖一定要解掉，而且要先解。留一個鎖著的文件給下一份測試，會讓那份測試
     * 的每一次存檔都失敗——而失敗訊息會指向它自己，不會指向這裡。
     */
    for (const id of approvalIds) {
      await db.delete(schema.approvalRecords).where(eq(schema.approvalRecords.id, id))
    }

    await db
      .update(schema.documents)
      .set({ approvedVersionId: null })
      .where(eq(schema.documents.id, documentId))

    for (const row of versionIds) {
      await db.delete(schema.versions).where(eq(schema.versions.id, row.id))
      await db
        .update(schema.documents)
        .set({ version: row.version - 1 })
        .where(eq(schema.documents.id, row.targetId))
    }

    // 自己造的章節，自己刪掉。
    if (chapterId) {
      await db.delete(schema.chapters).where(eq(schema.chapters.id, chapterId))
    }

    const { closeDb } = await import('@/db')
    await closeDb()
  })

  /** 做一份快照並定稿，回傳要用來解鎖的資料。 */
  async function lockIt() {
    const snapshot = await writing.snapshotDocument({
      documentId,
      label: '測試用定稿快照',
      user,
    })
    versionIds.push({ id: snapshot.id, targetId: documentId, version: snapshot.version })

    const approval = await approvals.approve({
      user,
      projectId,
      targetType: 'DOCUMENT',
      targetId: documentId,
      versionId: snapshot.id,
      note: '測試用',
    })
    approvalIds.push(approval.id)
    return approval
  }

  async function unlockIt() {
    const lifted = await approvals.unlock({
      user,
      projectId,
      targetType: 'DOCUMENT',
      targetId: documentId,
      reason: '測試用，解開',
    })
    approvalIds.push(lifted.id)
  }

  async function currentRevision(): Promise<number> {
    const { eq } = await import('drizzle-orm')
    const [row] = await db
      .select({ lockRevision: schema.documents.lockRevision })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId))
      .limit(1)
    return row?.lockRevision ?? 1
  }

  it('定稿之後存檔被拒絕，而且內容真的沒變', async () => {
    await lockIt()
    expect(await approvals.isLocked('DOCUMENT', documentId)).toBe(true)

    const marker = `<p>這一行不該存進去 ${Date.now()}</p>`

    await expect(
      writing.saveChapter({
        chapterId,
        content: `${originalContent}${marker}`,
        expectedRevision: await currentRevision(),
        user,
      })
    ).rejects.toThrow(/已定稿並鎖定/)

    /*
     * 「它丟了錯」不等於「它沒寫」。Z123 那條就是一個說有寫入其實沒有的
     * 鏡像版本——這裡要的是反過來確認：報了錯，而且真的什麼都沒改。
     */
    const { eq } = await import('drizzle-orm')
    const [after] = await db
      .select({ content: schema.chapters.content })
      .from(schema.chapters)
      .where(eq(schema.chapters.id, chapterId))
      .limit(1)

    expect(after?.content).not.toContain('這一行不該存進去')

    await unlockIt()
  })

  it('定稿之後 AI 採用也被拒絕', async () => {
    await lockIt()

    /*
     * `replaceChapterContent` 是 AI 產出寫回正文的那一條路。擋人手不擋 AI，
     * 等於只擋住了比較慢的那一條——而 AI 覆蓋還會留下一個版本快照，看起來
     * 完全正常。
     */
    await expect(
      writing.replaceChapterContent({
        chapterId,
        content: '<p>AI 寫的東西</p>',
        expectedRevision: await currentRevision(),
        user,
        label: '測試用',
      })
    ).rejects.toThrow(/已定稿並鎖定/)

    await unlockIt()
  })

  it('解鎖之後存得回去', async () => {
    await lockIt()
    await unlockIt()

    expect(await approvals.isLocked('DOCUMENT', documentId)).toBe(false)

    const saved = await writing.saveChapter({
      chapterId,
      content: originalContent,
      expectedRevision: await currentRevision(),
      user,
    })

    expect(saved).toBeTruthy()
  })

  it('解鎖必須說原因', async () => {
    await lockIt()

    await expect(
      approvals.unlock({
        user,
        projectId,
        targetType: 'DOCUMENT',
        targetId: documentId,
        reason: '   ',
      })
    ).rejects.toThrow(/原因/)

    // 還鎖著才算這一條有效。
    expect(await approvals.isLocked('DOCUMENT', documentId)).toBe(true)

    await unlockIt()
  })

  it('已經定稿的東西不能再定稿一次', async () => {
    await lockIt()

    const snapshot = await writing.snapshotDocument({
      documentId,
      label: '測試用第二份快照',
      user,
    })
    versionIds.push({ id: snapshot.id, targetId: documentId, version: snapshot.version })

    await expect(
      approvals.approve({
        user,
        projectId,
        targetType: 'DOCUMENT',
        targetId: documentId,
        versionId: snapshot.id,
      })
    ).rejects.toThrow(/已經定稿/)

    await unlockIt()
  })
})
