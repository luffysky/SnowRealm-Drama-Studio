import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { aiJobs, documents, episodes, scenes, versions } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { parseSceneList, sceneCodeFor } from '@/lib/ai/scene-draft'
import { countRichTextChars } from '@/lib/utils'
import { estimateSceneSeconds } from '@/lib/writing'

/**
 * 把 AI 改編的輸出寫成場次 (Z30).
 *
 * 解析在 `@/lib/ai/scene-draft`（純函式，用戶端也 import 得到）；這一支負責
 * 寫入，所以它是唯一碰資料庫的那一半。
 *
 * ## 取代而不是接在後面——跟分鏡相反，而且是故意的
 *
 * `applyStoryboard` 接在既有鏡頭後面，理由寫得很清楚：「`shots` 沒有版本快
 * 照，抹掉就是真的沒了」。場次不一樣——`versions` 的快照**包含 scenes**
 * （`restoreVersion` 會把它們整組還原），所以覆蓋是救得回來的。
 *
 * 而這個任務要的就是覆蓋：「把本集小說改編成劇本」產出的是**整集**的場次。
 * 接在後面會得到一份第一場重複兩次、場號從 S01 跳到 S09 的劇本，而片長估算
 * 會把兩份都算進去——「這一集 280 秒」會變成一個算錯的、看起來很嚴重的數字。
 *
 * 所以：**先存版本，再清空，再寫入**。順序不能反，而且在同一個 transaction
 * 裡——存到一半失敗而場次已經清掉，那是這一頁能做的最壞的事。
 */

export type AppliedScript = {
  created: number
  /** 被取代掉的場次數，給介面說出「原本的 N 場存成了版本」。 */
  replaced: number
  versionId: string | null
  totalSeconds: number
  rejected: string[]
}

