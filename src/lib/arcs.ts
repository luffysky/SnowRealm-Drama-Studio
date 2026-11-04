import { and, asc, count, eq, inArray, isNull, max, sql } from 'drizzle-orm'
import { db } from '@/db'
import { arcs, episodes } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'

/**
 * 卷 — 一個單純的收納器 (Z128).
 *
 * 「多一個卷這個單位 可以把各集收在那些卷 但不要影響到原來劇本的對接跟其他
 * 數據 卷就只是單純一個單位跟收納器」.
 *
 * **No new table.** `arcs` has existed since the first migration, every
 * episode already carries a non-null `arc_id`, and both works have exactly one
 * arc holding all 120 episodes. Building a second grouping alongside it would
 * have given every episode two parents that could disagree. So 卷 **is** the
 * arc, and what was missing was never the data — it was any way to make more
 * than one of them.
 *
 * Three rules keep it a container and nothing more:
 *
 *  1. **集號不變.** `episodes.number` is what 小說、劇本、分鏡 and every
 *     「第 007 集」 in the prose refer to. Moving an episode between 卷 does
 *     not touch it. The column's comment used to say 「第幾集 within the
 *     arc」, which was only ever true because there was one arc; it is
 *     project-wide in practice and now says so.
 *  2. **新卷的規劃集數從 0 起算.** `plannedEpisodes` is **summed across
 *     arcs** for the project card (`listProjects`). A new arc taking the
 *     schema default of 120 would silently turn 「規劃 120 集」 into 240 —
 *     exactly the kind of other number this was asked not to disturb.
 *  3. **刪卷不刪集.** `episodes.arc_id` cascades on delete, so dropping an
 *     arc row would take its episodes with it. Deleting a 卷 therefore moves
 *     its episodes somewhere else first, inside the same transaction, and
 *     refuses outright when there is nowhere to move them to.
 */

import type { ArcRow } from '@/lib/arcs-view'

export type { ArcRow }

/** Every 卷 of a project, in order, with what is filed under each. */
export async function listArcs(projectId: string): Promise<ArcRow[]> {
  const rows = await db
    .select({
      id: arcs.id,
      index: arcs.index,
      title: arcs.title,
      logline: arcs.logline,
      plannedEpisodes: arcs.plannedEpisodes,
      episodeCount: count(episodes.id),
      firstNumber: sql<number | null>`min(${episodes.number})`,
      lastNumber: sql<number | null>`max(${episodes.number})`,
    })
    .from(arcs)
    /*
     * Left join with the soft-delete test in the join condition, not the
     * where clause: in the where clause it would drop an empty 卷 entirely,
     * and an empty 卷 is the normal state of one you just made.
     */
    .leftJoin(episodes, and(eq(episodes.arcId, arcs.id), isNull(episodes.deletedAt)))
    .where(and(eq(arcs.projectId, projectId), isNull(arcs.deletedAt)))
    .groupBy(arcs.id, arcs.index, arcs.title, arcs.logline, arcs.plannedEpisodes)
    .orderBy(asc(arcs.index))

  return rows.map((row) => ({
    ...row,
    episodeCount: Number(row.episodeCount),
    firstNumber: row.firstNumber === null ? null : Number(row.firstNumber),
    lastNumber: row.lastNumber === null ? null : Number(row.lastNumber),
  }))
}

export async function createArc(input: {
  projectId: string
  title: string
  logline?: string
  user: SessionUser
}): Promise<ArcRow> {
  const title = input.title.trim()
  if (!title) throw ApiError.badRequest('請輸入卷名')

  const [highest] = await db
    .select({ index: max(arcs.index) })
    .from(arcs)
    .where(eq(arcs.projectId, input.projectId))

  const [created] = await db
    .insert(arcs)
    .values({
      projectId: input.projectId,
      /*
       * Counts soft-deleted arcs too — `arcs_project_index_key` is a plain
       * unique constraint and does not know about `deleted_at`, so reusing a
       * deleted arc's index is a 23505 rather than a tidy number.
       */
      index: (highest?.index ?? 0) + 1,
      title,
      logline: input.logline?.trim() ?? '',
      // Rule 2. Never the schema default here.
      plannedEpisodes: 0,
    })
    .returning()

  if (!created) throw new Error('Failed to create arc')

  await logActivity({
    user: input.user,
    action: 'create',
    entityType: 'arc',
    entityId: created.id,
    projectId: input.projectId,
    summary: `${input.user.name} 新增卷「${created.title}」`,
  })

  return {
    id: created.id,
    index: created.index,
    title: created.title,
    logline: created.logline,
    plannedEpisodes: created.plannedEpisodes,
    episodeCount: 0,
    firstNumber: null,
    lastNumber: null,
  }
}

export async function updateArc(input: {
  projectId: string
  arcId: string
  title?: string
  logline?: string
  plannedEpisodes?: number
  user: SessionUser
}): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() }

  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) throw ApiError.badRequest('卷名不能是空的')
    patch.title = title
  }
  if (input.logline !== undefined) patch.logline = input.logline.trim()
  if (input.plannedEpisodes !== undefined) {
    patch.plannedEpisodes = Math.max(0, Math.trunc(input.plannedEpisodes))
  }

  const updated = await db
    .update(arcs)
    .set(patch)
    .where(
      and(eq(arcs.id, input.arcId), eq(arcs.projectId, input.projectId), isNull(arcs.deletedAt))
    )
    .returning({ id: arcs.id, title: arcs.title })

  if (updated.length === 0) throw ApiError.notFound('找不到這一卷')

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'arc',
    entityId: input.arcId,
    projectId: input.projectId,
    summary: `${input.user.name} 修改卷「${updated[0]!.title}」`,
  })
}

