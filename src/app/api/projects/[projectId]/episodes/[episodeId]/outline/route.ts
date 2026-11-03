import { ApiError, handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { updateOutline } from '@/lib/episodes'
import { requireProjectApi } from '@/lib/project-access'
import { outlineEditSchema } from '@/lib/validators'
import { markSearchDirty } from '@/lib/search'

export const runtime = 'nodejs'

/**
 * 分集大綱 (`docs/OUTLINE.md`).
 *
 * The outline lives on the episode row — `title`, `logline`, `synopsis` —
 * rather than in a table of its own, so there is never a second copy to
 * reconcile with 集數管理.
 */
export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; episodeId: string }> }
  ) => {
    const user = await requirePermission('episode.write')
    const { projectId, episodeId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, outlineEditSchema)

    const row = await updateOutline(projectId, episodeId, input)
    if (!row) throw new ApiError(404, '找不到這一集', 'episode_not_found')

    await logActivity({
      user,
      action: 'update',
      entityType: 'episode',
      entityId: row.id,
      projectId,
      summary: `更新 EP${String(row.number).padStart(3, '0')} 的大綱`,
    })

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）

    await markSearchDirty(projectId)

    return jsonOk(row)
  }
)
