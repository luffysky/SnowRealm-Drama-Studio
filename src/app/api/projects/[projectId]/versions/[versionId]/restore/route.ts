import { handle, jsonOk, logActivity, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { getVersion, restoreVersion } from '@/lib/versions'

export const runtime = 'nodejs'

/**
 * Restores a version.
 *
 * Appends rather than rewrites: the state before the restore is kept as its
 * own version first, so a restore is itself undoable.
 */
export const POST = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; versionId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, versionId } = await context.params

    await requireProjectApi(projectId, user.id)

    const target = await getVersion(projectId, versionId)
    if (!target) {
      // Not found and not yours are the same answer, so ids cannot be probed.
      const { ApiError } = await import('@/lib/api')
      throw ApiError.notFound('找不到這個版本')
    }

    const result = await restoreVersion({ projectId, versionId, user })

    await logActivity({
      user,
      action: 'restore',
      entityType: 'document',
      entityId: target.documentId,
      projectId,
      summary: `${user.name} 把 EP${String(target.episodeNumber).padStart(3, '0')} 還原到 v${target.version}`,
    })

    return jsonOk(result, { status: 201 })
  }
)
