import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  aiJobs,
  assets,
  characters,
  episodeProductionStages,
  episodes,
  projects,
  tasks,
  users,
  worldEntries,
} from '@/db/schema'
import type { ProjectStatusValue } from '@/lib/constants'
import {
  aggregateProgress,
  PRODUCTION_STAGE_KEYS,
  PRODUCTION_STAGE_LABEL,
  stageOrdinal,
  STAGES_PER_EPISODE,
  type ProductionStageKey,
} from '@/lib/production'
import { getProjectDetail } from '@/lib/projects'

/**
 * 作品總覽 (design 04).
 *
 * Everything here is derived on read. Nothing about a project's progress is
 * cached on the row, because the page shows the same underlying numbers in
 * several places at once — a pipeline, a per-episode table and a headline
 * percentage — and a stored figure would visibly disagree with the others the
 * moment a stage changed.
 */

/**
 * One entry per production stage, in pipeline order.
 *
 * This used to collapse the stages into seven coarser "workflow steps", with
 * 企劃 and 發行 inferred from the project's status because no stage row backed
 * them. Spec v3 §11.2 gave 劇情規劃 and 上架發布 real keys, so the pipeline is
 * now simply the nine stages and nothing has to be guessed.
 */
export type WorkflowStepState = 'DONE' | 'ACTIVE' | 'PENDING'

export type WorkflowStep = {
  key: ProductionStageKey
  label: string
  /** `01`–`09`, as the design numbers them. */
  ordinal: string
  state: WorkflowStepState
  /** 0–1, completed equivalents over rows for this stage. */
  progress: number
  episodesDone: number
  episodeCount: number
}

export type OverviewEpisode = {
  id: string
  number: number
  title: string
  status: string
  progress: number
  dueDate: Date | null
}

export type ProjectOverview = {
  id: string
  title: string
  logline: string
  tags: string[]
  status: ProjectStatusValue
  progress: number
  episodeCount: number
  plannedEpisodes: number
  episodesByStatus: Record<string, number>
  startDate: Date | null
  dueDate: Date | null
  /** Whole days until dueDate; negative when overdue, null when unset. */
  daysRemaining: number | null
  budget: number | null
  spend: number
  owner: { name: string; title: string; color: string } | null
  techLead: { name: string; title: string; color: string } | null
  workflow: WorkflowStep[]
  episodes: OverviewEpisode[]
  assets: { kind: string; count: number; bytes: number }[]
  assetTotals: { count: number; bytes: number }
  /** Counts that sit beside the asset tiles but live in their own tables. */
  library: { characters: number; worldEntries: number }
  aiStats: { kind: string; jobs: number; outputTokens: number }[]
  tasks: {
    id: string
    title: string
    dueDate: Date | null
    /** Whole days until dueDate; negative when overdue, null when unset. */
    dueInDays: number | null
    status: string
  }[]
  recentActivity: { id: string; summary: string; userName: string; createdAt: Date }[]
}

/** Whole days from now until `date`; negative once it has passed. */
function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000)
}

