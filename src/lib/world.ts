import { and, asc, count, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { worldEntries, worldEvents } from '@/db/schema'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import type { WorldCategoryValue, WorldEventScopeValue } from '@/lib/constants'

/**
 * 世界觀設定 (design 09).
 *
 * Two shapes, deliberately kept apart. An entry is a standing fact — the
 * dynasty, a trade route, how the crossing works. An event is a point on the
 * story's own timeline that the audience learns in a particular episode.
 * 《一灶見山河》needs both, and collapsing them would make 「前世」 either a
 * setting with no position or an event with no substance.
 *
 * Nothing here invents content. spec v3 §09:「不得依圖片自行更改故事正史」—
 * the categories are the ones the spec names, and the design's 特殊能力 /
 * 生物圖鑑 tabs are not among them.
 */

export type WorldEntryRow = {
  id: string
  category: WorldCategoryValue
  title: string
  summary: string
  body: string
  isCanon: boolean
  tags: string[]
  relatedIds: string[]
  updatedAt: Date
}

export type WorldEventRow = {
  id: string
  scope: WorldEventScopeValue
  title: string
  description: string
  eraLabel: string
  inUniverseOrder: number
  revealedInEpisode: number | null
  isCanon: boolean
  updatedAt: Date
}

export type WorldOverview = {
  entries: WorldEntryRow[]
  events: WorldEventRow[]
  countsByCategory: Record<string, number>
  totalEntries: number
  canonEntries: number
  totalEvents: number
}

export type WorldFilters = {
  category?: WorldCategoryValue
  search?: string
  /** Only entries marked as canon. */
  canonOnly?: boolean
}

export async function getWorld(
  projectId: string,
  filters: WorldFilters = {}
): Promise<WorldOverview> {
  const scope = and(eq(worldEntries.projectId, projectId), isNull(worldEntries.deletedAt))!

  const conditions = [scope]
  if (filters.category) conditions.push(eq(worldEntries.category, filters.category))
  if (filters.canonOnly) conditions.push(eq(worldEntries.isCanon, true))

  const search = filters.search?.trim()
  if (search) {
    const like = `%${search}%`
    conditions.push(
      or(
        ilike(worldEntries.title, like),
        ilike(worldEntries.summary, like),
        ilike(worldEntries.body, like),
        sql`exists (select 1 from unnest(${worldEntries.tags}) tag where tag ilike ${like})`
      )!
    )
  }

  const [entries, events, counts, totals] = await Promise.all([
    db
      .select({
        id: worldEntries.id,
        category: worldEntries.category,
        title: worldEntries.title,
        summary: worldEntries.summary,
        body: worldEntries.body,
        isCanon: worldEntries.isCanon,
        tags: worldEntries.tags,
        relatedIds: worldEntries.relatedIds,
        updatedAt: worldEntries.updatedAt,
      })
      .from(worldEntries)
      .where(and(...conditions))
      .orderBy(asc(worldEntries.category), asc(worldEntries.title)),

    db
      .select({
        id: worldEvents.id,
        scope: worldEvents.scope,
        title: worldEvents.title,
        description: worldEvents.description,
        eraLabel: worldEvents.eraLabel,
        inUniverseOrder: worldEvents.inUniverseOrder,
        revealedInEpisode: worldEvents.revealedInEpisode,
        isCanon: worldEvents.isCanon,
        updatedAt: worldEvents.updatedAt,
      })
      .from(worldEvents)
      .where(and(eq(worldEvents.projectId, projectId), isNull(worldEvents.deletedAt)))
      .orderBy(asc(worldEvents.inUniverseOrder), asc(worldEvents.createdAt)),

    // Unfiltered, so the category pills keep showing real totals.
    db
      .select({ category: worldEntries.category, n: count() })
      .from(worldEntries)
      .where(scope)
      .groupBy(worldEntries.category),

    db
      .select({
        total: count(),
        canon: sql<number>`count(*) filter (where ${worldEntries.isCanon})`.mapWith(Number),
      })
      .from(worldEntries)
      .where(scope),
  ])

  const countsByCategory: Record<string, number> = {}
  for (const row of counts) countsByCategory[row.category] = Number(row.n)

  return {
    entries,
    events,
    countsByCategory,
    totalEntries: Number(totals[0]?.total ?? 0),
    canonEntries: Number(totals[0]?.canon ?? 0),
    totalEvents: events.length,
  }
}

export async function createWorldEntry(input: {
  projectId: string
  category: WorldCategoryValue
  title: string
  summary?: string
  body?: string
  tags?: string[]
  user: SessionUser
}): Promise<WorldEntryRow> {
  const [created] = await db
    .insert(worldEntries)
    .values({
      projectId: input.projectId,
      category: input.category,
      title: input.title.trim(),
      summary: input.summary?.trim() ?? '',
      body: input.body ?? '',
      tags: input.tags ?? [],
      /*
       * New entries are canon by default. A setting someone bothered to write
       * down is part of the world until they say otherwise; the alternative
       * leaves a pile of entries nobody can rely on.
       */
      isCanon: true,
    })
    .onConflictDoNothing({ target: [worldEntries.projectId, worldEntries.title] })
    .returning()

  if (!created) {
    throw new ApiError(409, `「${input.title.trim()}」已經存在`, 'duplicate_title')
  }

  return created
}

export async function updateWorldEntry(input: {
  entryId: string
  projectId: string
  category?: WorldCategoryValue
  title?: string
  summary?: string
  body?: string
  tags?: string[]
  isCanon?: boolean
  user: SessionUser
}): Promise<WorldEntryRow> {
  const [updated] = await db
    .update(worldEntries)
    .set({
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.summary !== undefined ? { summary: input.summary.trim() } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.isCanon !== undefined ? { isCanon: input.isCanon } : {}),
      version: sql`${worldEntries.version} + 1`,
      updatedAt: new Date(),
    })
    // Scoped by project as well as id, so an id from another project misses.
    .where(
      and(
        eq(worldEntries.id, input.entryId),
        eq(worldEntries.projectId, input.projectId),
        isNull(worldEntries.deletedAt)
      )
    )
    .returning()

  if (!updated) throw ApiError.notFound('找不到這個世界觀條目')
  return updated
}

