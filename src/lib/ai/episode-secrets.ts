import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { episodes, episodeSecrets } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'

/**
 * 編劇已確認的隱藏設定 (Z201).
 *
 * ## 這一支是唯一拿得到它的地方
 *
 * 隱藏設定放在 `episode_secrets` 這張自己的表，而不是 `episodes` 的一個欄位
 * ——因為雙視角審核的整個重點是「觀眾那一趟拿不到」，而長在 `episodes` 上的欄
 * 位會被每一個 `select *` 帶出去。
 *
 * 所以要讀它必須**明確地呼叫這裡**，而這裡只有兩支函式、二十行。哪一天有人把
 * 它接到觀眾那一趟，在 code review 上看得見。
 *
 * 第二道是 `renderContext`：`auditPass === 'audience'` 時遇到 `secretNotes`
 * **直接丟例外**。一次外洩會變成一次當掉，而不是一份看起來很合理的報告。
 */

const MAX_NOTES = 20_000

export async function getSecret(projectId: string, episodeId: string): Promise<string> {
  const [row] = await db
    .select({ notes: episodeSecrets.notes })
    .from(episodeSecrets)
    .where(
      and(eq(episodeSecrets.episodeId, episodeId), eq(episodeSecrets.projectId, projectId))
    )
    .limit(1)
  return row?.notes ?? ''
}

/** 這個作品所有填過的集數，給畫面標示哪幾集有設定。 */
export async function secretEpisodeIds(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ episodeId: episodeSecrets.episodeId, notes: episodeSecrets.notes })
    .from(episodeSecrets)
    .where(eq(episodeSecrets.projectId, projectId))
  return rows.filter((row) => row.notes.trim()).map((row) => row.episodeId)
}

export async function setSecret(input: {
  projectId: string
  episodeId: string
  notes: string
  user: SessionUser
}): Promise<void> {
  if (input.notes.length > MAX_NOTES) throw ApiError.badRequest('隱藏設定太長了')

  /*
   * 集數要屬於這個作品。
   *
   * 外鍵只保證那一集存在，不保證它是誰的——而這一欄的內容是劇透，掛錯作品等
   * 於把 A 的底牌寫進 B 的檔案裡。跟 Z190／Z194／Z197／Z200 同一條規矩。
   */
  const [episode] = await db
    .select({ id: episodes.id, number: episodes.number })
    .from(episodes)
    .where(and(eq(episodes.id, input.episodeId), eq(episodes.projectId, input.projectId)))
    .limit(1)
  if (!episode) throw ApiError.badRequest('指定的集數不屬於這個作品')

  const notes = input.notes.trim()
  const now = new Date()

  await db
    .insert(episodeSecrets)
    .values({
      episodeId: input.episodeId,
      projectId: input.projectId,
      notes,
      updatedById: input.user.id,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: episodeSecrets.episodeId,
      set: { notes, updatedById: input.user.id, updatedAt: now },
    })

  /*
   * 活動紀錄裡**不要寫內容**。
   *
   * 動態是兩個人互相看對方做了什麼的地方，而這一欄的內容正是不該被順手看到的
   * 東西——寫「改了隱藏設定」就夠了，寫一段摘要等於把它貼到儀表板上。
   */
  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'episode_secret',
    entityId: input.episodeId,
    projectId: input.projectId,
    summary: `${input.user.name} ${notes ? '更新' : '清空'}了第 ${episode.number} 集的隱藏設定`,
  })
}
