import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  activities,
  episodeProductionStages,
  episodes,
  productionProgressEvents,
  projects,
  tasks,
} from '@/db/schema'
import type { ProjectStatusValue } from '@/lib/constants'
import {
  aggregateProgress,
  PRODUCTION_STAGE_KEYS,
  STAGES_PER_EPISODE,
  type ProductionStageKey,
} from '@/lib/production'
import { visibleProjects } from '@/lib/project-access'

/**
 * 全域工作室儀表板 (design 01 v2).
 *
 * Cross-project only. Spec v3 §11.3 is explicit that this page must not offer
 * single-project editors, and that its figures come from real projects — the
 * second show in the reference art is not data.
 *
 * Every aggregate here follows the completion contract in
 * `src/lib/production.ts`: equivalents over effective stages, never the mean of
 * per-project percentages, which would let a one-episode project outvote a
 * 120-episode one.
 */

export type DashboardProject = {
  id: string
  title: string
  /** Empty = same as `title`. Read through `@/lib/project-titles`. */
  novelTitle: string
  dramaTitle: string
  status: ProjectStatusValue
  tags: string[]
  coverAssetId: string | null
  episodeCount: number
  plannedEpisodes: number
  stageRecords: number
  progress: number
}

export type DashboardTask = {
  id: string
  title: string
  projectId: string | null
  projectTitle: string
  dueDate: Date | null
  dueInDays: number | null
  priority: string
}

export type DashboardRisk = {
  id: string
  tone: 'high' | 'medium' | 'info'
  projectTitle: string
  text: string
}

export type TrendPoint = {
  /** `MM/DD`, already formatted in Asia/Taipei. */
  label: string
  completed: number
  started: number
  /** Cumulative completion across the window, 0–1. */
  cumulative: number
}

export type DashboardData = {
  activeProjects: number
  totalProjects: number
  totalEpisodes: number
  stageRecords: number
  /** 0–1 across every effective stage of every visible project. */
  overallProgress: number
  stageTotals: { completed: number; inProgress: number; pending: number }
  projects: DashboardProject[]
  statusCounts: Record<string, number>
  stageBreakdown: { key: ProductionStageKey; done: number; total: number }[]
  tasks: DashboardTask[]
  risks: DashboardRisk[]
  trend: TrendPoint[]
  /** Null when no stage has ever changed — the trend has nothing to draw. */
  trendStartedAt: Date | null
  recentActivity: { id: string; summary: string; userName: string; createdAt: Date }[]
}

const STAGE_FRACTION = sql<string>`
  case
    when ${episodeProductionStages.status} = 'completed' then 1.0
    when ${episodeProductionStages.status} = 'not_started' then 0.0
    else least(greatest(coalesce(${episodeProductionStages.progressPercent}, 0), 0), 100) / 100.0
  end
`

