import { handle, jsonOk, requireUser } from '@/lib/api'
import { assertProjectAccess } from '@/lib/assets'
import { toggleFavourite } from '@/lib/projects'

export const runtime = 'nodejs'

/**
 * Toggles the member's favourite (the heart on each card in design 03).
 *
 * Scoped to the caller: `toggleFavourite` keys on their own user id, so one
 * member's heart can never change the other's.
 */
export const POST = handle(
  async (_request: Request, context: { params: Promise<{ projectId: string }> }) => {
    const user = await requireUser()
    const { projectId } = await context.params

    await assertProjectAccess(projectId, user)
    const result = await toggleFavourite(user.id, projectId)

    return jsonOk(result)
  }
)