export async function getProjectOverview(
  projectId: string,
  userId: string
): Promise<ProjectOverview | null> {
  const detail = await getProjectDetail(projectId, userId)
  if (!detail) return null

  const [
    statusRows,
    stageRows,
    episodeRows,
    assetRows,
    aiRows,
    taskRows,
    members,
    projectRow,
    characterRows,
    worldRows,
  ] = await Promise.all([
      db
        .select({ status: episodes.status, n: count() })
        .from(episodes)
        .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
        .groupBy(episodes.status),

      // Per-stage completed equivalents, same contract as everywhere else.
      db
        .select({
          stage: episodeProductionStages.stageKey,
          total: count(),
          done: sql<string>`sum(
            case
              when ${episodeProductionStages.status} = 'completed' then 1.0
              when ${episodeProductionStages.status} = 'not_started' then 0.0
              else least(greatest(coalesce(${episodeProductionStages.progressPercent}, 0), 0), 100) / 100.0
            end
          )`.mapWith(Number),
        })
        .from(episodeProductionStages)
        .innerJoin(episodes, eq(episodes.id, episodeProductionStages.episodeId))
        .where(
          and(eq(episodeProductionStages.projectId, projectId), isNull(episodes.deletedAt))
        )
        .groupBy(episodeProductionStages.stageKey),

      db
        .select({
          id: episodes.id,
          number: episodes.number,
          title: episodes.title,
          status: episodes.status,
          dueDate: episodes.dueDate,
          stageTotal: sql<number>`count(${episodeProductionStages.id})`.mapWith(Number),
          stageDone: sql<string>`sum(
            case
              when ${episodeProductionStages.status} = 'completed' then 1.0
              when ${episodeProductionStages.status} = 'not_started' then 0.0
              else least(greatest(coalesce(${episodeProductionStages.progressPercent}, 0), 0), 100) / 100.0
            end
          )`.mapWith(Number),
        })
        .from(episodes)
        .leftJoin(
          episodeProductionStages,
          eq(episodeProductionStages.episodeId, episodes.id)
        )
        .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
        .groupBy(episodes.id)
        .orderBy(asc(episodes.number))
        .limit(8),

      db
        .select({
          kind: assets.kind,
          n: count(),
          bytes: sql<string>`coalesce(sum(${assets.sizeBytes}), 0)`,
        })
        .from(assets)
        .where(
          and(
            eq(assets.projectId, projectId),
            eq(assets.uploadStatus, 'COMPLETED'),
            isNull(assets.deletedAt)
          )
        )
        .groupBy(assets.kind),

      db
        .select({
          kind: aiJobs.kind,
          jobs: count(),
          tokens: sql<number>`coalesce(sum(${aiJobs.outputTokens}), 0)`.mapWith(Number),
        })
        .from(aiJobs)
        .where(eq(aiJobs.projectId, projectId))
        .groupBy(aiJobs.kind),

      db
        .select({
          id: tasks.id,
          title: tasks.title,
          dueDate: tasks.dueDate,
          status: tasks.status,
        })
        .from(tasks)
        .where(
          and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), ne(tasks.status, 'DONE'))
        )
        .orderBy(asc(tasks.dueDate))
        .limit(8),

      db
        .select({ id: users.id, name: users.name, title: users.title, color: users.color })
        .from(users),

      db
        .select({ ownerId: projects.ownerId, techLeadId: projects.techLeadId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1),

      db
        .select({ n: count() })
        .from(characters)
        .where(and(eq(characters.projectId, projectId), isNull(characters.deletedAt))),

      db.select({ n: count() }).from(worldEntries).where(eq(worldEntries.projectId, projectId)),
    ])

  const stageBy = new Map<string, { total: number; done: number }>(
    stageRows.map((r) => [r.stage as string, { total: Number(r.total), done: Number(r.done) }])
  )

  const workflow: WorkflowStep[] = PRODUCTION_STAGE_KEYS.map((key) => {
    const row = stageBy.get(key)
    // Denominator is the episode count, not the rows present: a stage whose
    // rows were never created is unstarted work, not absent work.
    const total = Math.max(detail.episodeCount, Number(row?.total ?? 0))
    const done = Number(row?.done ?? 0)
    const progress = aggregateProgress(done, total)

    return {
      key,
      label: PRODUCTION_STAGE_LABEL[key],
      ordinal: stageOrdinal(key),
      state: (progress >= 1 ? 'DONE' : progress > 0 ? 'ACTIVE' : 'PENDING') as WorkflowStepState,
      progress,
      episodesDone: Math.round(done),
      episodeCount: total,
    }
  })

  // Highlight where work actually stands: the earliest unfinished step.
  const firstUnfinished = workflow.find((s) => s.state !== 'DONE')
  if (firstUnfinished) firstUnfinished.state = 'ACTIVE'

  const memberOf = (id: string | null | undefined) => {
    if (!id) return null
    const found = members.find((m) => m.id === id)
    return found ? { name: found.name, title: found.title, color: found.color } : null
  }

  const daysRemaining = detail.dueDate ? daysUntil(detail.dueDate) : null

  const episodesByStatus: Record<string, number> = {}
  for (const row of statusRows) episodesByStatus[row.status] = Number(row.n)

  const assetList = assetRows.map((r) => ({
    kind: r.kind,
    count: Number(r.n),
    bytes: Number(r.bytes),
  }))

  return {
    id: detail.id,
    title: detail.title,
    logline: detail.logline,
    tags: detail.tags,
    status: detail.status,
    progress: detail.progress,
    episodeCount: detail.episodeCount,
    plannedEpisodes: detail.plannedEpisodes,
    episodesByStatus,
    startDate: detail.startDate,
    dueDate: detail.dueDate,
    daysRemaining,
    budget: detail.budget,
    spend: detail.spend,
    owner: memberOf(projectRow[0]?.ownerId),
    techLead: memberOf(projectRow[0]?.techLeadId),
    workflow,
    episodes: episodeRows.map((e) => ({
      id: e.id,
      number: e.number,
      title: e.title,
      status: e.status,
      // Always out of nine: an episode missing its 上架發布 row is not 8/8 done.
      progress: aggregateProgress(e.stageDone, STAGES_PER_EPISODE),
      dueDate: e.dueDate,
    })),
    assets: assetList,
    library: {
      characters: Number(characterRows[0]?.n ?? 0),
      worldEntries: Number(worldRows[0]?.n ?? 0),
    },
    assetTotals: {
      count: assetList.reduce((s, a) => s + a.count, 0),
      bytes: assetList.reduce((s, a) => s + a.bytes, 0),
    },
    aiStats: aiRows.map((r) => ({
      kind: r.kind,
      jobs: Number(r.jobs),
      outputTokens: Number(r.tokens),
    })),
    // The countdown is computed here rather than while rendering, so the
    // component stays a pure function of its props.
    tasks: taskRows.map((task) => ({
      ...task,
      dueInDays: task.dueDate ? daysUntil(task.dueDate) : null,
    })),
    recentActivity: detail.recentActivity,
  }
}