/**
 * 把幾集搬到另一卷.
 *
 * The one operation this whole feature exists for, and the one that must be
 * provably harmless: it writes `arc_id` and nothing else. No renumbering, no
 * touching documents, no re-running the stage sync — none of those depend on
 * which 卷 an episode is in.
 *
 * Returns how many rows actually moved, which is not always how many were
 * asked for: an id belonging to another project, or already in the target,
 * is silently a no-op rather than an error, because the caller is a
 * multi-select and partial overlap is the normal case.
 */
export async function moveEpisodesToArc(input: {
  projectId: string
  arcId: string
  episodeIds: string[]
  user: SessionUser
}): Promise<number> {
  if (input.episodeIds.length === 0) return 0

  const [target] = await db
    .select({ id: arcs.id, title: arcs.title })
    .from(arcs)
    .where(
      and(eq(arcs.id, input.arcId), eq(arcs.projectId, input.projectId), isNull(arcs.deletedAt))
    )
    .limit(1)

  if (!target) throw ApiError.notFound('找不到目標卷')

  const moved = await db
    .update(episodes)
    .set({ arcId: target.id, updatedAt: new Date() })
    .where(
      and(
        inArray(episodes.id, input.episodeIds),
        // Scoped to the project: an id from elsewhere must not be movable.
        eq(episodes.projectId, input.projectId),
        isNull(episodes.deletedAt)
      )
    )
    .returning({ number: episodes.number })

  if (moved.length === 0) return 0

  const numbers = moved.map((row) => row.number).sort((a, b) => a - b)

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'arc',
    entityId: target.id,
    projectId: input.projectId,
    summary:
      `${input.user.name} 把 ${moved.length} 集搬到卷「${target.title}」` +
      `（EP${pad(numbers[0]!)}–EP${pad(numbers[numbers.length - 1]!)}）`,
  })

  return moved.length
}

/**
 * 刪一卷.
 *
 * `episodes.arc_id` is `on delete cascade`, so this is the one operation here
 * that could destroy work. It never deletes the row outright:
 *
 *  - Episodes are moved to `moveTo` first, in the same transaction.
 *  - Without a `moveTo`, a 卷 with episodes in it is refused rather than
 *    guessed at.
 *  - The last remaining 卷 cannot be deleted, because every episode needs one
 *    and `arc_id` is `not null`.
 *
 * The arc itself is soft-deleted (spec v2 §5), so the row survives for the
 * history even once nothing points at it.
 */
export async function deleteArc(input: {
  projectId: string
  arcId: string
  /** Where its episodes go. Required when it has any. */
  moveTo?: string | null
  user: SessionUser
}): Promise<{ moved: number }> {
  const remaining = await listArcs(input.projectId)
  const arc = remaining.find((row) => row.id === input.arcId)
  if (!arc) throw ApiError.notFound('找不到這一卷')

  if (remaining.length <= 1) {
    throw ApiError.badRequest('這是最後一卷，刪掉就沒有地方放集數了。')
  }

  if (arc.episodeCount > 0 && !input.moveTo) {
    throw ApiError.badRequest(
      `這一卷還有 ${arc.episodeCount} 集，請先選一個要搬去的卷。集數本身不會被刪掉。`
    )
  }

  if (input.moveTo) {
    const target = remaining.find((row) => row.id === input.moveTo)
    if (!target) throw ApiError.badRequest('找不到要搬去的卷')
    if (target.id === arc.id) throw ApiError.badRequest('不能搬到自己')
  }

  let moved = 0

  await db.transaction(async (tx) => {
    if (input.moveTo && arc.episodeCount > 0) {
      const rows = await tx
        .update(episodes)
        .set({ arcId: input.moveTo, updatedAt: new Date() })
        .where(
          and(
            eq(episodes.arcId, arc.id),
            eq(episodes.projectId, input.projectId),
            isNull(episodes.deletedAt)
          )
        )
        .returning({ id: episodes.id })
      moved = rows.length
    }

    /*
     * Soft delete only. A hard delete here would cascade into any episode
     * this missed — a soft-deleted one, or a row inserted between the move
     * and now — and take it with it.
     */
    await tx
      .update(arcs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(arcs.id, arc.id), eq(arcs.projectId, input.projectId)))
  })

  await logActivity({
    user: input.user,
    action: 'delete',
    entityType: 'arc',
    entityId: arc.id,
    projectId: input.projectId,
    summary: `${input.user.name} 刪除卷「${arc.title}」${moved > 0 ? `，${moved} 集已搬到其他卷` : ''}`,
  })

  return { moved }
}

/** Which 卷 each episode is in, for the list view's grouping. */
export async function arcOfEpisodes(
  projectId: string
): Promise<Map<string, { arcId: string; title: string; index: number }>> {
  const rows = await db
    .select({
      episodeId: episodes.id,
      arcId: arcs.id,
      title: arcs.title,
      index: arcs.index,
    })
    .from(episodes)
    .innerJoin(arcs, eq(arcs.id, episodes.arcId))
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))

  return new Map(
    rows.map((row) => [row.episodeId, { arcId: row.arcId, title: row.title, index: row.index }])
  )
}

function pad(n: number): string {
  return String(n).padStart(3, '0')
}
