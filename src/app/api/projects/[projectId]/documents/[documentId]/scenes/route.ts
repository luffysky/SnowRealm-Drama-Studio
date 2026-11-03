import { ApiError, handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { createSceneSchema } from '@/lib/validators'
import { createScene, documentBelongsToProject } from '@/lib/writing'
import { markSearchDirty } from '@/lib/search'

export const runtime = 'nodejs'

/** Adds a scene to an episode's script. */
export const POST = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; documentId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, documentId } = await context.params

    await requireProjectApi(projectId, user.id)
    if (!(await documentBelongsToProject(documentId, projectId))) {
      throw ApiError.notFound('找不到這份文件')
    }

    const input = await parseJson(request, createSceneSchema)
    const { scene, lockRevision } = await createScene({
      documentId,
      heading: input.heading,
      user,
    })

    await logActivity({
      user,
      action: 'create',
      entityType: 'scene',
      entityId: scene.id,
      projectId,
      summary: `${user.name} 新增場次 ${scene.code}`,
    })

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）

    await markSearchDirty(projectId)

    return jsonOk({ scene, lockRevision }, { status: 201 })
  }
)
