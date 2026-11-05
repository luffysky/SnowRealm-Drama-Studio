import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { applyOutline } from '@/lib/episodes'
import { requireProjectApi } from '@/lib/project-access'
import { outlineApplySchema } from '@/lib/validators'
import { markSearchDirty } from '@/lib/search'

export const runtime = 'nodejs'

/*
 * **只有 POST。** 分集大綱由小說頁在伺服器端呼叫 `listOutline()` 渲染，
 * 而單集的大綱走 `/episodes/[episodeId]/outline`——所以作品層這支 GET
 * 沒有任何呼叫端 (Z146)。
 */

/**
 * Adopts generated outlines for several episodes at once.
 *
 * One transaction: adopting a generated outline is a single decision by the
 * writer, and half-applied would leave them guessing which half.
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('episode.write')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, outlineApplySchema)
    const result = await applyOutline(projectId, input.entries)

    await logActivity({
      user,
      action: 'update',
      entityType: 'project',
      entityId: projectId,
      projectId,
      summary: `採用 AI 產生的分集大綱，套用 ${result.applied} 集`,
    })

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）

    await markSearchDirty(projectId)

    return jsonOk(result)
  }
)