export async function getDashboard(userId: string, trendDays = 30): Promise<DashboardData> {
  const visible = visibleProjects(userId)

  const projectRows = await db
    .select({
      id: projects.id,
      title: projects.title,
      novelTitle: projects.novelTitle,
      dramaTitle: projects.dramaTitle,
      status: projects.status,
      tags: projects.tags,
      coverAssetId: projects.coverAssetId,
    })
    .from(projects)
    .where(visible)
    .orderBy(desc(projects.isFlagship), desc(projects.updatedAt))

  const ids = projectRows.map((row) => row.id)

  if (ids.length === 0) {
    return {
      activeProjects: 0,
      totalProjects: 0,
      totalEpisodes: 0,
      stageRecords: 0,
      overallProgress: 0,
      stageTotals: { completed: 0, inProgress: 0, pending: 0 },
      projects: [],
      statusCounts: {},
      stageBreakdown: PRODUCTION_STAGE_KEYS.map((key) => ({ key, done: 0, total: 0 })),
      tasks: [],
      risks: [],
      trend: [],
      trendStartedAt: null,
      recentActivity: [],
    }
  }

  const windowStart = new Date(Date.now() - trendDays * 86_400_000)

  const [
    episodeRows,
    stageRows,
    stageByKey,
    taskRows,
    blockedRows,
    trendRows,
    firstEvent,
    recent,
  ] = await Promise.all([
    db
      .select({ projectId: episodes.projectId, n: count() })
      .from(episodes)
      .where(and(inArray(episodes.projectId, ids), isNull(episodes.deletedAt)))
      .groupBy(episodes.projectId),

    db
      .select({
        projectId: episodeProductionStages.projectId,
        total: count(),
        done: sql<string>`sum(${STAGE_FRACTION})`,
        completed: sql<number>`count(*) filter (where ${episodeProductionStages.status} = 'completed')`.mapWith(
          Number
        ),
        inProgress: sql<number>`count(*) filter (where ${episodeProductionStages.status} in ('in_progress','in_review','blocked'))`.mapWith(
          Number
        ),
      })
      .from(episodeProductionStages)
      .where(inArray(episodeProductionStages.projectId, ids))
      .groupBy(episodeProductionStages.projectId),

    db
      .select({
        stageKey: episodeProductionStages.stageKey,
        total: count(),
        done: sql<string>`sum(${STAGE_FRACTION})`,
      })
      .from(episodeProductionStages)
      .where(inArray(episodeProductionStages.projectId, ids))
      .groupBy(episodeProductionStages.stageKey),

    db
      .select({
        id: tasks.id,
        title: tasks.title,
        projectId: tasks.projectId,
        dueDate: tasks.dueDate,
        priority: tasks.priority,
      })
      .from(tasks)
      .where(
        and(inArray(tasks.projectId, ids), isNull(tasks.deletedAt), ne(tasks.status, 'DONE'))
      )
      .orderBy(sql`${tasks.dueDate} asc nulls last`)
      .limit(8),

    db
      .select({
        projectId: episodeProductionStages.projectId,
        stageKey: episodeProductionStages.stageKey,
        n: count(),
      })
      .from(episodeProductionStages)
      .where(
        and(
          inArray(episodeProductionStages.projectId, ids),
          eq(episodeProductionStages.status, 'blocked')
        )
      )
      .groupBy(episodeProductionStages.projectId, episodeProductionStages.stageKey),

    /*
     * The 30-day trend comes from the audit table, which is the only place that
     * records *when* a stage moved. Nothing is reconstructed from the current
     * state: a stage finished last week and one finished today look identical
     * in `episode_production_stages`, so inventing a curve from it would be
     * fabrication.
     */
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
          inArray(productionProgressEvents.projectId, ids),
          gte(productionProgressEvents.createdAt, windowStart)
        )
      )
      .groupBy(sql`1`)
      .orderBy(sql`1`),

    db
      .select({ at: productionProgressEvents.createdAt })
      .from(productionProgressEvents)
      .where(inArray(productionProgressEvents.projectId, ids))
      .orderBy(productionProgressEvents.createdAt)
      .limit(1),

    db
      .select({
        id: activities.id,
        summary: activities.summary,
        userName: activities.userName,
        createdAt: activities.createdAt,
      })
      .from(activities)
      .orderBy(desc(activities.createdAt))
      .limit(8),
  ])

  const episodesBy = new Map(episodeRows.map((r) => [r.projectId, Number(r.n)]))
  const stagesBy = new Map(stageRows.map((r) => [r.projectId, r]))
  const titleOf = new Map(projectRows.map((r) => [r.id, r.title]))

  let totalEquivalents = 0
  let totalEffective = 0
  let completedRecords = 0
  let inProgressRecords = 0

  const dashboardProjects: DashboardProject[] = projectRows.map((row) => {
    const episodeCount = episodesBy.get(row.id) ?? 0
    const stage = stagesBy.get(row.id)

    // Planned records, so an episode with no stage rows still counts as work.
    const effective = Math.max(episodeCount * STAGES_PER_EPISODE, Number(stage?.total ?? 0))
    const done = Number(stage?.done ?? 0)

    totalEquivalents += done
    totalEffective += effective
    completedRecords += Number(stage?.completed ?? 0)
    inProgressRecords += Number(stage?.inProgress ?? 0)

    return {
      id: row.id,
      title: row.title,
      novelTitle: row.novelTitle,
      dramaTitle: row.dramaTitle,
      status: row.status,
      tags: row.tags,
      coverAssetId: row.coverAssetId,
      episodeCount,
      plannedEpisodes: episodeCount,
      stageRecords: effective,
      progress: aggregateProgress(done, effective),
    }
  })

  const statusCounts: Record<string, number> = { ALL: dashboardProjects.length }
  for (const project of dashboardProjects) {
    statusCounts[project.status] = (statusCounts[project.status] ?? 0) + 1
  }

  const now = Date.now()
  const dashboardTasks: DashboardTask[] = taskRows.map((row) => ({
    id: row.id,
    title: row.title,
    projectId: row.projectId,
    projectTitle: titleOf.get(row.projectId ?? '') ?? '',
    dueDate: row.dueDate,
    dueInDays: row.dueDate ? Math.ceil((row.dueDate.getTime() - now) / 86_400_000) : null,
    priority: row.priority,
  }))

  const risks: DashboardRisk[] = []
  for (const task of dashboardTasks) {
    if (task.dueInDays !== null && task.dueInDays < 0) {
      risks.push({
        id: `overdue-${task.id}`,
        tone: 'high',
        projectTitle: task.projectTitle,
        text: `${task.title}（逾期 ${Math.abs(task.dueInDays)} 天）`,
      })
    }
  }
  for (const row of blockedRows) {
    risks.push({
      id: `blocked-${row.projectId}-${row.stageKey}`,
      tone: 'medium',
      projectTitle: titleOf.get(row.projectId) ?? '',
      text: `${row.n} 集卡在${stageLabel(row.stageKey)}`,
    })
  }

  // Cumulative completion across the window, so the line only ever rises.
  let running = 0
  const trend: TrendPoint[] = trendRows.map((row) => {
    running += Number(row.completed)
    return {
      label: row.day,
      completed: Number(row.completed),
      started: Number(row.started),
      cumulative: totalEffective > 0 ? Math.min(running / totalEffective, 1) : 0,
    }
  })

  return {
    activeProjects: dashboardProjects.filter(
      (p) => p.status === 'IN_PRODUCTION' || p.status === 'POST_PRODUCTION'
    ).length,
    totalProjects: dashboardProjects.length,
    totalEpisodes: dashboardProjects.reduce((n, p) => n + p.episodeCount, 0),
    stageRecords: totalEffective,
    overallProgress: aggregateProgress(totalEquivalents, totalEffective),
    stageTotals: {
      completed: completedRecords,
      inProgress: inProgressRecords,
      pending: Math.max(totalEffective - completedRecords - inProgressRecords, 0),
    },
    projects: dashboardProjects,
    statusCounts,
    stageBreakdown: PRODUCTION_STAGE_KEYS.map((key) => {
      const row = stageByKey.find((r) => r.stageKey === key)
      return { key, done: Number(row?.done ?? 0), total: Number(row?.total ?? 0) }
    }),
    tasks: dashboardTasks,
    risks: risks.slice(0, 6),
    trend,
    trendStartedAt: firstEvent[0]?.at ?? null,
    recentActivity: recent,
  }
}

function stageLabel(key: string): string {
  const labels: Record<string, string> = {
    story_planning: '劇情規劃',
    novel: '小說創作',
    script: '劇本改編',
    storyboard: '分鏡設計',
    assets: '素材製作',
    video: '影像製作',
    postproduction: '後製剪輯',
    review: '審核調整',
    release: '上架發布',
  }
  return labels[key] ?? key
}
