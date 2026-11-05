import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { bulkUpdateEpisodes } from '@/lib/episode-batch'
import { requireProjectApi } from '@/lib/project-access'
import { episodeBulkUpdateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 批次編輯集數 (Z67).
 *
 * 收一串 episodeId 加上要改的欄位。**哪幾集真的屬於這部作品由 lib 再查一
 * 次**：路由上的 projectId 只證明這個人進得了這部作品，而這支一次能送 500
 * 個 id——這是整個 API 面上最適合拿來亂改別人資料的形狀。
 */
export const PATCH = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('episode.write')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const { episodeIds, ...patch } = await parseJson(request, episodeBulkUpdateSchema)

    const result = await bulkUpdateEpisodes({ projectId, episodeIds, patch, user })

    return jsonOk(result)
  }
)
