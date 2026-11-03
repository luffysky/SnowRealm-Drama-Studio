import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { episodeProductionStages, episodes } from '@/db/schema'
import {
  DEFAULT_PER_PAGE,
  type EpisodeListResult,
  type EpisodeQuery,
  type EpisodeRow,
  type EpisodeStageCell,
  type EpisodeStats,
} from '@/lib/episode-view'
import {
  aggregateProgress,
  PRODUCTION_STAGE_KEYS,
  STAGES_PER_EPISODE,
  type ProductionStageStatus,
} from '@/lib/production'

/**
 * 集數管理 (design 05).
 *
 * Paging, searching and filtering all happen in SQL (spec v3 §11.1「分頁與搜尋
 * 在伺服器端完成」). 120 episodes would survive being loaded in one go, but the
 * number is this project's plan rather than a system limit, and a list that
 * only works while the data is small is a list that breaks the day it matters.
 *
 * Every query is scoped by `projectId`. Nothing here trusts that the caller
 * only ever asks for episodes it is allowed to see — `requireProjectPage` runs
 * first, and these conditions run again regardless.
 */

/** SQL for one stage's contribution, matching `stageFraction` exactly. */
const STAGE_FRACTION = sql<string>`
  case
    when ${episodeProductionStages.status} = 'completed' then 1.0
    when ${episodeProductionStages.status} = 'not_started' then 0.0
    else least(greatest(coalesce(${episodeProductionStages.progressPercent}, 0), 0), 100) / 100.0
  end
`

export * from '@/lib/episode-view'

export async function listEpisodes(
  projectId: string,
  query: EpisodeQuery = {}
): Promise<EpisodeListResult> {
  const perPage = query.perPage ?? DEFAULT_PER_PAGE
  const sort = query.sort ?? 'NUMBER_ASC'

  const scope = and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt))!

  const conditions: SQL[] = [scope]

  const search = query.search?.trim()
  if (search) {
    const like = `%${search}%`
    conditions.push(
      or(
        ilike(episodes.title, like),
        ilike(episodes.logline, like),
        ilike(episodes.synopsis, like),
        ilike(episodes.notes, like),
        // 「EP007」and「7」both find episode 7.
        sql`('EP' || lpad(${episodes.number}::text, 3, '0')) ilike ${like}`,
        sql`${episodes.number}::text = ${search}`
      )!
    )
  }

  if (query.status) conditions.push(eq(episodes.status, query.status))

  if (query.stage) {
    // "Show me what still needs 分鏡" — episodes whose named stage is unfinished.
    conditions.push(
      sql`exists (
        select 1 from ${episodeProductionStages} s
         where s.episode_id = ${episodes.id}
           and s.stage_key = ${query.stage}
           and s.status <> 'completed'
      )`
    )
  }

  const where = and(...conditions)!

  const [matchedRow] = await db
    .select({ n: count() })
    .from(episodes)
    .where(where)

  const matched = Number(matchedRow?.n ?? 0)
  const pageCount = Math.max(1, Math.ceil(matched / perPage))
  // A filter that shrinks the result set must not strand the reader on page 9.
  const page = Math.min(Math.max(query.page ?? 1, 1), pageCount)

  /** Progress per episode, computed in SQL so it can be sorted on. */
  const progressSub = db
    .select({
      episodeId: episodeProductionStages.episodeId,
      done: sql<string>`sum(${STAGE_FRACTION})`.as('done'),
    })
    .from(episodeProductionStages)
    .where(eq(episodeProductionStages.projectId, projectId))
    .groupBy(episodeProductionStages.episodeId)
    .as('progress')

  const orderBy = {
    NUMBER_ASC: [asc(episodes.number)],
    NUMBER_DESC: [desc(episodes.number)],
    PROGRESS_DESC: [desc(sql`coalesce(${progressSub.done}, 0)`), asc(episodes.number)],
    UPDATED_DESC: [desc(episodes.updatedAt), asc(episodes.number)],
  }[sort]

  const rows = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      logline: episodes.logline,
      status: episodes.status,
      coverAssetId: episodes.coverAssetId,
      dueDate: episodes.dueDate,
      updatedAt: episodes.updatedAt,
      done: sql<string>`coalesce(${progressSub.done}, 0)`,
    })
    .from(episodes)
    .leftJoin(progressSub, eq(progressSub.episodeId, episodes.id))
    .where(where)
    .orderBy(...orderBy)
    .limit(perPage)
    .offset((page - 1) * perPage)

  const stageRows =
    rows.length === 0
      ? []
      : await db
          .select({
            episodeId: episodeProductionStages.episodeId,
            stageKey: episodeProductionStages.stageKey,
            status: episodeProductionStages.status,
            progressPercent: episodeProductionStages.progressPercent,
          })
          .from(episodeProductionStages)
          .where(
            and(
              eq(episodeProductionStages.projectId, projectId),
              inArray(
                episodeProductionStages.episodeId,
                rows.map((r) => r.id)
              )
            )
          )

  const stagesByEpisode = new Map<string, Map<string, EpisodeStageCell>>()
  for (const row of stageRows) {
    const map = stagesByEpisode.get(row.episodeId) ?? new Map<string, EpisodeStageCell>()
    map.set(row.stageKey, {
      key: row.stageKey,
      status: row.status,
      progressPercent: row.progressPercent,
    })
    stagesByEpisode.set(row.episodeId, map)
  }

  return {
    rows: rows.map((row) => {
      const found = stagesByEpisode.get(row.id)
      return {
        id: row.id,
        number: row.number,
        title: row.title,
        logline: row.logline,
        status: row.status,
        coverAssetId: row.coverAssetId,
        dueDate: row.dueDate,
        updatedAt: row.updatedAt,
        progress: aggregateProgress(Number(row.done), STAGES_PER_EPISODE),
        // Nine cells always: a missing row is unstarted work, not a gap.
        stages: PRODUCTION_STAGE_KEYS.map(
          (key) =>
            found?.get(key) ?? {
              key,
              status: 'not_started' as ProductionStageStatus,
              progressPercent: 0,
            }
        ),
      }
    }),
    matched,
    page,
    perPage,
    pageCount,
    stats: await episodeStats(projectId),
  }
}

