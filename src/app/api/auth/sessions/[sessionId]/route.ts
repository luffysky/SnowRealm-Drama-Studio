import { ApiError, handle, jsonOk, logActivity, requireUser } from '@/lib/api'
import { revokeSession } from '@/lib/auth/session'

/**
 * Revokes one of the user's own sessions. `revokeSession` scopes the update to
 * the caller's user id, so a session id belonging to the other member cannot
 * be revoked through this route.
 */
export const DELETE = handle(
  async (_request: Request, context: { params: Promise<{ sessionId: string }> }) => {
    const user = await requireUser()
    const { sessionId } = await context.params

    const revoked = await revokeSession(sessionId, user.id)
    if (!revoked) {
      throw ApiError.notFound('找不到該登入工作階段，或它已經失效')
    }

    await logActivity({
      user,
      action: 'update',
      entityType: 'session',
      entityId: sessionId,
      summary: `${user.name} 撤銷一個登入工作階段`,
    })

    return jsonOk({ ok: true })
  }
)
