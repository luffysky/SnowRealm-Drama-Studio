import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { episodeProductionStages, episodes, users } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import {
  PRODUCTION_STAGE_LABEL,
  type ProductionStageKey,
  type ProductionStageStatus,
} from '@/lib/production'

export * from '@/lib/episode-stages-view'

/**
 * 手動改一集的某一個階段 (Z36).
 *
 * `stageUpdateSchema` 寫好很久、零個呼叫端——`check:dead` 掃出來的那批之一。
 * 在這之前，九大階段**完全沒有人工入口**：只有 `stage-sync` 從內容推導，以及
 * Z67 剛做的批次編輯。
 *
 * ## 哪幾個改了會留著
 *
 * `DERIVED_STAGES`（`novel`、`script`、`storyboard`、`assets`）會被
 * `resyncEpisodeStages` 重算——而那支在每一次章節／場次存檔之後都會跑。規則
 * （`stage-sync.ts:190-215`）是：
 *
 *  - **只升不降**，所以手動設成「已完成」會留著⋯
 *  - **除了 `novel`**：它的完成是從正文裡的「第NNN集 完」推導出來的，所以刪
 *    掉那一行就要能收回。手動把小說設成已完成，下一次存檔就會被改掉。
 *
 * 另外五個（劇情規劃、影像製作、後製剪輯、審核調整、上架發布）沒有量測來
 * 源，純人工，設了就是設了。
 *
 * 這件事要在介面上說出來，不能讓人設了之後發現它自己變回去——那比不給設更
 * 讓人不信任這個系統。
 */

export async function updateEpisodeStage(input: {
  projectId: string
  episodeId: string
  stage: ProductionStageKey
  state: ProductionStageStatus
  note?: string
  /**
   * 誰負責這個階段 (Z165).
   *
   * `episode_production_stages` **真的有** `assignee_id` 與 `assignee_type`，
   * 還有一支專屬索引——欄位在、索引在、全專案沒有人寫（實查 2160 筆全是
   * null）。schema 收下它卻在路由層丟掉，就是上一輪才修掉的那個「收下、回報
   * 成功、靜默丟掉」。這次欄位是真的，所以實作它而不是拿掉。
   *
   * `undefined` 代表不動，`null` 代表取消指派。
   */
  assigneeId?: string | null
  user: SessionUser
}): Promise<{ stage: ProductionStageKey; state: ProductionStageStatus }> {
  const [episode] = await db
    .select({ id: episodes.id, number: episodes.number })
    .from(episodes)
    .where(and(eq(episodes.id, input.episodeId), eq(episodes.projectId, input.projectId)))
    .limit(1)

  if (!episode) throw ApiError.notFound('找不到這一集')

  /*
   * `completedAt` 跟 `startedAt` 都要寫。
   *
   * `stage-sync` 寫它們，批次編輯也寫 `completedAt`——這裡不寫的話，同一個欄
   * 位會有三條路徑各自不同的意思。`startedAt` 用 coalesce 保留第一次：重新
   * 開始不是第一次開始。
   */
  // 指派給誰：要是真的使用者，不然 FK 會在寫入時才炸。
  if (input.assigneeId) {
    const [member] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.assigneeId))
      .limit(1)
    if (!member) throw ApiError.notFound('找不到這個成員')
  }

  const now = new Date()
  const updated = await db
    .update(episodeProductionStages)
    .set({
      status: input.state,
      ...(input.state === 'completed'
        ? { completedAt: now, progressPercent: 100 }
        : { completedAt: null }),
      /*
       * 從已完成退回進行中，要把 `progressPercent` 拉下來 (Z165).
       *
       * 設成完成時寫了 100，而 `STAGE_FRACTION` 對 `in_progress` 算的是
       * `progress_percent / 100`——所以不動它的話，退回進行中之後**完成度
       * 一個數字都不會變**：九大階段、作品總覽、進度總覽、分段檢視全部照
       * 舊，而看板自己還會印「進行中 100%」。
       *
       * 夾到 99：它不再是完成，就不該再算成一整格。
       */
      ...(input.state === 'in_progress' || input.state === 'in_review' || input.state === 'blocked'
        ? { progressPercent: sql`least(${episodeProductionStages.progressPercent}, 99)` }
        : {}),
      /*
       * `startedAt` 用 coalesce 保留第一次——重新開始不是第一次開始。
       *
       * 這段註解本來就寫在這裡，而程式沒有實作它：`startedAt` 只會在
       * `not_started` 時被清掉，從來不會被設值。而那五個沒有量測來源的階段
       * 只有這條路徑能動，所以它們的 `started_at` 永遠是 null。
       */
      ...(input.state === 'not_started'
        ? { startedAt: null, progressPercent: 0 }
        : { startedAt: sql`coalesce(${episodeProductionStages.startedAt}, now())` }),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.assigneeId !== undefined
        ? { assigneeId: input.assigneeId, assigneeType: input.assigneeId ? ('USER' as const) : null }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(episodeProductionStages.episodeId, input.episodeId),
        eq(episodeProductionStages.stageKey, input.stage)
      )
    )
    .returning({ id: episodeProductionStages.id })

  if (updated.length === 0) {
    /*
     * 階段列不存在。
     *
     * 理論上每一集建立時都會長出九筆，但舊資料或中途失敗的批次可能缺。補一
     * 筆比丟錯好——使用者要的是「把這個階段設成完成」，而「這一列不存在」是
     * 我們的問題不是他的。
     */
    await db.insert(episodeProductionStages).values({
      projectId: input.projectId,
      episodeId: input.episodeId,
      stageKey: input.stage,
      status: input.state,
      ...(input.state === 'completed' ? { completedAt: now, progressPercent: 100 } : {}),
      ...(input.state !== 'not_started' ? { startedAt: now } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.assigneeId
        ? { assigneeId: input.assigneeId, assigneeType: 'USER' as const }
        : {}),
    })
  }

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'episode_stage',
    entityId: input.episodeId,
    projectId: input.projectId,
    summary:
      `${input.user.name} 把第 ${episode.number} 集的` +
      `「${PRODUCTION_STAGE_LABEL[input.stage]}」改成 ${input.state}`,
  })

  return { stage: input.stage, state: input.state }
}
