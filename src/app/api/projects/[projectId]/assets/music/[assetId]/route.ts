import { ApiError, handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { getMusic, updateMusic } from '@/lib/music'
import { requireProjectApi } from '@/lib/project-access'
import { markSearchDirty } from '@/lib/search'
import { musicUpdateSchema } from '@/lib/validators'

export const runtime = 'nodejs'

export const GET = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; assetId: string }> }
  ) => {
    const user = await requirePermission('project.read')
    const { projectId, assetId } = await context.params
    await requireProjectApi(projectId, user.id)

    const track = await getMusic(projectId, assetId)
    if (!track) throw new ApiError(404, '找不到這首音樂', 'music_not_found')

    return jsonOk({ track })
  }
)

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
