import { handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import { createCharacter } from '@/lib/characters'
import { requireProjectApi } from '@/lib/project-access'
import { createCharacterSchema } from '@/lib/validators'
import { markSearchDirty } from '@/lib/search'

export const runtime = 'nodejs'

export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, createCharacterSchema)
    const character = await createCharacter({ projectId, ...input, user })

    await logActivity({
      user,
      action: 'create',
      entityType: 'character',
      entityId: character.id,
      projectId,
      summary: `${user.name} 新增角色「${character.name}」`,
    })

    // 內容變了，索引就落後了（只標記，不重建——見 markSearchDirty）

    await markSearchDirty(projectId)

    return jsonOk({ character }, { status: 201 })
  }
)
