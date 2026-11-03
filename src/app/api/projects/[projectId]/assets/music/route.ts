import { handle, jsonOk, logActivity, parseJson, requirePermission } from '@/lib/api'
import { createMusic } from '@/lib/music'
import { requireProjectApi } from '@/lib/project-access'
import { markSearchDirty } from '@/lib/search'
import { musicSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 新增音樂 (design 84, Z6).
 *
 * Runs *after* the bytes are in R2: the browser uploads through the normal
 * pipeline and then calls this with the resulting asset id. Registering
 * metadata against a half-finished upload would put a track in the library
 * that cannot be played, which `createMusic` refuses.
 */
export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requirePermission('asset.write')
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, musicSchema)
    const { assetId, ...data } = input

    const result = await createMusic({ user, projectId, assetId, data })

    await logActivity({
      user,
      action: 'create',
      entityType: 'asset',
      entityId: result.assetId,
      projectId,
      summary: `新增音樂「${data.title}」`,
    })

    await markSearchDirty(projectId)

    return jsonOk(result)
  }
)
