import { and, asc, count, eq, gte, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  episodeProductionStages,
  episodes,
  productionMilestones,
  productionProgressEvents,
} from '@/db/schema'
import { episodeStats, type EpisodeStats } from '@/lib/episodes'
import {
  aggregateProgress,
  PRODUCTION_STAGE_KEYS,
  type ProductionStageKey,
} from '@/lib/production'

/**
 * 製作進度管理 (design 17).
 *
 * Aggregates for one project. The episode table itself reuses `listEpisodes`
 * from 集數管理 — it is the same query with two more columns, and two
 * implementations of "which episodes, in what order" would drift.
 */

export type StageCompletion = {
  key: ProductionStageKey
  /** 0–1, completed equivalents over the project's episode count. */
  progress: number
  /** Whole episodes finished at this stage. */
  done: number
  total: number
}

export type ProgressTrendPoint = {
  label: string
  completed: number
  started: number
  cumulative: number
}

export type MilestoneRow = {
  id: string
  title: string
  episodeFrom: number | null
  episodeTo: number | null
  stageKey: ProductionStageKey | null
  targetDate: Date | null
  completedAt: Date | null
  /** 0–1 across the episodes and stage the milestone covers. */
  progress: number
}

export type ProductionProgress = {
  stageCompletion: StageCompletion[]
  stageRecords: number
  overallProgress: number
  episodeStats: EpisodeStats
  trend: ProgressTrendPoint[]
  hasTrendHistory: boolean
  milestones: MilestoneRow[]
}

const STAGE_FRACTION = sql<string>`
  case
    when ${episodeProductionStages.status} = 'completed' then 1.0
    when ${episodeProductionStages.status} = 'not_started' then 0.0
    else least(greatest(coalesce(${episodeProductionStages.progressPercent}, 0), 0), 100) / 100.0
  end
`

export async function getProductionProgress(
  projectId: string,
  trendDays = 30
): Promise<ProductionProgress> {
  const windowStart = new Date(Date.now() - trendDays * 86_400_000)

  const [stageRows, stats, trendRows, anyEvent, milestoneRows] = await Promise.all([
    db
      .select({
        stageKey: episodeProductionStages.stageKey,
        total: count(),
        done: sql<string>`sum(${STAGE_FRACTION})`,
        completed: sql<number>`count(*) filter (where ${episodeProductionStages.status} = 'completed')`.mapWith(
          Number
        ),
      })
      .from(episodeProductionStages)
      .innerJoin(episodes, eq(episodes.id, episodeProductionStages.episodeId))
      .where(and(eq(episodeProductionStages.projectId, projectId), isNull(episodes.deletedAt)))
      .groupBy(episodeProductionStages.stageKey),

    episodeStats(projectId),

    db
      .select({
        day: sql<string>`to_char(${productionProgressEvents.createdAt} at time zone 'Asia/Taipei', 'MM/DD')`,
        completed: sql<number>`count(*) filter (where ${productionProgressEvents.toStatus} = 'completed')`.mapWith(
          Number
        ),
        started: sql<number>`count(*) filter (where ${productionProgressEvents.toStatus} = 'in_progress')`.mapWith(
          Number
        ),
      })
      .from(productionProgressEvents)
      .where(
        and(
          eq(productionProgressEvents.projectId, projectId),
          gte(productionProgressEvents.createdAt, windowStart)
        )
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`),

    db
      .select({ id: productionProgressEvents.id })
      .from(productionProgressEvents)
      .where(eq(productionProgressEvents.projectId, projectId))
      .limit(1),

    db
      .select({
        id: productionMilestones.id,
        title: productionMilestones.title,
        episodeFrom: productionMilestones.episodeFrom,
        episodeTo: productionMilestones.episodeTo,
        stageKey: productionMilestones.stageKey,
        targetDate: productionMilestones.targetDate,
        completedAt: productionMilestones.completedAt,
      })
      .from(productionMilestones)
      .where(eq(productionMilestones.projectId, projectId))
      .orderBy(asc(productionMilestones.targetDate)),
  ])

  const byKey = new Map(stageRows.map((r) => [r.stageKey, r]))
  const episodeCount = stats.total

  const stageCompletion: StageCompletion[] = PRODUCTION_STAGE_KEYS.map((key) => {
    const row = byKey.get(key)
    // Denominator is the episode count, so a stage whose rows were never
    // created reads as unstarted rather than as absent.
    const total = Math.max(episodeCount, Number(row?.total ?? 0))
    return {
      key,
      progress: aggregateProgress(Number(row?.done ?? 0), total),
      done: Number(row?.completed ?? 0),
      total,
    }
  })

  const stageRecords = stageCompletion.reduce((n, s) => n + s.total, 0)
  const equivalents = stageCompletion.reduce((n, s) => n + s.progress * s.total, 0)

  let running = 0
  const trend: ProgressTrendPoint[] = trendRows.map((row) => {
    running += Number(row.completed)
    return {
      label: row.day,
      completed: Number(row.completed),
      started: Number(row.started),
      cumulative: stageRecords > 0 ? Math.min(running / stageRecords, 1) : 0,
    }
  })

  const milestones = await Promise.all(
    milestoneRows.map(async (row) => ({
      ...row,
      progress: await milestoneProgress(projectId, row),
    }))
  )

  return {
    stageCompletion,
    stageRecords,
    overallProgress: aggregateProgress(equivalents, stageRecords),
    episodeStats: stats,
    trend,
    hasTrendHistory: anyEvent.length > 0,
    milestones,
  }
}

/**
 * How far a milestone's slice of work has got.
 *
 * Scoped by the milestone's episode range and stage, so「EP001–EP020 的分鏡」
 * is measured against those 20 stage rows and nothing else.
 */
async function milestoneProgress(
  projectId: string,
  milestone: {
    episodeFrom: number | null
    episodeTo: number | null
    stageKey: ProductionStageKey | null
  }
): Promise<number> {
  const conditions = [
    eq(episodeProductionStages.projectId, projectId),
    isNull(episodes.deletedAt),
  ]

  if (milestone.episodeFrom !== null) {
    conditions.push(gte(episodes.number, milestone.episodeFrom))
  }
  if (milestone.episodeTo !== null) {
    conditions.push(sql`${episodes.number} <= ${milestone.episodeTo}`)
  }
  if (milestone.stageKey) {
    conditions.push(eq(episodeProductionStages.stageKey, milestone.stageKey))
  }

  const [row] = await db
    .select({ total: count(), done: sql<string>`coalesce(sum(${STAGE_FRACTION}), 0)` })
    .from(episodeProductionStages)
    .innerJoin(episodes, eq(episodes.id, episodeProductionStages.episodeId))
    .where(and(...conditions))

  return aggregateProgress(Number(row?.done ?? 0), Number(row?.total ?? 0))
}
