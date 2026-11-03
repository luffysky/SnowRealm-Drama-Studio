import { handle, jsonOk, parseJson, requireUser } from '@/lib/api'
import { createRelationship } from '@/lib/characters'
import { requireProjectApi } from '@/lib/project-access'
import { createRelationshipSchema } from '@/lib/validators'

export const runtime = 'nodejs'

export const POST = handle(
  async (request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params
    await requireProjectApi(projectId, user.id)

    const input = await parseJson(request, createRelationshipSchema)
    return jsonOk({ relationship: await createRelationship({ projectId, ...input }) }, { status: 201 })
  }
)
