import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  activities,
  arcs,
  budgets,
  episodeStages,
  episodes,
  projectFavourites,
  projects,
  usageLedger,
  users,
} from '@/db/schema'
import type { ProjectSortValue, ProjectStatusValue } from '@/lib/constants'

/**
 * Query layer for 作品列表 / 作品總覽 (designs 03 / 04).
 *
 * Progress is derived from `episode_stages` rather than stored on the project:
 * a cached percentage would drift the moment a stage changed, and the design
 * shows it next to the episode counts where a stale number would be obvious.
 */

export type ProjectCard = {
  id: string
  title: string
  slug: string
  status: ProjectStatusValue
  tags: string[]
  isFlagship: boolean
  coverAssetId: string | null
  /** Total episodes that exist, and how many are DONE. */
  episodeCount: number
  doneEpisodes: number
  /** Planned total across all arcs, which can exceed what exists yet. */
  plannedEpisodes: number
  /** 0..1, from completed production stages. */
  progress: number
  dueDate: Date | null
  startDate: Date | null
  /** Settled spend in the project's reporting currency. */
  spend: number
  budget: number | null
  isFavourite: boolean
  updatedAt: Date
}

export type ProjectFilters = {
  status?: ProjectStatusValue | null
  /** Matches title, slug or a tag. */
  search?: string | null
  sort?: ProjectSortValue
}

/**
 * Cards for the list page, plus the per-status counts the filter pills show.
 *
 * Counts come from a separate pass over *unfiltered* rows on purpose — a pill
 * that only counted the current filter would read zero for every status except
 * the selected one.
 */
export async function listProjects(
  userId: string,
  filters: ProjectFilters = {}
): Promise<{ cards: ProjectCard[]; counts: Record<string, number>; total: number }> {
  const notDeleted = isNull(projects.deletedAt)

  const conditions = [notDeleted]
  if (filters.status) conditions.push(eq(projects.status, filters.status))

  const search = filters.search?.trim()
  if (search) {
    const like = `%${search}%`
    conditions.push(
      or(
        ilike(projects.title, like),
        ilike(projects.slug, like),
        sql`exists (select 1 from unnest(${projects.tags}) tag where tag ilike ${like})`
      )!
    )
  }

  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      slug: projects.slug,
      status: projects.status,
      tags: projects.tags,
      isFlagship: projects.isFlagship,
      coverAssetId: projects.coverAssetId,
      startDate: projects.startDate,
      dueDate: projects.dueDate,
      updatedAt: projects.updatedAt,
      createdAt: projects.createdAt,
    })
    .from(projects)
    .where(and(...conditions))

  if (rows.length === 0) {
    return { cards: [], counts: await statusCounts(), total: 0 }
  }

  const ids = rows.map((r) => r.id)
  const [episodeStats, stageStats, plannedStats, spendStats, budgetStats, favourites] =
    await Promise.all([
      db
        .select({
          projectId: episodes.projectId,
          total: count(),
          done: sql<number>`count(*) filter (where ${episodes.status} = 'DONE')`.mapWith(Number),
        })
        .from(episodes)
        .where(and(inArray(episodes.projectId, ids), isNull(episodes.deletedAt)))
        .groupBy(episodes.projectId),

      db
        .select({
          projectId: episodes.projectId,
          total: count(),
          done: sql<number>`count(*) filter (where ${episodeStages.state} = 'DONE')`.mapWith(Number),
        })
        .from(episodeStages)
        .innerJoin(episodes, eq(episodes.id, episodeStages.episodeId))
        .where(and(inArray(episodes.projectId, ids), isNull(episodes.deletedAt)))
        .groupBy(episodes.projectId),

      db
        .select({
          projectId: arcs.projectId,
          planned: sql<number>`coalesce(sum(${arcs.plannedEpisodes}), 0)`.mapWith(Number),
        })
        .from(arcs)
        .where(and(inArray(arcs.projectId, ids), isNull(arcs.deletedAt)))
        .groupBy(arcs.projectId),

      db
        .select({
          projectId: usageLedger.projectId,
          total: sql<string>`coalesce(sum(${usageLedger.amount}), 0)`,
        })
        .from(usageLedger)
        .where(and(inArray(usageLedger.projectId, ids), eq(usageLedger.kind, 'ACTUAL')))
        .groupBy(usageLedger.projectId),

      db
        .select({
          projectId: budgets.projectId,
          total: sql<string>`coalesce(sum(${budgets.amount}), 0)`,
        })
        .from(budgets)
        .where(inArray(budgets.projectId, ids))
        .groupBy(budgets.projectId),

      db
        .select({ projectId: projectFavourites.projectId })
        .from(projectFavourites)
        .where(
          and(eq(projectFavourites.userId, userId), inArray(projectFavourites.projectId, ids))
        ),
    ])

  const episodeBy = new Map(episodeStats.map((r) => [r.projectId, r]))
  const stageBy = new Map(stageStats.map((r) => [r.projectId, r]))
  const plannedBy = new Map(plannedStats.map((r) => [r.projectId, Number(r.planned)]))
  const spendBy = new Map(spendStats.map((r) => [r.projectId, Number(r.total)]))
  const budgetBy = new Map(budgetStats.map((r) => [r.projectId, Number(r.total)]))
  const favouriteIds = new Set(favourites.map((r) => r.projectId))

  const cards: ProjectCard[] = rows.map((row) => {
    const stage = stageBy.get(row.id)
    const stageTotal = Number(stage?.total ?? 0)
    const stageDone = Number(stage?.done ?? 0)

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      tags: row.tags,
      isFlagship: row.isFlagship,
      coverAssetId: row.coverAssetId,
      episodeCount: Number(episodeBy.get(row.id)?.total ?? 0),
      doneEpisodes: Number(episodeBy.get(row.id)?.done ?? 0),
      plannedEpisodes: plannedBy.get(row.id) ?? 0,
      progress: stageTotal > 0 ? stageDone / stageTotal : 0,
      startDate: row.startDate,
      dueDate: row.dueDate,
      spend: spendBy.get(row.id) ?? 0,
      budget: budgetBy.has(row.id) ? budgetBy.get(row.id)! : null,
      isFavourite: favouriteIds.has(row.id),
      updatedAt: row.updatedAt,
    }
  })

  sortCards(cards, filters.sort ?? 'UPDATED', rows)

  return { cards, counts: await statusCounts(), total: cards.length }
}

