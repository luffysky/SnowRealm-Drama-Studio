import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { arcs, episodeProductionStages, episodes } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import { episodeTitleFor, planEpisodeBatch } from '@/lib/episode-batch-view'

export * from '@/lib/episode-batch-view'
import type { SessionUser } from '@/lib/auth/session'
import type { EpisodeStatusValue } from '@/lib/constants'
import { PRODUCTION_STAGE_KEYS, type ProductionStageKey } from '@/lib/production'
import type { ProductionStageStatus } from '@/lib/production'

/**
 * 批次建立與批次編輯集數 (Z66/Z67).
 *
 * `episodeBatchSchema` 與 `episodeBulkUpdateSchema` 兩支驗證器從很早就在，
 * 欄位齊全，**零個呼叫端**——是 `npm run check:dead` 掃出來的那批「寫好了沒
 * 人用」之一。待辦上這兩條也一直掛著「驗證器已存在，缺介面」。
 *
 * ## 建集數不只是建集數
 *
 * 每一集要同時長出**九筆階段紀錄**（spec v3 §11.2：120 集 × 9 階段 = 1,080
 * 筆）。少了它們不會報錯——製作進度頁照樣畫得出來，只是分母少了，進度百分比
 * 會偏高。那是這個專案最討厭的一種錯：一個看起來正常的數字。
 *
 * 所以這裡照 `createProject` 的作法：集數與階段在同一個交易裡建完，而且階段
 * 列要分批送（120 集就是 1,080 筆，一次送會超過單一語句的參數上限）。
 */

/** 一次語句最多塞幾列。1,080 筆階段列會超過參數上限。 */
const INSERT_CHUNK = 500

/* -------------------------------------------------------------------------- */
/* 寫入                                                                        */
/* -------------------------------------------------------------------------- */

export async function createEpisodeBatch(input: {
  projectId: string
  arcId: string
  from: number
  to: number
  targetSec: number
  titleTemplate: string
  skipExisting: boolean
  user: SessionUser
}): Promise<{ created: number; skipped: number[] }> {
  const [arc] = await db
    .select({ id: arcs.id })
    .from(arcs)
    .where(
      and(eq(arcs.id, input.arcId), eq(arcs.projectId, input.projectId), isNull(arcs.deletedAt))
    )
    .limit(1)

  // 卷屬不屬於這部作品要自己檢查：路由上的 projectId 只證明這個人進得了這部
  // 作品，不證明他送來的 arcId 也是這部作品的。
  if (!arc) throw ApiError.notFound('找不到這個卷')

  const existing = await db
    .select({ number: episodes.number })
    .from(episodes)
    .where(
      and(
        eq(episodes.projectId, input.projectId),
        isNull(episodes.deletedAt),
        sql`${episodes.number} between ${input.from} and ${input.to}`
      )
    )

  const plan = planEpisodeBatch({
    from: input.from,
    to: input.to,
    existing: existing.map((row) => row.number),
    skipExisting: input.skipExisting,
  })

  if (plan.create.length === 0) {
    return { created: 0, skipped: plan.skipped }
  }

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(episodes)
      .values(
        plan.create.map((number) => ({
          projectId: input.projectId,
          arcId: input.arcId,
          number,
          title: episodeTitleFor(input.titleTemplate, number),
          targetSec: input.targetSec,
          status: 'PLANNED' as const,
        }))
      )
      .returning({ id: episodes.id })

    /*
     * 九筆階段紀錄，一集一組。
     *
     * 跟集數在**同一個交易**裡：分開做的話，階段列失敗會留下一批沒有階段的
     * 集數，而製作進度頁不會抱怨——它只會把分母算小，然後顯示一個偏高的百分
     * 比。沒有人看得出那是錯的。
     */
    const stageRows = inserted.flatMap((episode) =>
      PRODUCTION_STAGE_KEYS.map((stageKey) => ({
        projectId: input.projectId,
        episodeId: episode.id,
        stageKey,
        status: 'not_started' as const,
      }))
    )

    for (let i = 0; i < stageRows.length; i += INSERT_CHUNK) {
      await tx.insert(episodeProductionStages).values(stageRows.slice(i, i + INSERT_CHUNK))
    }
  })

  await logActivity({
    user: input.user,
    action: 'create',
    entityType: 'episode',
    entityId: null,
    projectId: input.projectId,
    summary:
      `${input.user.name} 批次建立了 ${plan.create.length} 集` +
      `（第 ${input.from}–${input.to} 集${plan.skipped.length ? `，跳過 ${plan.skipped.length} 集` : ''}）`,
  })

  return { created: plan.create.length, skipped: plan.skipped }
}

