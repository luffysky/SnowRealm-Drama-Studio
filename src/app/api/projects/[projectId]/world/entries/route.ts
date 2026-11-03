import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { requireProjectApi } from '@/lib/project-access'
import { createWorldEntrySchema } from '@/lib/validators'
import { createWorldEntry } from '@/lib/world'

export const runtime = 'nodejs'

export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, createWorldEntrySchema)
    const entry = await createWorldEntry({ projectId, ...input, user })

    await logActivity({
      user,
      action: 'create',
      entityType: 'world_entry',
      entityId: entry.id,
      projectId,
      summary: `${user.name} 新增世界觀條目「${entry.title}」`,
    })

    return jsonOk({ entry }, { status: 201 })
  }
)