/**
 * Headline figures for the whole project, never narrowed by the active filter.
 *
 * The same reasoning as the status pills on 作品列表: a count that moves when
 * you filter cannot be used to decide what to filter by.
 */
export async function episodeStats(projectId: string): Promise<EpisodeStats> {
  const scope = and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt))!

  const [totals] = await db
    .select({
      total: count(),
      done: sql<number>`count(*) filter (where ${episodes.status} = 'DONE')`.mapWith(Number),
      inProgress: sql<number>`count(*) filter (where ${episodes.status} in ('WRITING','STORYBOARD','PRODUCTION','REVIEW'))`.mapWith(
        Number
      ),
    })
    .from(episodes)
    .where(scope)

  const [stageSum] = await db
    .select({ done: sql<string>`coalesce(sum(${STAGE_FRACTION}), 0)` })
    .from(episodeProductionStages)
    .innerJoin(episodes, eq(episodes.id, episodeProductionStages.episodeId))
    .where(scope)

  const total = Number(totals?.total ?? 0)
  const done = Number(totals?.done ?? 0)
  const inProgress = Number(totals?.inProgress ?? 0)

  return {
    total,
    done,
    inProgress,
    pending: Math.max(total - done - inProgress, 0),
    overallProgress: aggregateProgress(Number(stageSum?.done ?? 0), total * STAGES_PER_EPISODE),
  }
}

/** One episode with its stages, for the detail rail. */
export async function getEpisodeDetail(
  projectId: string,
  episodeId: string
): Promise<EpisodeRow | null> {
  const result = await listEpisodes(projectId, { perPage: 50 })
  const found = result.rows.find((row) => row.id === episodeId)
  if (found) return found

  // Not on the current page: fetch it directly rather than paging to find it.
  const [row] = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      logline: episodes.logline,
      status: episodes.status,
      coverAssetId: episodes.coverAssetId,
      dueDate: episodes.dueDate,
      updatedAt: episodes.updatedAt,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt)
      )
    )
    .limit(1)

  if (!row) return null

  const stages = await db
    .select({
      stageKey: episodeProductionStages.stageKey,
      status: episodeProductionStages.status,
      progressPercent: episodeProductionStages.progressPercent,
    })
    .from(episodeProductionStages)
    .where(
      and(
        eq(episodeProductionStages.projectId, projectId),
        eq(episodeProductionStages.episodeId, episodeId)
      )
    )

  const byKey = new Map(stages.map((s) => [s.stageKey, s]))
  const cells: EpisodeStageCell[] = PRODUCTION_STAGE_KEYS.map((key) => {
    const found2 = byKey.get(key)
    return {
      key,
      status: found2?.status ?? 'not_started',
      progressPercent: found2?.progressPercent ?? 0,
    }
  })

  return {
    ...row,
    progress: aggregateProgress(
      cells.reduce(
        (sum, c) =>
          sum +
          (c.status === 'completed'
            ? 1
            : c.status === 'not_started'
              ? 0
              : Math.min(Math.max(c.progressPercent, 0), 100) / 100),
        0
      ),
      STAGES_PER_EPISODE
    ),
    stages: cells,
  }
}

