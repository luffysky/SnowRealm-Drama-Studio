import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { episodeProductionStages, episodes, users } from '@/db/schema'
import { ApiError, logActivity } from '@/lib/api'
import type { SessionUser } from '@/lib/auth/session'
import {
  PRODUCTION_STAGE_LABEL,
  PRODUCTION_STAGE_STATUS_LABEL,
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

/**
 * 狀態、兩個時間戳、百分比——同一組欄位，一個運算式 (Z166).
 *
 * 有**兩條**路徑在寫它們：單筆的 `updateEpisodeStage` 與批次的
 * `bulkUpdateEpisodes`。Z165 只修了單筆那條（夾 99、`startedAt` coalesce），
 * 批次那條一行都沒動，於是同一個欄位有兩種意思——而那正是這一輪又被審出來
 * 的原因。抽成一個地方之後，就沒有「記得兩邊一起改」這件事。
 */
export function stageStatusPatch(state: ProductionStageStatus) {
  return {
    status: state,
    /*
     * `completedAt` 用 coalesce 保留第一次。
     *
     * `stage-sync.ts` 寫的是 `completed_at = coalesce(s.completed_at,
     * now())`，而這裡本來是無條件蓋成 now——同一個欄位兩條路徑兩種意思。退
     * 回未完成時它會被清成 null，所以下一次真的完成，coalesce 會寫新的時
     * 間，不會卡在一個早就被退回的舊日期上。
     */
    ...(state === 'completed'
      ? {
          completedAt: sql`coalesce(${episodeProductionStages.completedAt}, now())`,
          progressPercent: 100,
        }
      : { completedAt: null }),
    /*
     * 從已完成退回進行中，要把 `progressPercent` 拉下來 (Z165).
     *
     * 設成完成時寫了 100，而 `STAGE_FRACTION` 對 `in_progress` 算的是
     * `progress_percent / 100`——所以不動它的話，退回進行中之後**完成度一個
     * 數字都不會變**：九大階段、作品總覽、進度總覽、分段檢視全部照舊，而看
     * 板自己還會印「進行中 100%」。
     *
     * 夾到 99：它不再是完成，就不該再算成一整格。`stage-sync` 那邊的
     * `target_percent` 用同樣的上限，不然重算會把這個 99 推回 100。
     */
    ...(state === 'in_progress' || state === 'in_review' || state === 'blocked'
      ? { progressPercent: sql`least(${episodeProductionStages.progressPercent}, 99)` }
      : {}),
    /*
     * `startedAt` 用 coalesce 保留第一次——重新開始不是第一次開始。
     *
     * 那五個沒有量測來源的階段只有這兩條路徑能動，所以它們的 `started_at`
     * 在這之前永遠是 null。
     */
    ...(state === 'not_started'
      ? { startedAt: null, progressPercent: 0 }
      : { startedAt: sql`coalesce(${episodeProductionStages.startedAt}, now())` }),
  }
}

export async function updateEpisodeStage(input: {
  projectId: string
  episodeId: string
  stage: ProductionStageKey
  /**
   * 改狀態才給 (Z166).
   *
   * 只改備註或只改指派的時候不要給。`state` 本來是必填，於是備註輸入框只
   * 能把「現在的狀態」一起送回來——而那等於每打一次備註就重新宣告一次
   * 「把這個階段設成已完成」：`completed_at` 被重蓋成今天、活動紀錄多一筆
   * 假的狀態變更、介面跳一個「已完成」的提示。
   */
  state?: ProductionStageStatus
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
}): Promise<{ stage: ProductionStageKey; state: ProductionStageStatus | null }> {
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

  /*
   * `state` 沒給就一個時間戳都不能動。
   *
   * 包成一個物件而不是散在 `.set()` 裡，是為了讓「只改備註」這件事在型別上
   * 就不可能碰到狀態那一組欄位。
   */
  const statusPatch = input.state === undefined ? {} : stageStatusPatch(input.state)

  const updated = await db
    .update(episodeProductionStages)
    .set({
      ...statusPatch,
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
      /*
       * 補列時 `state` 可能沒給（只改備註而那一列不存在）。那就是
       * `not_started` ——我們不知道它開始了，而猜一個「進行中」會在進度上
       * 憑空多出一格。
       */
      status: input.state ?? 'not_started',
      ...(input.state === 'completed' ? { completedAt: now, progressPercent: 100 } : {}),
      ...(input.state !== undefined && input.state !== 'not_started'
        ? { startedAt: now }
        : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.assigneeId
        ? { assigneeId: input.assigneeId, assigneeType: 'USER' as const }
        : {}),
    })
  }

  /*
   * 紀錄要說實際改了什麼。
   *
   * 本來寫死「改成 {state}」，所以只改備註也會留下一筆「改成 completed」的
   * 紀錄——活動紀錄是兩個人互相看對方做了什麼的地方，記錯比不記更糟。
   */
  const changes: string[] = []
  if (input.state !== undefined) {
    changes.push(`改成「${PRODUCTION_STAGE_STATUS_LABEL[input.state]}」`)
  }
  if (input.note !== undefined) {
    changes.push(input.note ? '改了備註' : '清掉了備註')
  }
  if (input.assigneeId !== undefined) {
    changes.push(input.assigneeId ? '指派了負責人' : '取消了指派')
  }

  await logActivity({
    user: input.user,
    action: 'update',
    entityType: 'episode_stage',
    entityId: input.episodeId,
    projectId: input.projectId,
    summary:
      `${input.user.name} 把第 ${episode.number} 集的` +
      `「${PRODUCTION_STAGE_LABEL[input.stage]}」${changes.join('、')}`,
  })

  return { stage: input.stage, state: input.state ?? null }
}
