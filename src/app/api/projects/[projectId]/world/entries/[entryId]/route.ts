import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { updateWorldEntrySchema } from '@/lib/validators'
import { removeWorldEntry, updateWorldEntry } from '@/lib/world'

export const runtime = 'nodejs'

export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; entryId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, entryId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, updateWorldEntrySchema)
    const entry = await updateWorldEntry({ entryId, projectId, ...input, user })

    return jsonOk({ entry })
  }
)

/** Soft delete: a setting removed today may be wanted back next week. */
export const DELETE = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; entryId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, entryId } = await context.params
    await requireProjectApi(projectId, user.id)

    await removeWorldEntry({ entryId, projectId })

    await logActivity({
      user,
      action: 'delete',
      entityType: 'world_entry',
      entityId: entryId,
      projectId,
      summary: `${user.name} 移除了一個世界觀條目`,
    })

    return jsonOk({ removed: true })
  }
)
