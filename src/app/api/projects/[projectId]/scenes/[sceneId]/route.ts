import { ApiError, handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { saveSceneSchema } from '@/lib/validators'
import { saveScene, sceneProjectId } from '@/lib/writing'
import { markSearchDirty } from '@/lib/search'

export const runtime = 'nodejs'

/**
 * Saves one scene.
 *
 * Returns 409 when the script moved on since the editor was opened, exactly as
 * a chapter save does.
 */
export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; sceneId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, sceneId } = await context.params

    await requireProjectApi(projectId, user.id)
    if ((await sceneProjectId(sceneId)) !== projectId) {
      throw ApiError.notFound('找不到這個場次')
    }

    const input = await parseJson(request, saveSceneSchema)
    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）
    await markSearchDirty(projectId)
    return jsonOk(await saveScene({ sceneId, ...input, user }))
  }
)
