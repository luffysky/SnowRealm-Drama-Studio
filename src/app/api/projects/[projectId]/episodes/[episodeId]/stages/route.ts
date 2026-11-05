import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { updateEpisodeStage } from '@/lib/episode-stages'
import { requireProjectApi } from '@/lib/project-access'
import { stageUpdateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 手動改一集的某一個階段 (Z36).
 *
 * `stageUpdateSchema` 寫好很久、零個呼叫端。在這之前九大階段完全沒有人工入
 * 口——只有 `stage-sync` 從內容推導，以及 Z67 的批次編輯。
 *
 * 路由上已經有 `episodeId`，所以 body 裡那個是多餘的；兩個對不上就擋下來，
 * 不要安靜地選一個。
 */
export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; episodeId: string }> }
  ) => {
    const user = await requirePermission('episode.write')
    const { projectId, episodeId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, stageUpdateSchema)
    if (input.episodeId !== episodeId) {
      const { ApiError } = await import('@/lib/api-error')
      throw ApiError.badRequest('網址上的集數跟內容裡的不一樣')
    }

    const result = await updateEpisodeStage({
      projectId,
      episodeId,
      stage: input.stage,
      state: input.state,
      ...(input.note !== undefined ? { note: input.note } : {}),
      // 階段真的有 assignee 欄位 (Z165)——收下就要用，不要靜默丟掉。
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
      user,
    })

    return jsonOk(result)
  }
)
