import { handle, jsonOk, logActivity, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { removeWorldEvent } from '@/lib/world'
import { markSearchDirty } from '@/lib/search'

export const runtime = 'nodejs'

/** Soft delete, same as an entry: a dropped beat may be wanted back. */
export const DELETE = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; eventId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, eventId } = await context.params
    await requireProjectApi(projectId, user.id)

    await removeWorldEvent({ eventId, projectId })

    await logActivity({
      user,
      action: 'delete',
      entityType: 'world_event',
      entityId: eventId,
      projectId,
      summary: `${user.name} 移除了一個時間線事件`,
    })

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）

    await markSearchDirty(projectId)

    return jsonOk({ removed: true })
  }
)