/**
 * 這部作品已經有的集號。
 *
 * 給批次建立對話框的預覽用。要的是**全部**，不是當前頁的那二十筆——預覽說
 * 「會建 120 集」而實際跳過 118 集的話，那個預覽比沒有更糟。
 *
 * 只取一欄整數，240 集也就是 240 個 int。
 */
export async function existingEpisodeNumbers(projectId: string): Promise<number[]> {
  const rows = await db
    .select({ number: episodes.number })
    .from(episodes)
    .where(and(eq(episodes.projectId, projectId), isNull(episodes.deletedAt)))

  return rows.map((row) => row.number)
}

export type EpisodeBulkPatch = {
  status?: EpisodeStatusValue
  targetSec?: number
  /** 這裡**沒有** assigneeId：`episodes` 沒有那個欄位，見 validators 的註解。 */
  stage?: ProductionStageKey
  stageState?: ProductionStageStatus
}

export async function bulkUpdateEpisodes(input: {
  projectId: string
  episodeIds: string[]
  patch: EpisodeBulkPatch
  user: SessionUser
}): Promise<{ updated: number; stagesUpdated: number }> {
  /*
   * 只改屬於這部作品的那幾集。
   *
   * 不比對的話，有 A 作品權限的人可以送 B 作品的 episodeId，而批次端點一次
   * 能送 500 個——這是整個 API 面上最適合拿來亂改別人資料的形狀。
   */
  const mine = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(
        eq(episodes.projectId, input.projectId),
        isNull(episodes.deletedAt),
        inArray(episodes.id, input.episodeIds)
      )
    )

  const ids = mine.map((row) => row.id)
  if (ids.length === 0) throw ApiError.notFound('這些集數都不屬於這部作品')

  const { stage, stageState, ...episodePatch } = input.patch

  let updated = 0
  let stagesUpdated = 0

  await db.transaction(async (tx) => {
    const hasEpisodeChange = Object.values(episodePatch).some((value) => value !== undefined)

    if (hasEpisodeChange) {
      const rows = await tx
        .update(episodes)
        .set({ ...episodePatch, updatedAt: new Date() })
        .where(inArray(episodes.id, ids))
        .returning({ id: episodes.id })
      updated = rows.length
    }

    /*
     * 階段狀態是另一張表，而且**只有兩個欄位都給才動它**。
     *
     * 只給 stage 不給狀態，意思不明——「把這幾集的分鏡階段改成…什麼？」所以
     * 不猜，什麼都不做。
     */
    if (stage && stageState) {
      const rows = await tx
        .update(episodeProductionStages)
        .set({
          status: stageState,
          ...(stageState === 'completed' ? { completedAt: new Date() } : { completedAt: null }),
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(episodeProductionStages.episodeId, ids),
            eq(episodeProductionStages.stageKey, stage)
          )
        )
        .returning({ id: episodeProductionStages.id })
      stagesUpdated = rows.length
    }
  })

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'episode',
    entityId: null,
    projectId: input.projectId,
    summary: `${input.user.name} 批次更新了 ${ids.length} 集`,
  })

  /*
   * 回報真正改了幾列，不要用 `|| ids.length` 補 (Z164).
   *
   * 只改階段的時候 `updated` 是 0——那是對的，一集都沒改到 `episodes`。補成
   * `ids.length` 會讓回應說「更新了 20 集」而實際上改的是 20 筆階段紀錄。
   */
  return { updated, stagesUpdated }
}