/** Flagship first, then whatever the user asked for. */
function sortCards(
  cards: ProjectCard[],
  sort: ProjectSortValue,
  rows: { id: string; createdAt: Date }[]
): void {
  const createdBy = new Map(rows.map((r) => [r.id, r.createdAt]))

  cards.sort((a, b) => {
    if (a.isFlagship !== b.isFlagship) return a.isFlagship ? -1 : 1

    switch (sort) {
      case 'TITLE':
        return a.title.localeCompare(b.title, 'zh-Hant')
      case 'PROGRESS':
        return b.progress - a.progress
      case 'CREATED':
        return (
          (createdBy.get(b.id)?.getTime() ?? 0) - (createdBy.get(a.id)?.getTime() ?? 0)
        )
      default:
        return b.updatedAt.getTime() - a.updatedAt.getTime()
    }
  })
}

/** Row counts per status, for the filter pills. Always unfiltered. */
export async function statusCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: projects.status, n: count() })
    .from(projects)
    .where(isNull(projects.deletedAt))
    .groupBy(projects.status)

  const counts: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    counts[row.status] = Number(row.n)
    total += Number(row.n)
  }
  counts.ALL = total
  return counts
}

export type ProjectDetail = ProjectCard & {
  logline: string
  synopsis: string
  ownerName: string | null
  techLeadName: string | null
  arcs: { id: string; index: number; title: string; plannedEpisodes: number }[]
  recentActivity: { id: string; summary: string; userName: string; createdAt: Date }[]
}

/** Everything the right-hand rail on 作品列表 shows for one project. */
export async function getProjectDetail(
  projectId: string,
  userId: string
): Promise<ProjectDetail | null> {
  const { cards } = await listProjects(userId)
  const card = cards.find((c) => c.id === projectId)
  if (!card) return null

  const [row] = await db
    .select({
      logline: projects.logline,
      synopsis: projects.synopsis,
      ownerId: projects.ownerId,
      techLeadId: projects.techLeadId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!row) return null

  const memberIds = [row.ownerId, row.techLeadId].filter((id): id is string => Boolean(id))
  const members = memberIds.length
    ? await db
        .select({ id: users.id, name: users.name, title: users.title })
        .from(users)
        .where(inArray(users.id, memberIds))
    : []

  const nameOf = (id: string | null) => {
    if (!id) return null
    const member = members.find((m) => m.id === id)
    return member ? `${member.name}（${member.title}）` : null
  }

  const [projectArcs, recent] = await Promise.all([
    db
      .select({
        id: arcs.id,
        index: arcs.index,
        title: arcs.title,
        plannedEpisodes: arcs.plannedEpisodes,
      })
      .from(arcs)
      .where(and(eq(arcs.projectId, projectId), isNull(arcs.deletedAt)))
      .orderBy(asc(arcs.index)),

    db
      .select({
        id: activities.id,
        summary: activities.summary,
        userName: activities.userName,
        createdAt: activities.createdAt,
      })
      .from(activities)
      .where(eq(activities.projectId, projectId))
      .orderBy(desc(activities.createdAt))
      .limit(5),
  ])

  return {
    ...card,
    logline: row.logline,
    synopsis: row.synopsis,
    ownerName: nameOf(row.ownerId),
    techLeadName: nameOf(row.techLeadId),
    arcs: projectArcs,
    recentActivity: recent,
  }
}

/** Toggles the heart. Returns the state after the change. */
export async function toggleFavourite(
  userId: string,
  projectId: string
): Promise<{ isFavourite: boolean }> {
  const removed = await db
    .delete(projectFavourites)
    .where(
      and(eq(projectFavourites.userId, userId), eq(projectFavourites.projectId, projectId))
    )
    .returning({ projectId: projectFavourites.projectId })

  if (removed.length > 0) return { isFavourite: false }

  await db
    .insert(projectFavourites)
    .values({ userId, projectId })
    .onConflictDoNothing()

  return { isFavourite: true }
}
