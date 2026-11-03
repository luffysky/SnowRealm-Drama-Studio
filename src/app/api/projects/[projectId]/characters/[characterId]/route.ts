import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { removeCharacter, updateCharacter } from '@/lib/characters'
import { requireProjectApi } from '@/lib/project-access'
import { updateCharacterSchema } from '@/lib/validators'
import { markSearchDirty } from '@/lib/search'

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

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）

    await markSearchDirty(projectId)

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

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）

    await markSearchDirty(projectId)

    return jsonOk({ removed: true })
  }
)