/* -------------------------------------------------------------------------- */
/* 大綱 (outline)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One episode's outline row.
 *
 * The outline is not a new table. An episode already carries `title`,
 * `logline` and `synopsis`; a separate 大綱 record would immediately raise the
 * question of which copy is authoritative, and the answer is always "the one
 * the episode itself holds".
 */
export type OutlineRow = {
  id: string
  number: number
  title: string
  logline: string
  synopsis: string
  status: string
  /** Whether prose exists yet, so the outline view can show what is written. */
  charCount: number
  updatedAt: Date
}

export async function listOutline(
  projectId: string,
  range?: { from?: number; to?: number }
): Promise<OutlineRow[]> {
  const conditions: SQL[] = [eq(episodes.projectId, projectId)]

  const notDeleted = isNull(episodes.deletedAt)
  if (notDeleted) conditions.push(notDeleted)
  if (range?.from !== undefined) conditions.push(sql`${episodes.number} >= ${range.from}`)
  if (range?.to !== undefined) conditions.push(sql`${episodes.number} <= ${range.to}`)

  const rows = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      logline: episodes.logline,
      synopsis: episodes.synopsis,
      status: episodes.status,
      updatedAt: episodes.updatedAt,
      charCount: sql<number>`(
        select coalesce(max(char_count), 0) from documents
         where documents.episode_id = ${episodes.id}
           and documents.kind = 'NOVEL'
           and documents.deleted_at is null
      )`.mapWith(Number),
    })
    .from(episodes)
    .where(and(...conditions))
    .orderBy(asc(episodes.number))

  return rows
}

export type OutlineEdit = {
  title?: string
  logline?: string
  synopsis?: string
}

/**
 * Saves one episode's outline.
 *
 * Scoped by `projectId` as well as id: an episode id from another project must
 * not be writable just because the caller guessed it (`docs/ROUTES.md` §5).
 * Returns null when the episode is not in this project, so the caller answers
 * 404 rather than distinguishing "wrong project" from "no such episode".
 */
export async function updateOutline(
  projectId: string,
  episodeId: string,
  edit: OutlineEdit
): Promise<OutlineRow | null> {
  if (edit.title === undefined && edit.logline === undefined && edit.synopsis === undefined) {
    return null
  }

  const [row] = await db
    .update(episodes)
    .set({
      ...(edit.title !== undefined ? { title: edit.title } : {}),
      ...(edit.logline !== undefined ? { logline: edit.logline } : {}),
      ...(edit.synopsis !== undefined ? { synopsis: edit.synopsis } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt)
      )
    )
    .returning({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      logline: episodes.logline,
      synopsis: episodes.synopsis,
      status: episodes.status,
      updatedAt: episodes.updatedAt,
    })

  return row ? { ...row, charCount: 0 } : null
}

/** How much of the outline is actually written, for the workbench header. */
export async function outlineProgress(projectId: string): Promise<{
  total: number
  withLogline: number
  withSynopsis: number
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      withLogline: sql<number>`count(*) filter (where length(trim(logline)) > 0)`.mapWith(Number),
      withSynopsis: sql<number>`count(*) filter (where length(trim(synopsis)) > 0)`.mapWith(
        Number
      ),
    })
    .from(episodes)
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))

  return {
    total: row?.total ?? 0,
    withLogline: row?.withLogline ?? 0,
    withSynopsis: row?.withSynopsis ?? 0,
  }
}

/**
 * Applies many outline edits at once.
 *
 * One transaction, because adopting an AI-generated outline for ten episodes
 * is one decision by the writer: half-applied is worse than not applied, and
 * leaves them guessing which half.
 *
 * Returns how many rows actually changed — an id from another project simply
 * matches nothing, so a hand-crafted request cannot reach across the boundary.
 */
export async function applyOutline(
  projectId: string,
  edits: { episodeId: string; title?: string; logline?: string; synopsis?: string }[]
): Promise<{ applied: number }> {
  if (edits.length === 0) return { applied: 0 }

  return db.transaction(async (tx) => {
    let applied = 0

    for (const edit of edits) {
      const [row] = await tx
        .update(episodes)
        .set({
          ...(edit.title !== undefined ? { title: edit.title } : {}),
          ...(edit.logline !== undefined ? { logline: edit.logline } : {}),
          ...(edit.synopsis !== undefined ? { synopsis: edit.synopsis } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(episodes.id, edit.episodeId),
            eq(episodes.projectId, projectId),
            isNull(episodes.deletedAt)
          )
        )
        .returning({ id: episodes.id })

      if (row) applied += 1
    }

    return { applied }
  })
}
