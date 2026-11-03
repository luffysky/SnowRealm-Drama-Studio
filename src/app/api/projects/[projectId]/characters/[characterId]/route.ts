import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { removeCharacter, updateCharacter } from '@/lib/characters'
import { requireProjectApi } from '@/lib/project-access'
import { updateCharacterSchema } from '@/lib/validators'

export const runtime = 'nodejs'

export const PATCH = handle(
  async (
    request: Request,
    context: { params: Promise<{ projectId: string; characterId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, characterId } = await context.params
    await requireProjectApi(projectId, user.id)

    const patch = await parseJson(request, updateCharacterSchema)
    const character = await updateCharacter({ projectId, characterId, patch })

    return jsonOk({ character })
  }
)

/** Soft delete, so a cut character can come back without losing their notes. */
export const DELETE = handle(
  async (
    _request: Request,
    context: { params: Promise<{ projectId: string; characterId: string }> }
  ) => {
    const user = await requireUser()
    const { projectId, characterId } = await context.params
    await requireProjectApi(projectId, user.id)

    await removeCharacter({ projectId, characterId })

    await logActivity({
      user,
      action: 'delete',
      entityType: 'character',
      entityId: characterId,
      projectId,
      summary: `${user.name} 移除了一個角色`,
    })

    return jsonOk({ removed: true })
  }
)
