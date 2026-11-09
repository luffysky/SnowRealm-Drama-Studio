import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { episodes, users, writerReports } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import {
  isReportKind,
  type SavedReport,
  type WriterReportKind,
} from '@/lib/ai/story-audit-view'

/**
 * 存起來的整理 (Z200).
 *
 * 在這之前編劇助手跑出來的東西只活在那個分頁裡：重新整理就沒了，而每跑一次都
 * 是一次新的花費。老闆要的是「存好、隨時點開看」。
 *
 * ## 存的是結果，不是指令
 *
 * `payload` 放的是已經解析好的那個物件（`EpisodeAudit`／`StoryDigest`／一組問
 * 答），不是模型回的原字串。原字串重新解析一次要帶著解析器的版本跑，而解析器
 * 會改——存結果的話，畫面永遠畫得出來。
 *
 * ## 不去重
 *
 * 同一集存兩次就是兩筆。重跑一次通常正是因為**上一次不夠好**，而比較兩次的差
 * 別是這份東西的用途之一。要刪有刪。
 */

const MAX_PAYLOAD_CHARS = 200_000

export async function saveReport(input: {
  projectId: string
  episodeId?: string | null
  kind: string
  title: string
  payload: unknown
  model?: string
  user: SessionUser
}): Promise<{ id: string }> {
  if (!isReportKind(input.kind)) throw ApiError.badRequest(`認不得的種類：${input.kind}`)

  /*
   * 集數要屬於這個作品。
   *
   * 外鍵只保證那一集存在，不保證它是誰的——少了這一行，一份整理可以掛到別部
   * 作品的集數上，而列表會照著那一集去分組。跟 Z190／Z194 同一條規矩。
   */
  if (input.episodeId) {
    const [row] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(and(eq(episodes.id, input.episodeId), eq(episodes.projectId, input.projectId)))
      .limit(1)
    if (!row) throw ApiError.badRequest('指定的集數不屬於這個作品')
  }

  const json = JSON.stringify(input.payload ?? null)
  if (json === 'null') throw ApiError.badRequest('沒有東西可以存')
  if (json.length > MAX_PAYLOAD_CHARS) {
    throw ApiError.badRequest('這一份太大了，存不下來')
  }

  const [row] = await db
    .insert(writerReports)
    .values({
      projectId: input.projectId,
      episodeId: input.episodeId ?? null,
      kind: input.kind,
      title: input.title.slice(0, 200),
      payload: input.payload as never,
      model: input.model ?? '',
      createdById: input.user.id,
    })
    .returning({ id: writerReports.id })

  if (!row) throw new ApiError(500, '存不起來', 'writer_report_create_failed')

  await logActivity({
    user: input.user,
    action: 'create',
    entityType: 'writer_report',
    entityId: row.id,
    projectId: input.projectId,
    summary: `${input.user.name} 存了一份編劇整理：${input.title.slice(0, 60)}`,
  })

  return row
}

/** 這個作品存過的，最新的在前面。 */
export async function listReports(projectId: string): Promise<SavedReport[]> {
  const rows = await db
    .select({
      id: writerReports.id,
      episodeId: writerReports.episodeId,
      episodeNumber: episodes.number,
      kind: writerReports.kind,
      title: writerReports.title,
      payload: writerReports.payload,
      model: writerReports.model,
      createdByName: users.name,
      createdAt: writerReports.createdAt,
    })
    .from(writerReports)
    .leftJoin(episodes, eq(episodes.id, writerReports.episodeId))
    .leftJoin(users, eq(users.id, writerReports.createdById))
    .where(eq(writerReports.projectId, projectId))
    .orderBy(desc(writerReports.createdAt))
    .limit(200)

  return rows.map((row) => ({
    id: row.id,
    episodeId: row.episodeId,
    episodeNumber: row.episodeNumber,
    // 資料庫裡是 text，所以認不得的值要擋在這裡而不是讓畫面去猜。
    kind: (isReportKind(row.kind) ? row.kind : 'ASK') as WriterReportKind,
    title: row.title,
    payload: row.payload,
    model: row.model,
    createdByName: row.createdByName ?? '',
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function deleteReport(input: {
  projectId: string
  reportId: string
  user: SessionUser
}): Promise<void> {
  const [row] = await db
    .select({ id: writerReports.id, title: writerReports.title })
    .from(writerReports)
    .where(
      and(eq(writerReports.id, input.reportId), eq(writerReports.projectId, input.projectId))
    )
    .limit(1)
  if (!row) throw ApiError.notFound('找不到這一份')

  await db.delete(writerReports).where(eq(writerReports.id, input.reportId))

  await logActivity({
    user: input.user,
    action: 'delete',
    entityType: 'writer_report',
    entityId: input.reportId,
    projectId: input.projectId,
    summary: `${input.user.name} 刪掉了一份編劇整理：${row.title.slice(0, 60)}`,
  })
}
