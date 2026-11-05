import { and, asc, count, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { characters, episodes, projects, shots } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import { SHOT_STATUSES } from '@/lib/constants'
import {
  durationCheck,
  type ShotPatch,
  type ShotRow,
  type StoryboardEpisode,
  type StoryboardView,
} from '@/lib/storyboard-view'

export * from '@/lib/storyboard-view'

/**
 * 分鏡工作台 (Z39/Z40/Z71).
 *
 * `shots` 這張表從第一支 migration 就在，欄位齊全到連首尾幀與正負向提示詞都
 * 有，**一筆資料都沒有**，也沒有任何 lib、API 或介面碰過它。所以這不是「做
 * 一個檢視」，是做出功能——跟 Z89 跨作品任務同一種情況。
 *
 * ## 不是影片剪輯器
 *
 * spec 12 寫得很直白：「不是影片剪輯器；鏡頭時長須校驗」。所以這裡沒有時間
 * 軸拖拉、沒有轉場、沒有軌道。有的是一張鏡頭表，加上**一個會算的總長**：
 * 每個鏡頭幾秒、加起來幾秒、跟這一集的目標片長差多少。
 *
 * 那個校驗是這一頁存在的主要理由。短劇一集 120–180 秒，而一個不check總長的
 * 鏡頭表會在剪輯的時候才發現多了四十秒——那時候要砍的是已經生好的圖。
 */

/* -------------------------------------------------------------------------- */
/* 查資料                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 每一集的分鏡概況，給分鏡工作台的集數選單。
 *
 * 總長在 SQL 裡加總而不是把 120 集的鏡頭全讀進記憶體再算：這份清單只需要
 * 數字，而鏡頭的畫面描述與提示詞是這張表裡最大的兩個欄位。
 */
export async function storyboardIndex(projectId: string): Promise<StoryboardEpisode[]> {
  const rows = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      targetSec: episodes.targetSec,
      shotCount: sql<number>`(
        select count(*) from shots s where s.episode_id = ${episodes.id}
      )`.mapWith(Number),
      totalSec: sql<number>`(
        select coalesce(sum(s.duration_sec), 0) from shots s where s.episode_id = ${episodes.id}
      )`.mapWith(Number),
      approved: sql<number>`(
        select count(*) from shots s
         where s.episode_id = ${episodes.id} and s.status = 'APPROVED'
      )`.mapWith(Number),
      hasScript: sql<boolean>`exists (
        select 1 from documents d
         where d.episode_id = ${episodes.id}
           and d.kind = 'SCRIPT'
           and d.deleted_at is null
           and d.char_count > 0
      )`,
    })
    .from(episodes)
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .orderBy(asc(episodes.number))

  return rows
}

