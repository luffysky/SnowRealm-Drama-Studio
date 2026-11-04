import { and, asc, count, desc, eq, ilike, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  activities,
  arcs,
  assets,
  budgets,
  episodeProductionStages,
  episodes,
  projectFavourites,
  projects,
  usageLedger,
  users,
} from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { ProjectSortValue, ProjectStatusValue } from '@/lib/constants'
import { visibleProjects } from '@/lib/project-access'
import { aggregateProgress, PRODUCTION_STAGE_KEYS, STAGES_PER_EPISODE } from '@/lib/production'

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
  /** Empty = same as `title`. Read through `@/lib/project-titles`. */
  novelTitle: string
  dramaTitle: string
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
  createdAt: Date
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
      novelTitle: projects.novelTitle,
      dramaTitle: projects.dramaTitle,
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

      /*
       * Completed equivalents per project, following the one contract in
       * `src/lib/production.ts`. `done` is a sum of fractions, not a count of
       * finished rows: a stage at 60% contributes 0.6, and `blocked` never
       * contributes a whole stage.
       */
      db
        .select({
          projectId: episodeProductionStages.projectId,
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
          and(
            inArray(episodeProductionStages.projectId, ids),
            isNull(episodes.deletedAt)
          )
        )
        .groupBy(episodeProductionStages.projectId),

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
    const episodeCount = Number(episodeBy.get(row.id)?.total ?? 0)

    /*
     * The denominator is the *planned* number of stages — every episode times
     * nine — not the number of stage rows that happen to exist. An episode
     * whose rows were never created is unstarted work, and counting only the
     * rows present would report a project nobody has touched as complete
     * (spec v3 §11.2「尚未建立階段時的分母規則要明確且一致」).
     */
    const effectiveStages = Math.max(
      episodeCount * STAGES_PER_EPISODE,
      Number(stage?.total ?? 0)
    )

    return {
      id: row.id,
      title: row.title,
      novelTitle: row.novelTitle,
      dramaTitle: row.dramaTitle,
      slug: row.slug,
      status: row.status,
      tags: row.tags,
      isFlagship: row.isFlagship,
      coverAssetId: row.coverAssetId,
      episodeCount,
      doneEpisodes: Number(episodeBy.get(row.id)?.done ?? 0),
      plannedEpisodes: plannedBy.get(row.id) ?? 0,
      progress: aggregateProgress(Number(stage?.done ?? 0), effectiveStages),
      startDate: row.startDate,
      dueDate: row.dueDate,
      spend: spendBy.get(row.id) ?? 0,
      budget: budgetBy.has(row.id) ? budgetBy.get(row.id)! : null,
      isFavourite: favouriteIds.has(row.id),
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
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

/* -------------------------------------------------------------------------- */
/* Editing                                                                     */
/* -------------------------------------------------------------------------- */

export type ProjectEdit = {
  title?: string
  novelTitle?: string
  dramaTitle?: string
  logline?: string
  synopsis?: string
  tags?: string[]
  status?: ProjectStatusValue
  targetMinSec?: number
  targetMaxSec?: number
  targetChars?: number
  /** An asset id to use as the cover, or null to clear it. */
  coverAssetId?: string | null
  /** The book cover. null clears it, meaning 「沿用作品封面」. */
  novelCoverAssetId?: string | null
}

/**
 * 作品設定: renames and the cover.
 *
 * The cover is checked rather than trusted. No asset reference in this schema
 * carries a foreign key — not here, not on episodes, characters or shots
 * (`npx tsx scripts/db-verify.ts` lists them) — so the database would accept
 * an id from another project, or one whose upload never finished, and it
 * would render as a broken image or read across the project boundary.
 *
 * Returns null when the project is not visible to this member, so the caller
 * answers 404 rather than distinguishing "forbidden" from "no such project".
 */
export async function updateProject(
  projectId: string,
  userId: string,
  edit: ProjectEdit
): Promise<{ id: string; title: string; novelTitle: string; dramaTitle: string; coverAssetId: string | null } | null> {
  /*
   * Visibility goes through `visibleProjects()` rather than being spelled out
   * again here, so narrowing who may edit what stays one edit in one file
   * (`docs/ROUTES.md` §5).
   */
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), visibleProjects(userId)))
    .limit(1)

  if (!existing) return null

  // Both covers get the same check, for the same reason: no asset column in
  // this schema carries a foreign key, so the database would accept an id
  // from another project or one whose upload never finished.
  for (const candidate of [edit.coverAssetId, edit.novelCoverAssetId]) {
    if (!candidate) continue

    const [asset] = await db
      .select({ id: assets.id, kind: assets.kind, status: assets.uploadStatus })
      .from(assets)
      .where(and(eq(assets.id, candidate), eq(assets.projectId, projectId)))
      .limit(1)

    if (!asset) {
      throw new ApiError(400, '找不到這個檔案，或它不屬於這部作品', 'cover_not_found')
    }
    if (asset.status !== 'COMPLETED') {
      throw new ApiError(409, '這個檔案還沒上傳完成', 'cover_incomplete')
    }
    if (asset.kind !== 'IMAGE' && asset.kind !== 'STICKER') {
      throw new ApiError(400, '封面必須是圖片', 'cover_not_image')
    }
  }

  const [row] = await db
    .update(projects)
    .set({
      ...(edit.title !== undefined ? { title: edit.title } : {}),
      ...(edit.novelTitle !== undefined ? { novelTitle: edit.novelTitle } : {}),
      ...(edit.dramaTitle !== undefined ? { dramaTitle: edit.dramaTitle } : {}),
      ...(edit.logline !== undefined ? { logline: edit.logline } : {}),
      ...(edit.synopsis !== undefined ? { synopsis: edit.synopsis } : {}),
      ...(edit.tags !== undefined ? { tags: edit.tags } : {}),
      ...(edit.status !== undefined ? { status: edit.status } : {}),
      ...(edit.targetMinSec !== undefined ? { targetMinSec: edit.targetMinSec } : {}),
      ...(edit.targetMaxSec !== undefined ? { targetMaxSec: edit.targetMaxSec } : {}),
      ...(edit.targetChars !== undefined ? { targetChars: edit.targetChars } : {}),
      ...(edit.coverAssetId !== undefined ? { coverAssetId: edit.coverAssetId } : {}),
      ...(edit.novelCoverAssetId !== undefined
        ? { novelCoverAssetId: edit.novelCoverAssetId }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning({
      id: projects.id,
      title: projects.title,
      novelTitle: projects.novelTitle,
      dramaTitle: projects.dramaTitle,
      coverAssetId: projects.coverAssetId,
    })

  return row ?? null
}

/* -------------------------------------------------------------------------- */
/* 新增作品 (Z63)                                                               */
/* -------------------------------------------------------------------------- */

export type NewProject = {
  title: string
  novelTitle?: string
  dramaTitle?: string
  logline?: string
  synopsis?: string
  tags?: string[]
  status?: ProjectStatusValue
  targetMinSec?: number
  targetMaxSec?: number
  targetChars?: number
  /** 第幾部, and its name. A work is always at least one arc. */
  arcIndex?: number
  arcTitle?: string
  /** How many episodes to lay out up front. 0 creates none. */
  plannedEpisodes?: number
}

/**
 * Creates a work, its first arc, and the episodes with their stage rows.
 *
 * All in one transaction, because a project with no arc cannot have episodes
 * added to it through any screen in the app, and an episode with no
 * `episode_production_stages` rows is invisible to every progress figure.
 * Half of this committed is a work that looks fine on the list and is broken
 * everywhere else.
 *
 * Nothing descriptive is invented: the logline, synopsis and every episode
 * title are whatever was typed, usually empty (spec v3 §0). 120 blank episodes
 * is the correct starting state for a short drama — the numbering is the plan,
 * the titles are the writing.
 */
export async function createProject(
  userId: string,
  input: NewProject
): Promise<{ id: string; slug: string; episodeCount: number }> {
  const planned = Math.min(Math.max(input.plannedEpisodes ?? 120, 0), 999)
  const targetMinSec = input.targetMinSec ?? 120
  const targetMaxSec = input.targetMaxSec ?? 180
  const targetChars = input.targetChars ?? 4000

  const slug = await uniqueSlug(input.title)

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        title: input.title,
        slug,
        novelTitle: input.novelTitle ?? '',
        dramaTitle: input.dramaTitle ?? '',
        logline: input.logline ?? '',
        synopsis: input.synopsis ?? '',
        tags: input.tags ?? [],
        status: input.status ?? 'PLANNING',
        // Never automatically: 主力作品 is a decision about where the studio's
        // attention goes, and at most one work holds it.
        isFlagship: false,
        ownerId: userId,
        targetMinSec,
        targetMaxSec,
        targetChars,
      })
      .returning({ id: projects.id, slug: projects.slug })

    if (!project) throw new ApiError(500, '建立作品失敗', 'project_create_failed')

    const [arc] = await tx
      .insert(arcs)
      .values({
        projectId: project.id,
        index: input.arcIndex ?? 1,
        title: input.arcTitle?.trim() || '第一部',
        plannedEpisodes: planned,
      })
      .returning({ id: arcs.id })

    if (!arc) throw new ApiError(500, '建立篇章失敗', 'arc_create_failed')

    if (planned === 0) {
      return { id: project.id, slug: project.slug, episodeCount: 0 }
    }

    const inserted = await tx
      .insert(episodes)
      .values(
        Array.from({ length: planned }, (_, i) => ({
          projectId: project.id,
          arcId: arc.id,
          number: i + 1,
          targetSec: Math.round((targetMinSec + targetMaxSec) / 2),
          status: 'PLANNED' as const,
        }))
      )
      .returning({ id: episodes.id })

    const stageRows = inserted.flatMap((episode) =>
      PRODUCTION_STAGE_KEYS.map((stageKey) => ({
        projectId: project.id,
        episodeId: episode.id,
        stageKey,
        status: 'not_started' as const,
      }))
    )

    // Chunked: 120 episodes is 1,080 stage rows, past the parameter limit for
    // a single statement.
    for (let i = 0; i < stageRows.length; i += 500) {
      await tx.insert(episodeProductionStages).values(stageRows.slice(i, i + 500))
    }

    return { id: project.id, slug: project.slug, episodeCount: inserted.length }
  })
}

/**
 * A URL-safe, unique slug.
 *
 * `projects.slug` is `NOT NULL UNIQUE`, so a second work called 《一灶見山河》
 * would fail the insert with a constraint error rather than a message anyone
 * can act on. CJK titles reduce to nothing under the usual ASCII slug rules,
 * which is why the fallback is a date rather than an empty string.
 */
async function uniqueSlug(title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || `work-${new Date().toISOString().slice(0, 10)}`

  const taken = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(like(projects.slug, `${base}%`))

  if (!taken.some((row) => row.slug === base)) return base

  for (let n = 2; n < 999; n += 1) {
    const candidate = `${base}-${n}`
    if (!taken.some((row) => row.slug === candidate)) return candidate
  }

  return `${base}-${Date.now()}`
}
