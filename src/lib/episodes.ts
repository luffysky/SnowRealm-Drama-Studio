import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { arcs, assets, episodeProductionStages, episodes } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import type { EpisodeStatusValue } from '@/lib/constants'
import {
  DEFAULT_PER_PAGE,
  type EpisodeListResult,
  type EpisodeQuery,
  type EpisodeRow,
  type EpisodeStageCell,
  type EpisodeSegment,
  type EpisodeStats,
  type StageColumn,
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

  /*
   * 卷 is a container and nothing else (Z128), so filtering by it is a plain
   * equality on `arc_id` — no join, and nothing here depends on the episode
   * numbers being contiguous within it.
   */
  if (query.arcId) conditions.push(eq(episodes.arcId, query.arcId))

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
            note: episodeProductionStages.note,
            assigneeId: episodeProductionStages.assigneeId,
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
      note: row.note,
      assigneeId: row.assigneeId,
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
              note: '',
              assigneeId: null,
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

export type EpisodeEditable = {
  id: string
  number: number
  arcId: string
  title: string
  logline: string
  synopsis: string
  notes: string
  targetSec: number
  status: EpisodeStatusValue
  dueDate: Date | null
}

/**
 * 一集可編輯的全部欄位 (Z35/Z36).
 *
 * 跟 `EpisodeRow` 分開查，因為 `synopsis` 一集可以到五千字——列表一頁二十
 * 筆就是十萬字，而列表一個字都不顯示它。只有被選中的那一集需要。
 */
export async function episodeEditable(
  projectId: string,
  episodeId: string
): Promise<EpisodeEditable | null> {
  const [row] = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      arcId: episodes.arcId,
      title: episodes.title,
      logline: episodes.logline,
      synopsis: episodes.synopsis,
      notes: episodes.notes,
      targetSec: episodes.targetSec,
      status: episodes.status,
      dueDate: episodes.dueDate,
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

  return row ? { ...row, status: row.status as EpisodeStatusValue } : null
}

/**
 * 改一集 (Z35).
 *
 * 集號**不給改**：`episodes.number` 是小說、劇本、分鏡、有聲書與正文裡每一句
 * 「第 007 集」共用的編號，改它等於把那些全部指向別處，而沒有任何一個會跟著
 * 動。要調順序是「搬卷」或重新規劃，不是改這個欄位（Z128 也是這個結論）。
 */
export async function updateEpisode(input: {
  projectId: string
  episodeId: string
  patch: {
    title?: string
    logline?: string
    synopsis?: string
    notes?: string
    targetSec?: number
    status?: EpisodeStatusValue
    arcId?: string
    dueDate?: string | null
  }
  user: SessionUser
}): Promise<{ id: string }> {
  const existing = await episodeEditable(input.projectId, input.episodeId)
  if (!existing) throw ApiError.notFound('找不到這一集')

  // 搬到別卷的時候，那一卷也要屬於這部作品。
  if (input.patch.arcId && input.patch.arcId !== existing.arcId) {
    const [arc] = await db
      .select({ id: arcs.id })
      .from(arcs)
      .where(
        and(
          eq(arcs.id, input.patch.arcId),
          eq(arcs.projectId, input.projectId),
          isNull(arcs.deletedAt)
        )
      )
      .limit(1)
    if (!arc) throw ApiError.notFound('找不到這個卷')
  }

  const due =
    input.patch.dueDate === null
      ? null
      : input.patch.dueDate
        ? new Date(input.patch.dueDate)
        : undefined

  await db
    .update(episodes)
    .set({
      ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
      ...(input.patch.logline !== undefined ? { logline: input.patch.logline } : {}),
      ...(input.patch.synopsis !== undefined ? { synopsis: input.patch.synopsis } : {}),
      ...(input.patch.notes !== undefined ? { notes: input.patch.notes } : {}),
      ...(input.patch.targetSec !== undefined ? { targetSec: input.patch.targetSec } : {}),
      ...(input.patch.status !== undefined ? { status: input.patch.status } : {}),
      ...(input.patch.arcId !== undefined ? { arcId: input.patch.arcId } : {}),
      ...(due !== undefined ? { dueDate: due && !Number.isNaN(due.getTime()) ? due : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(episodes.id, input.episodeId))

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'episode',
    entityId: input.episodeId,
    projectId: input.projectId,
    summary: `${input.user.name} 編輯了第 ${existing.number} 集`,
  })

  return { id: input.episodeId }
}

/**
 * 把集數切成固定大小的段 (Z37, 分段檢視).
 *
 * 120 集的清單一次只看得到二十筆，而「做到哪裡了」是一個整體的問題。切成
 * 十二段之後，哪一段卡住一眼就看得出來。
 *
 * 在 SQL 裡分段，不是把 120 集讀出來在記憶體裡分：這個檢視只需要每一段的
 * 四個數字，而集數列帶著 logline 與九筆階段。
 */
export async function episodeSegments(
  projectId: string,
  size = 10
): Promise<EpisodeSegment[]> {
  /*
   * 段大小內嵌成字面值，不走參數 (Z37).
   *
   * 寫成 `${size}` 的時候 Drizzle 會綁成 `$1`，而 SELECT 與 GROUP BY 各出現
   * 一次就是兩個不同的參數位置——Postgres 因此無法認定那是同一個運算式，回
   * 「column must appear in the GROUP BY clause」。
   *
   * 內嵌安全，因為這裡先驗證它是正整數；`size` 也只由伺服器端呼叫端決定。
   */
  const step = Math.max(1, Math.floor(size))
  const bucket = sql<number>`((${episodes.number} - 1) / ${sql.raw(String(step))})::int`

  /*
   * 兩段查詢，不是一段帶相關子查詢。
   *
   * 第一版把 `STAGE_FRACTION` 塞進一個別名為 `s` 的子查詢裡，而那個常數是
   * 用 `episodeProductionStages` 的欄位組的——Drizzle 會展開成未別名的
   * `episode_production_stages.status`，於是 Postgres 回 `missing RTE`。
   * 分成兩段各自 group by 同一個 bucket 再合併，沒有別名可以對錯。
   */
  const counts = await db
    .select({
      bucket: bucket.as('bucket'),
      from: sql<number>`min(${episodes.number})`.mapWith(Number),
      to: sql<number>`max(${episodes.number})`.mapWith(Number),
      total: sql<number>`count(*)`.mapWith(Number),
      done: sql<number>`count(*) filter (where ${episodes.status} = 'DONE')`.mapWith(Number),
      inProgress: sql<number>`count(*) filter (
        where ${episodes.status} in ('WRITING','STORYBOARD','PRODUCTION','REVIEW')
      )`.mapWith(Number),
    })
    .from(episodes)
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .groupBy(bucket)
    .orderBy(bucket)

  const fractions = await db
    .select({
      bucket: bucket.as('bucket'),
      done: sql<string>`coalesce(sum(${STAGE_FRACTION}), 0)`,
    })
    .from(episodeProductionStages)
    .innerJoin(episodes, eq(episodes.id, episodeProductionStages.episodeId))
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .groupBy(bucket)

  const doneByBucket = new Map(fractions.map((row) => [row.bucket, Number(row.done ?? 0)]))

  return counts.map((row) => ({
    from: row.from,
    to: row.to,
    total: row.total,
    done: row.done,
    inProgress: row.inProgress,
    pending: Math.max(row.total - row.done - row.inProgress, 0),
    progress: aggregateProgress(
      doneByBucket.get(row.bucket) ?? 0,
      row.total * STAGES_PER_EPISODE
    ),
  }))
}

/**
 * 每個階段跨全作品的完成度 (Z37, 進度總覽).
 *
 * 比 `getProductionProgress()` 輕：那一支還要算趨勢、里程碑與集數統計，而這
 * 個檢視只要九個數字。分母用集數而不是階段列數——階段列沒建出來的那幾集要
 * 讀成「還沒開始」，不是「不存在」（跟 production-progress 同一個判斷）。
 */
export async function stageCompletion(projectId: string): Promise<StageColumn[]> {
  const scope = and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt))!

  const [[totals], rows] = await Promise.all([
    db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(episodes).where(scope),
    db
      .select({
        key: episodeProductionStages.stageKey,
        done: sql<string>`coalesce(sum(${STAGE_FRACTION}), 0)`,
        completed: sql<number>`count(*) filter (
          where ${episodeProductionStages.status} = 'completed'
        )`.mapWith(Number),
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(episodeProductionStages)
      .innerJoin(episodes, eq(episodes.id, episodeProductionStages.episodeId))
      .where(scope)
      .groupBy(episodeProductionStages.stageKey),
  ])

  const episodeCount = totals?.n ?? 0
  const byKey = new Map(rows.map((row) => [row.key, row]))

  return PRODUCTION_STAGE_KEYS.map((key) => {
    const row = byKey.get(key)
    const total = Math.max(episodeCount, Number(row?.total ?? 0))
    return {
      key,
      done: Number(row?.completed ?? 0),
      total,
      progress: aggregateProgress(Number(row?.done ?? 0), total),
    }
  })
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
      note: episodeProductionStages.note,
      assigneeId: episodeProductionStages.assigneeId,
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
      note: found2?.note ?? '',
      assigneeId: found2?.assigneeId ?? null,
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

/* -------------------------------------------------------------------------- */
/* 成片 (Z1)                                                                    */
/* -------------------------------------------------------------------------- */

export type FinalCut = {
  assetId: string
  name: string
  title: string
  sizeBytes: number
  durationSec: number | null
  version: number
  uploadedAt: Date
}

/**
 * Sets or clears an episode's finished cut.
 *
 * The asset is checked rather than trusted, for the same reason the cover is:
 * `final_asset_id` carries no foreign key and no type constraint, so the
 * database would happily accept a still image, a half-finished upload, or a
 * video belonging to another project.
 *
 * Returns null when the episode is not in this project, so the caller answers
 * 404 instead of distinguishing "wrong project" from "no such episode".
 */
export async function updateEpisodeFinalCut(
  projectId: string,
  episodeId: string,
  assetId: string | null
): Promise<{ id: string; finalAssetId: string | null } | null> {
  if (assetId) {
    const [asset] = await db
      .select({
        id: assets.id,
        kind: assets.kind,
        status: assets.uploadStatus,
      })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.projectId, projectId)))
      .limit(1)

    if (!asset) {
      throw new ApiError(400, '找不到這個檔案，或它不屬於這部作品', 'final_cut_not_found')
    }
    if (asset.status !== 'COMPLETED') {
      throw new ApiError(409, '這個檔案還沒上傳完成', 'final_cut_incomplete')
    }
    if (asset.kind !== 'VIDEO') {
      throw new ApiError(400, '成片必須是影片檔', 'final_cut_not_video')
    }
  }

  const [row] = await db
    .update(episodes)
    .set({ finalAssetId: assetId, updatedAt: new Date() })
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt)
      )
    )
    .returning({ id: episodes.id, finalAssetId: episodes.finalAssetId })

  return row ?? null
}