export async function applyScript(input: {
  jobId: string
  user: SessionUser
  /** 面板有候選選擇器，寫死 0 等於「選 B 卻套用 A」。 */
  candidateIndex?: number
}): Promise<AppliedScript> {
  const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, input.jobId)).limit(1)
  if (!job) throw ApiError.notFound('找不到該 AI 任務')
  if (!job.episodeId) throw ApiError.badRequest('這個改編任務沒有綁定集數，無法套用')

  const result = job.result as { candidates?: { content: string }[] } | null
  const candidate = result?.candidates?.[input.candidateIndex ?? 0]
  if (!candidate) throw ApiError.badRequest('找不到指定的候選內容')

  const parsed = parseSceneList(candidate.content)

  /*
   * 讀不出場次就什麼都不做——在碰資料庫之前。
   *
   * 不先擋的話，下面會存一個版本、清空場次，然後插入零筆：使用者按一次
   * 「採用」就把整份劇本清空了，而錯誤訊息說的是「讀不出任何場次」。
   */
  if (parsed.scenes.length === 0) {
    throw ApiError.badRequest(
      `讀不出任何場次，所以一個字都沒有改。${parsed.rejected[0] ?? ''}`
    )
  }

  const [episode] = await db
    .select({ id: episodes.id, projectId: episodes.projectId, number: episodes.number })
    .from(episodes)
    .where(eq(episodes.id, job.episodeId))
    .limit(1)

  if (!episode) throw ApiError.notFound('找不到這一集')

  /*
   * `kind` 一定要篩，而且是這一支最危險的一行。
   *
   * `documents` 是 unique(episode_id, kind)，所以一集有**兩列**：小說一列、
   * 劇本一列。只用 `episodeId` 查，拿到哪一份由資料庫的回傳順序決定——
   * 也就是說有一半的機會，這個改編任務會把**小說**那一份的場次清掉，
   * 然後 `markSearchDirty` 之後連搜尋都跟著對齊到錯的東西上。
   */
  const [found] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.episodeId, episode.id),
        eq(documents.kind, 'SCRIPT'),
        isNull(documents.deletedAt)
      )
    )
    .limit(1)

  if (!found) throw ApiError.notFound('這一集還沒有劇本文件')

  /*
   * 定稿鎖在這一條也要生效 (Z41).
   *
   * `applyToDocument` 擋了，而這是 AI 產出寫進劇本的**另一條**路。只擋一條
   * 等於沒擋——而且覆蓋還會留下一個版本快照，看起來完全正常。
   */
  const { assertNotLocked } = await import('@/lib/approvals')
  await assertNotLocked('DOCUMENT', found.id)

  /*
   * 片長由伺服器算，不問模型 (Z30).
   *
   * `estimateSceneSeconds` 是一個定義好的算式（對白 5 字／秒、動作 15 字／
   * 秒），而模型給的秒數是它猜的。兩個都存就是讓同一件事有兩個說法，而畫面
   * 上「預估片長」跟「目標區間」的比較一旦用猜的那個，整個片長校驗就失去意
   * 義。prompt 裡有告訴模型這個算式，讓它自己控節奏——但寫進資料庫的是這裡
   * 算出來的。
   */
  const drafts = parsed.scenes.map((scene, index) => {
    const sortOrder = index + 1
    return {
      sortOrder,
      code: sceneCodeFor(sortOrder),
      heading: scene.heading,
      location: scene.location,
      timeOfDay: scene.timeOfDay,
      content: scene.content,
      estimatedSec: estimateSceneSeconds(scene.content),
    }
  })

  const totalSeconds = drafts.reduce((n, scene) => n + scene.estimatedSec, 0)
  const charCount = drafts.reduce((n, scene) => n + countRichTextChars(scene.content), 0)

  const { replaced, versionId } = await db.transaction(async (tx) => {
    /*
     * 文件要在交易**裡面**重讀 (Z30 審出來).
     *
     * 本來在外面讀，然後拿那個 `version + 1` 當版本號插進來——而
     * `versions` 是 unique(target_type, target_id, version)。兩個人同時動同
     * 一集（一個在收件匣按採用、一個在編輯器按存成版本）就會撞號，而那個視
     * 窗橫跨了 `assertNotLocked`、解析與整個片長估算迴圈。
     *
     * `applyToDocument` 與 `appendSnapshot` 都是在交易裡讀的。版本號也改成
     * 取 `max(versions.version)` 與 `documents.version` 的大的那一個再加一
     * ——因為 `recordProposalBackup` 會寫 versions 而不動 documents.version，
     * 兩者本來就會漂移。
     */
    const [doc] = await tx
      .select({
        id: documents.id,
        version: documents.version,
        charCount: documents.charCount,
      })
      .from(documents)
      .where(eq(documents.id, found.id))
      .limit(1)

    if (!doc) throw ApiError.notFound('這一集還沒有劇本文件')

    const live = await tx
      .select()
      .from(scenes)
      .where(eq(scenes.documentId, doc.id))
      .orderBy(asc(scenes.sortOrder))

    let snapshotId: string | null = null
    let nextDocumentVersion = doc.version

    /*
     * 沒有舊場次就不要存一個空版本。
     *
     * 第一次改編是常態（劇本本來就是空的），而一列「v2 空的」只會讓版本紀錄
     * 多一筆沒有內容可還原的雜訊，然後下一個人得點進去才知道它是空的。
     */
    if (live.length > 0) {
      const [highest] = await tx
        .select({ version: sql<number>`coalesce(max(${versions.version}), 0)` })
        .from(versions)
        .where(and(eq(versions.targetType, 'DOCUMENT'), eq(versions.targetId, doc.id)))

      const nextVersion = Math.max(doc.version, Number(highest?.version ?? 0)) + 1

      const [snapshot] = await tx
        .insert(versions)
        .values({
          targetType: 'DOCUMENT',
          targetId: doc.id,
          version: nextVersion,
          snapshot: {
            kind: 'SCRIPT',
            scenes: live.map((row) => ({
              id: row.id,
              sortOrder: row.sortOrder,
              code: row.code,
              heading: row.heading,
              location: row.location,
              timeOfDay: row.timeOfDay,
              content: row.content,
            })),
          },
          charCount: doc.charCount,
          label: `AI 改編覆蓋前自動存檔（原本 ${live.length} 場）`,
          // 哪一個任務寫的，版本紀錄上要看得到——這是 `versions.aiJobId` 的
          // 用途，而且它是「這一版不是人寫的」唯一的證據。
          aiJobId: job.id,
          authorId: input.user.id,
          authorName: input.user.name,
        })
        .returning({ id: versions.id })

      snapshotId = snapshot?.id ?? null
      nextDocumentVersion = nextVersion
      await tx.delete(scenes).where(eq(scenes.documentId, doc.id))
    }

    await tx.insert(scenes).values(drafts.map((draft) => ({ ...draft, documentId: doc.id })))

    /*
     * `lockRevision` 一定要跳。
     *
     * 編輯器開著的時候手上有一個 `expectedRevision`，存檔時用它擋「對方先存
     * 了」。場次整組換掉而這個號碼不動的話，那一份停在舊場次上的編輯器**會
     * 通過樂觀鎖檢查**，然後把剛改編出來的內容覆蓋回去——而且沒有任何人會收
     * 到衝突提示。
     */
    await tx
      .update(documents)
      .set({
        charCount,
        version: nextDocumentVersion,
        lockRevision: sql`${documents.lockRevision} + 1`,
        lastEditorId: input.user.id,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id))

    /*
     * 任務也在交易裡標記 (Z30 審出來).
     *
     * 本來在交易之後。那一行是唯一一個「會丟例外、而且在資料已經寫進去之
     * 後」的步驟——`logActivity` 與 `markSearchDirty` 都自己吞掉錯誤。它失
     * 敗的話：場次已經換掉了，畫面卻說「採用失敗」，任務還留在待確認裡。
     * 再按一次，就會把 **AI 剛寫的那一版**存成「覆蓋前自動存檔」。
     */
    await tx
      .update(aiJobs)
      .set({
        status: 'SUCCEEDED',
        appliedById: input.user.id,
        appliedAt: new Date(),
        appliedVersionId: snapshotId,
        progressNote: `已套用，寫入 ${drafts.length} 場`,
        updatedAt: new Date(),
      })
      .where(eq(aiJobs.id, job.id))

    return { replaced: live.length, versionId: snapshotId }
  })

  await logActivity({
    user: input.user,
    action: 'ai.apply',
    entityType: 'document',
    entityId: found.id,
    projectId: episode.projectId,
    summary:
      `套用 AI 改編：第 ${episode.number} 集寫入 ${drafts.length} 場` +
      (replaced > 0 ? `，取代原本的 ${replaced} 場` : ''),
  })

  const { markSearchDirty } = await import('@/lib/search')
  await markSearchDirty(episode.projectId)

  /*
   * 九大階段要跟上 (Z30 審出來).
   *
   * 劇本階段的完成度是 `sum(scenes.estimated_sec) ÷ episodes.target_sec` 推
   * 出來的，而這是全專案**一次寫最多場次**的地方——不重算的話，整集改編完
   * 製作流程板跟儀表板上「劇本」還是 0%。
   *
   * `resyncEpisodeStages` 自己吞掉錯誤，所以不會讓一個已經寫成功的採用變成
   * 失敗。（`saveScene`／`createScene`／`restoreVersion` 也都沒有呼叫它，那
   * 是既有的洞，不在這一條的範圍。）
   */
  const { resyncEpisodeStages } = await import('@/lib/stage-sync')
  await resyncEpisodeStages(episode.id)

  return { created: drafts.length, replaced, versionId, totalSeconds, rejected: parsed.rejected }
}