/** Soft delete: a setting removed today may be wanted back next week. */
export async function removeWorldEntry(input: {
  entryId: string
  projectId: string
}): Promise<void> {
  const [removed] = await db
    .update(worldEntries)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(worldEntries.id, input.entryId),
        eq(worldEntries.projectId, input.projectId),
        isNull(worldEntries.deletedAt)
      )
    )
    .returning({ id: worldEntries.id })

  if (!removed) throw ApiError.notFound('找不到這個世界觀條目')
}

/** Soft delete, mirroring entries. */
export async function removeWorldEvent(input: {
  eventId: string
  projectId: string
}): Promise<void> {
  const [removed] = await db
    .update(worldEvents)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(worldEvents.id, input.eventId),
        eq(worldEvents.projectId, input.projectId),
        isNull(worldEvents.deletedAt)
      )
    )
    .returning({ id: worldEvents.id })

  if (!removed) throw ApiError.notFound('找不到這個時間線事件')
}

export async function createWorldEvent(input: {
  projectId: string
  scope: WorldEventScopeValue
  title: string
  description?: string
  eraLabel?: string
  revealedInEpisode?: number | null
  user: SessionUser
}): Promise<WorldEventRow> {
  const [last] = await db
    .select({ order: worldEvents.inUniverseOrder })
    .from(worldEvents)
    .where(eq(worldEvents.projectId, input.projectId))
    .orderBy(desc(worldEvents.inUniverseOrder))
    .limit(1)

  const [created] = await db
    .insert(worldEvents)
    .values({
      projectId: input.projectId,
      scope: input.scope,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      eraLabel: input.eraLabel?.trim() ?? '',
      // Appended to the end; reordering is a separate, explicit action.
      inUniverseOrder: (last?.order ?? 0) + 10,
      revealedInEpisode: input.revealedInEpisode ?? null,
    })
    .returning()

  if (!created) throw new Error('Failed to create world event')
  return created
}