export async function storyboardFor(
  projectId: string,
  episodeId: string
): Promise<StoryboardView | null> {
  const [episode] = await db
    .select({
      id: episodes.id,
      number: episodes.number,
      title: episodes.title,
      targetSec: episodes.targetSec,
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

  if (!episode) return null

  const [rows, cast, scriptCount] = await Promise.all([
    db
      .select({
        id: shots.id,
        order: shots.order,
        sceneCode: shots.sceneCode,
        durationSec: shots.durationSec,
        shotSize: shots.shotSize,
        camera: shots.camera,
        location: shots.location,
        timeOfDay: shots.timeOfDay,
        action: shots.action,
        dialogue: shots.dialogue,
        speakerId: shots.speakerId,
        speakerName: characters.name,
        prompt: shots.prompt,
        negativePrompt: shots.negativePrompt,
        status: shots.status,
        notes: shots.notes,
        imageAssetId: shots.imageAssetId,
        videoAssetId: shots.videoAssetId,
        voiceAssetId: shots.voiceAssetId,
        updatedAt: shots.updatedAt,
      })
      .from(shots)
      .leftJoin(characters, eq(characters.id, shots.speakerId))
      .where(eq(shots.episodeId, episodeId))
      .orderBy(asc(shots.order)),

    db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(and(eq(characters.projectId, projectId), isNull(characters.deletedAt)))
      .orderBy(asc(characters.name)),

    db.execute(sql`
      select count(*)::int as n from documents
       where episode_id = ${episodeId}
         and kind = 'SCRIPT'
         and deleted_at is null
         and char_count > 0
    `),
  ])

  const scriptRows = (scriptCount as unknown as { rows?: { n: number }[] }).rows ?? []

  return {
    episode,
    shots: rows as ShotRow[],
    duration: durationCheck(
      rows.map((row) => row.durationSec),
      episode.targetSec
    ),
    cast,
    hasScript: (scriptRows[0]?.n ?? 0) > 0,
  }
}

/* -------------------------------------------------------------------------- */
/* 寫入                                                                        */
/* -------------------------------------------------------------------------- */

/** 新增一個鏡頭，排在最後面。 */
export async function createShot(input: {
  projectId: string
  episodeId: string
  patch: ShotPatch
  user: SessionUser
}): Promise<{ id: string; order: number }> {
  await assertEpisodeInProject(input.projectId, input.episodeId)

  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${shots.order}), 0)` })
    .from(shots)
    .where(eq(shots.episodeId, input.episodeId))

  const order = Number(last?.max ?? 0) + 1

  const [row] = await db
    .insert(shots)
    .values({
      episodeId: input.episodeId,
      order,
      ...cleanPatch(input.patch),
    })
    .returning({ id: shots.id, order: shots.order })

  if (!row) throw new Error('Failed to create shot')

  await logActivity({
    user: input.user,
    action: 'create',
    entityType: 'shot',
    entityId: row.id,
    projectId: input.projectId,
    summary: `${input.user.name} 新增了第 ${order} 個鏡頭`,
  })

  return row
}

export async function updateShot(input: {
  projectId: string
  shotId: string
  patch: ShotPatch
  user: SessionUser
}): Promise<{ version: number }> {
  const existing = await shotInProject(input.projectId, input.shotId)

  const patch = cleanPatch(input.patch)
  if (Object.keys(patch).length === 0) return { version: existing.version }

  const [updated] = await db
    .update(shots)
    .set({ ...patch, version: existing.version + 1, updatedAt: new Date() })
    .where(eq(shots.id, input.shotId))
    .returning({ version: shots.version })

  if (!updated) throw new Error('Failed to update shot')

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'shot',
    entityId: input.shotId,
    projectId: input.projectId,
    summary: `${input.user.name} 修改了第 ${existing.order} 個鏡頭`,
  })

  return updated
}

/**
 * 刪掉一個鏡頭，並把後面的往前遞補。
 *
 * 不留洞：`order` 上有 `unique(episode_id, order)`，而留著 1、2、4 這種序號會
 * 讓「插在第 3 個後面」這件事無從算起。遞補在同一個交易裡做完。
 */
export async function deleteShot(input: {
  projectId: string
  shotId: string
  user: SessionUser
}): Promise<void> {
  const existing = await shotInProject(input.projectId, input.shotId)

  await db.transaction(async (tx) => {
    await tx.delete(shots).where(eq(shots.id, input.shotId))
    await tx
      .update(shots)
      .set({ order: sql`${shots.order} - 1` })
      .where(and(eq(shots.episodeId, existing.episodeId), sql`${shots.order} > ${existing.order}`))
  })

  await logActivity({
    user: input.user,
    action: 'delete',
    entityType: 'shot',
    entityId: input.shotId,
    projectId: input.projectId,
    summary: `${input.user.name} 刪除了第 ${existing.order} 個鏡頭`,
  })
}

/**
 * 把一個鏡頭往前或往後挪一格。
 *
 * ## 為什麼要三步
 *
 * `unique(episode_id, order)` **不是 deferrable**，所以 Postgres 在每一句
 * UPDATE 之後就檢查一次。直接「A 設成 2、B 設成 1」在第一句就撞上去了——而
 * 撞的方式是整個交易回滾，看起來像「按了沒反應」。
 *
 * 所以先把 A 挪到一個不可能被佔用的位置（負數），讓 B 搬進 A 原本的位置，
 * 再把 A 放到 B 原本的位置。
 */
export async function moveShot(input: {
  projectId: string
  shotId: string
  direction: 'up' | 'down'
  user: SessionUser
}): Promise<{ order: number }> {
  const existing = await shotInProject(input.projectId, input.shotId)
  const targetOrder = existing.order + (input.direction === 'up' ? -1 : 1)

  const [neighbour] = await db
    .select({ id: shots.id })
    .from(shots)
    .where(and(eq(shots.episodeId, existing.episodeId), eq(shots.order, targetOrder)))
    .limit(1)

  // 已經在頭或尾。不是錯誤，就是沒得動。
  if (!neighbour) return { order: existing.order }

  await db.transaction(async (tx) => {
    const parking = -existing.order
    await tx.update(shots).set({ order: parking }).where(eq(shots.id, existing.id))
    await tx.update(shots).set({ order: existing.order }).where(eq(shots.id, neighbour.id))
    await tx.update(shots).set({ order: targetOrder }).where(eq(shots.id, existing.id))
  })

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'shot',
    entityId: input.shotId,
    projectId: input.projectId,
    summary: `${input.user.name} 把鏡頭從第 ${existing.order} 挪到第 ${targetOrder}`,
  })

  return { order: targetOrder }
}

/* -------------------------------------------------------------------------- */

function cleanPatch(patch: ShotPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = value
  }
  return out
}

async function assertEpisodeInProject(projectId: string, episodeId: string): Promise<void> {
  const [row] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.id, episodeId),
        eq(episodes.projectId, projectId),
        isNull(episodes.deletedAt)
      )
    )
    .limit(1)

  if (!row) throw ApiError.notFound('找不到這一集')
}

/**
 * 這個鏡頭屬不屬於這部作品。
 *
 * 每一條寫入路徑都要先問：路由上的 `projectId` 已經檢查過權限了，但 `shotId`
 * 是另一個參數——不比對的話，有權限進 A 作品的人可以用 A 的網址改 B 的鏡頭。
 */
async function shotInProject(
  projectId: string,
  shotId: string
): Promise<{ id: string; episodeId: string; order: number; version: number }> {
  const [row] = await db
    .select({
      id: shots.id,
      episodeId: shots.episodeId,
      order: shots.order,
      version: shots.version,
    })
    .from(shots)
    .innerJoin(episodes, eq(episodes.id, shots.episodeId))
    .where(and(eq(shots.id, shotId), eq(episodes.projectId, projectId)))
    .limit(1)

  if (!row) throw ApiError.notFound('找不到這個鏡頭')
  return row
}

/** 這部作品一共有幾個鏡頭、幾個已通過，給總覽與製作頁用。 */
export async function shotTotals(
  projectId: string
): Promise<{ total: number; byStatus: Record<string, number> }> {
  const rows = await db
    .select({ status: shots.status, n: count() })
    .from(shots)
    .innerJoin(episodes, eq(episodes.id, shots.episodeId))
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))
    .groupBy(shots.status)

  const byStatus = Object.fromEntries(
    SHOT_STATUSES.map((status) => [
      status,
      Number(rows.find((row) => row.status === status)?.n ?? 0),
    ])
  )

  return {
    total: rows.reduce((sum, row) => sum + Number(row.n), 0),
    byStatus,
  }
}

/** 作品存在且看得到，給頁面用。 */
export async function projectTitleFor(projectId: string): Promise<string> {
  const [row] = await db
    .select({ title: projects.title })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
  return row?.title ?? ''
}
