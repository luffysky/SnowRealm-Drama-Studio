import { handle, jsonOk, requireUser } from '@/lib/api'
import { removeRelationship } from '@/lib/characters'
import { requireProjectApi } from '@/lib/project-access'

export const runtime = 'nodejs'

export const DELETE = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; relationshipId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, relationshipId } = await context.params
    await requireProjectApi(projectId, user.id)

    await removeRelationship({ projectId, relationshipId })
    return jsonOk({ removed: true })
  }
)
