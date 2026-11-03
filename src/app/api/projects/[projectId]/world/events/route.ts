import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { createWorldEventSchema } from '@/lib/validators'
import { createWorldEvent } from '@/lib/world'
import { markSearchDirty } from '@/lib/search'

export const runtime = 'nodejs'

export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, createWorldEventSchema)
    const event = await createWorldEvent({ projectId, ...input, user })

    await logActivity({
      user,
      action: 'create',
      entityType: 'world_event',
      entityId: event.id,
      projectId,
      summary: `${user.name} 新增時間線事件「${event.title}」`,
    })

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）

    await markSearchDirty(projectId)

    return jsonOk({ event }, { status: 201 })
  }
)
