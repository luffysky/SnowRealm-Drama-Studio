import { ApiError, handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { updateMusic } from '@/lib/music'
import { requireProjectApi } from '@/lib/project-access'
import { markSearchDirty } from '@/lib/search'
import { musicUpdateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/*
 * **沒有 GET** (Z146)。這首歌的資料由音樂詳情頁與編輯頁在伺服器端呼叫
 * `getMusic()` 渲染，所以本來那支 GET 沒有任何呼叫端——它只是同一份查詢
 * 的第二個實作，外加一個要自己維護的授權面。
 */

export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; assetId: string }> }
  ) => {
    const user = await requirePermission('asset.write')
    const { projectId, assetId } = await context.params
    await requireProjectApi(projectId, user.id)

    const data = await parseJson(request, musicUpdateSchema)

    const result = await updateMusic({ projectId, assetId, data })
    if (!result) throw new ApiError(404, '找不到這首音樂', 'music_not_found')

    await logActivity({
      user,
      action: 'update',
      entityType: 'asset',
      entityId: assetId,
      projectId,
      summary: `更新音樂「${data.title}」的資訊`,
    })

    await markSearchDirty(projectId)

    return jsonOk(result)
  }
)
