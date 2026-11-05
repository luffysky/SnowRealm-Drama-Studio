import { loadEnv } from '../src/lib/load-env'
import type { SessionUser } from '../src/lib/auth/session'
loadEnv()

/**
 * 定稿鎖住之後，存檔真的存不進去嗎 (Z41).
 *
 * 這是整個 Z41 唯一值得實機跑一次的問題。`assertNotLocked` 的註解一直寫著
 * 「Call this at the top of any write path」，而它在這之前**沒有被放在任何一
 * 條寫入路徑上**——也就是說 spec v2 §6.5 一直只是一句話。
 *
 * 所以這支 probe 問三件事：
 *   1. 定稿之後 `saveChapter` 會不會被擋
 *   2. 解鎖之後會不會又能存
 *   3. 解鎖必須說原因這條規則還在不在
 *
 * 第二件跟第一件一樣重要：一個解不開的鎖就是資料遺失。
 */
async function main() {
  const { db } = await import('../src/db')
  const { users, chapters, documents, versions, approvalRecords } = await import(
    '../src/db/schema'
  )
  const { and, eq, desc } = await import('drizzle-orm')
  const { approve, unlock, isLocked } = await import('../src/lib/approvals')
  const { saveChapter, openDocument, snapshotDocument } = await import('../src/lib/writing')
  const { mainProject } = await import('./helpers/main-project')

  const project = await mainProject()
  const [row] = await db.select().from(users).limit(1)
  if (!row) throw new Error('沒有使用者')
  const user: SessionUser = { ...row, displayCurrency: 'TWD' } as SessionUser

  // 找一份有章節的小說文件。
  const [target] = await db
    .select({
      documentId: documents.id,
      episodeId: documents.episodeId,
      chapterId: chapters.id,
      content: chapters.content,
      title: chapters.title,
    })
    .from(documents)
    .innerJoin(chapters, eq(chapters.documentId, documents.id))
    .where(eq(documents.kind, 'NOVEL'))
    .limit(1)

  if (!target) throw new Error('找不到任何有章節的小說文件')

  const doc = await openDocument(project.id, target.episodeId, 'NOVEL')
  if (!doc) throw new Error('讀不到那份文件')
  console.log(`  文件 ${target.documentId.slice(0, 8)}…　章節「${target.title}」`)

  // 定稿要釘一個確切的版本，所以先確認有快照可以釘。
  const [snapshot] = await db
    .select({ id: versions.id, version: versions.version })
    .from(versions)
    .where(and(eq(versions.targetType, 'DOCUMENT'), eq(versions.targetId, target.documentId)))
    .orderBy(desc(versions.version))
    .limit(1)

  /*
   * 章節存檔**不會**產生版本快照：`versions` 只在明確按「保留這一版」或刪章
   * 節備份的時候才長出來。實測這部作品的小說文件一份都沒有——這就是路由在定
   * 稿時會自己先做一份的原因。這裡照同一條路走。
   */
  const pinned = snapshot ?? (await snapshotDocument({
    documentId: target.documentId,
    label: '【驗證用】定稿前快照',
    user,
  }))
  console.log(`  要釘住的版本：v${pinned.version}${snapshot ? '（原本就有）' : '（現做的）'}`)

  const created: string[] = []

  try {
    // --- 1. 定稿 -------------------------------------------------------
    const approval = await approve({
      user,
      projectId: project.id,
      targetType: 'DOCUMENT',
      targetId: target.documentId,
      versionId: pinned.id,
      note: '【驗證用】定稿鎖測試',
    })
    created.push(approval.id)
    console.log(`  定稿 v${pinned.version}：✓　鎖定中＝${await isLocked('DOCUMENT', target.documentId)}`)

    // --- 2. 存檔必須被擋 ------------------------------------------------
    const fresh = await openDocument(project.id, target.episodeId, 'NOVEL')
    let blocked = false
    let message = ''
    try {
      await saveChapter({
        chapterId: target.chapterId,
        content: `${target.content}<p>【驗證用】這一行不該存進去</p>`,
        expectedRevision: fresh!.lockRevision,
        user,
      })
    } catch (error) {
      blocked = true
      message = error instanceof Error ? error.message : String(error)
    }
    console.log(`  定稿後存檔被擋：${blocked ? '✓' : '✗ 存進去了，鎖是裝飾品'}`)
    if (message) console.log(`    「${message}」`)
    if (!blocked) throw new Error('定稿鎖沒有擋住存檔')

    // 確認內容真的沒變。
    const [after] = await db
      .select({ content: chapters.content })
      .from(chapters)
      .where(eq(chapters.id, target.chapterId))
      .limit(1)
    const unchanged = !after?.content.includes('這一行不該存進去')
    console.log(`  內容真的沒被改到：${unchanged ? '✓' : '✗'}`)
    if (!unchanged) throw new Error('被擋了但內容還是變了')

    // --- 3. 沒有原因不能解鎖 --------------------------------------------
    let refused = false
    try {
      await unlock({
        user,
        projectId: project.id,
        targetType: 'DOCUMENT',
        targetId: target.documentId,
        reason: '   ',
      })
    } catch {
      refused = true
    }
    console.log(`  沒寫原因不能解鎖：${refused ? '✓' : '✗'}`)

    // --- 4. 解鎖之後又能存 ----------------------------------------------
    const lifted = await unlock({
      user,
      projectId: project.id,
      targetType: 'DOCUMENT',
      targetId: target.documentId,
      reason: '【驗證用】測試完畢，解開',
    })
    created.push(lifted.id)

    const reopened = await openDocument(project.id, target.episodeId, 'NOVEL')
    await saveChapter({
      chapterId: target.chapterId,
      content: target.content,
      expectedRevision: reopened!.lockRevision,
      user,
    })
    console.log('  解鎖之後存得進去：✓')
  } finally {
    // 驗證用的審核紀錄清掉，不要在審核頁上留兩筆假的。
    for (const id of created) {
      await db.delete(approvalRecords).where(eq(approvalRecords.id, id))
    }
    await db
      .update(documents)
      .set({ approvedVersionId: null })
      .where(eq(documents.id, target.documentId))

    if (snapshot) {
      // 原本就有這一版，只把定稿標記拿掉。
      await db.update(versions).set({ isApproved: false }).where(eq(versions.id, pinned.id))
      console.log('  驗證用的審核紀錄已清除')
    } else {
      /*
       * 快照是這支 probe 現做的，所以要連它一起清掉——不然 版本紀錄 上會留
       * 一筆「【驗證用】定稿前快照」，而 `documents.version` 也會虛增一號。
       */
      await db.delete(versions).where(eq(versions.id, pinned.id))
      await db
        .update(documents)
        .set({ version: pinned.version - 1 })
        .where(eq(documents.id, target.documentId))
      console.log('  驗證用的審核紀錄與快照都已清除，版本號也回去了')
    }
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)
