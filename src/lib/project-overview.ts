import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  aiJobs,
  assets,
  characters,
  episodeStages,
  episodes,
  projects,
  tasks,
  users,
  worldEntries,
} from '@/db/schema'
import type { ProjectStatusValue } from '@/lib/constants'
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
 * The seven workflow steps the pipeline shows.
 *
 * They are coarser than the nine `episode_stages`, so each step owns a set of
 * stages and its completion is the fraction of those rows that are DONE.
 * 企劃 and 發行 own none: they are read from the project's own status instead,
 * since neither has stage rows behind it.
 */
export const WORKFLOW_STEPS = [
  { key: 'PLANNING', label: '企劃', stages: [] as readonly string[] },
  { key: 'SCRIPT', label: '劇本', stages: ['NOVEL', 'SCRIPT'] as readonly string[] },
  { key: 'STORYBOARD', label: '分鏡', stages: ['STORYBOARD'] as readonly string[] },
  {
    key: 'PRODUCTION',
    label: '製作',
    stages: ['IMAGE', 'VIDEO', 'VOICE', 'MUSIC'] as readonly string[],
  },
  { key: 'POST', label: '後製', stages: ['EDIT'] as readonly string[] },
  { key: 'REVIEW', label: '審核', stages: ['REVIEW'] as readonly string[] },
  { key: 'RELEASE', label: '發行', stages: [] as readonly string[] },
] as const

export type WorkflowStepState = 'DONE' | 'ACTIVE' | 'PENDING'

export type WorkflowStep = {
  key: string
  label: string
  state: WorkflowStepState
  progress: number
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

      db
        .select({
          stage: episodeStages.stage,
          total: count(),
          done: sql<number>`count(*) filter (where ${episodeStages.state} = 'DONE')`.mapWith(
            Number
          ),
        })
        .from(episodeStages)
        .innerJoin(episodes, eq(episodes.id, episodeStages.episodeId))
        .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
        .groupBy(episodeStages.stage),

      db
        .select({
          id: episodes.id,
          number: episodes.number,
          title: episodes.title,
          status: episodes.status,
          dueDate: episodes.dueDate,
          stageTotal: sql<number>`count(${episodeStages.id})`.mapWith(Number),
          stageDone: sql<number>`count(*) filter (where ${episodeStages.state} = 'DONE')`.mapWith(
            Number
          ),
        })
        .from(episodes)
        .leftJoin(episodeStages, eq(episodeStages.episodeId, episodes.id))
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

  const workflow: WorkflowStep[] = WORKFLOW_STEPS.map((step) => {
    if (step.stages.length === 0) {
      const done =
        step.key === 'PLANNING' ? detail.episodeCount > 0 : detail.status === 'RELEASED'
      return {
        key: step.key,
        label: step.label,
        state: (done ? 'DONE' : 'PENDING') as WorkflowStepState,
        progress: done ? 1 : 0,
      }
    }

    let total = 0
    let doneCount = 0
    for (const stage of step.stages) {
      const row = stageBy.get(stage)
      total += Number(row?.total ?? 0)
      doneCount += Number(row?.done ?? 0)
    }

    const progress = total > 0 ? doneCount / total : 0
    const state: WorkflowStepState = progress >= 1 ? 'DONE' : progress > 0 ? 'ACTIVE' : 'PENDING'

    return { key: step.key, label: step.label, state, progress }
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
      progress: e.stageTotal > 0 ? e.stageDone / e.stageTotal : 0,
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
