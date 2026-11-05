import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { arcs, episodes, projects } from '@/db/schema'
import { episodeStats } from '@/lib/episodes'
import { visibleProjects } from '@/lib/project-access'
import {
  outlineDigest,
  progressDigest,
  projectBriefDigest,
  type ProgressDigestTask,
} from './digest'

/**
 * `digest.ts` 的查資料那一半 (Z153).
 *
 * 分成兩支檔案不是潔癖：`digest.ts` 的純函式要被用戶端元件叫（整份大綱本
 * 來就在瀏覽器手上，不必再往返一趟），而只要那支檔案 import 了 `@/db`，
 * Next 就會拒絕打包。
 */

/** 整部作品的大綱，不分頁——審視要看的就是「整體節奏」。 */
export async function fetchOutlineDigest(projectId: string): Promise<string> {
  const [project] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) return ''

  const rows = await db
    .select({
      number: episodes.number,
      title: episodes.title,
      logline: episodes.logline,
      synopsis: episodes.synopsis,
    })
    .from(episodes)
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number))

  return outlineDigest(project.title, rows)
}

/**
 * 「這部作品現在是什麼」，給作品企劃讀。
 *
 * 只送摘要，不送整份大綱：企劃談的是賣點、受眾與分部規劃，而 120 集的大綱
 * 全文會把這一次請求變成最貴的一次，換來的多半是模型複述劇情。世界觀與角色
 * 由 `buildContext` 另外送。
 */
export async function fetchProjectBriefDigest(projectId: string): Promise<string> {
  const [project] = await db
    .select({
      title: projects.title,
      logline: projects.logline,
      synopsis: projects.synopsis,
      genre: projects.genre,
      tags: projects.tags,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) return ''

  /*
   * 規劃集數在**卷**上，不在作品上（一部作品可以有好幾卷）。加總而不是取
   * 第一卷：企劃談的是整部作品的規模。
   */
  const [planned] = await db
    .select({ total: sql<number>`coalesce(sum(${arcs.plannedEpisodes}), 0)`.mapWith(Number) })
    .from(arcs)
    .where(and(eq(arcs.projectId, projectId), isNull(arcs.deletedAt)))

  const [counts] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      withOutline: sql<number>`count(*) filter (
        where coalesce(trim(${episodes.logline}), '') <> ''
           or coalesce(trim(${episodes.synopsis}), '') <> ''
      )`.mapWith(Number),
    })
    .from(episodes)
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))

  return projectBriefDigest({
    title: project.title,
    logline: project.logline,
    synopsis: project.synopsis,
    tags: [project.genre, ...(project.tags ?? [])].filter(Boolean),
    episodeCount: counts?.total ?? 0,
    plannedEpisodes: planned?.total ?? 0,
    episodesWithOutline: counts?.withOutline ?? 0,
  })
}

/** 看板加上每部作品的集數統計，給任務建議。 */
export async function fetchProgressDigest(input: {
  userId: string
  tasks: readonly ProgressDigestTask[]
  overdue: number
  today?: Date
}): Promise<string> {
  const projectRows = await db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(visibleProjects(input.userId), isNull(projects.deletedAt)))
    .orderBy(asc(projects.createdAt))

  /*
   * 一部作品一次 `episodeStats`。兩人團隊手上是兩部作品，所以這裡是兩次
   * 查詢而不是 N+1 的那種 N——真的長到幾十部再來合併成一支聚合查詢。
   */
  const withStats = await Promise.all(
    projectRows.map(async (row) => {
      const stats = await episodeStats(row.id)
      return {
        title: row.title,
        total: stats.total,
        done: stats.done,
        inProgress: stats.inProgress,
        pending: stats.pending,
        overallProgress: stats.overallProgress,
      }
    })
  )

  return progressDigest({
    projects: withStats,
    tasks: input.tasks,
    overdue: input.overdue,
    today: input.today ?? new Date(),
  })
}
