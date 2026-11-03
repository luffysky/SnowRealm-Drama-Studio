import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { createWorldEventSchema } from '@/lib/validators'
import { createWorldEvent } from '@/lib/world'

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

    return jsonOk({ event }, { status: 201 })
  }
)