/**
 * The current cut and every earlier one, newest first.
 *
 * Earlier cuts come from the asset lineage (`root_asset_id`), not from a
 * history table: a re-edit is a new file, and the generic asset versioning
 * already models exactly that.
 */
export async function episodeCuts(
  projectId: string,
  episodeId: string
): Promise<{ current: FinalCut | null; history: FinalCut[] }> {
  const [episode] = await db
    .select({ finalAssetId: episodes.finalAssetId })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.projectId, projectId)))
    .limit(1)

  const rows = await db
    .select({
      assetId: assets.id,
      name: assets.name,
      title: assets.title,
      sizeBytes: assets.sizeBytes,
      durationSec: assets.durationSec,
      version: assets.version,
      uploadedAt: assets.createdAt,
    })
    .from(assets)
    .where(
      and(
        eq(assets.projectId, projectId),
        eq(assets.episodeId, episodeId),
        eq(assets.kind, 'VIDEO'),
        eq(assets.uploadStatus, 'COMPLETED'),
        isNull(assets.deletedAt)
      )
    )
    .orderBy(desc(assets.version), desc(assets.createdAt))

  const current = rows.find((row) => row.assetId === episode?.finalAssetId) ?? null

  return {
    current,
    // Everything else that could be promoted to the current cut.
    history: rows.filter((row) => row.assetId !== current?.assetId),
  }
}
