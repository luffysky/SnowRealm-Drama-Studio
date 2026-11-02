import { and, eq, ne } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, users } from '@/db/schema'
import { ApiError, handle, jsonOk, logActivity, parseJson, requireUser } from '@/lib/api'
import {
  describePasswordProblem,
  hashPassword,
  verifyPassword,
} from '@/lib/auth/password'
import { recordSecurityEvent } from '@/lib/auth/rate-limit'
import { changePasswordSchema } from '@/lib/validators'

/** @node-rs/argon2 is native, so this route needs the Node.js runtime. */
export const runtime = 'nodejs'

/**
 * Changes the signed-in user's own password. A user can only ever change their
 * own (spec 22「只可編輯自己的資料」).
 *
 * Every *other* session is revoked afterwards, so a password change actually
 * ends access from a device that already had a valid cookie.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser()
  const input = await parseJson(request, changePasswordSchema)

  const problem = describePasswordProblem(input.newPassword)
  if (problem) throw ApiError.badRequest(problem)

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  if (!row) throw ApiError.notFound('找不到使用者')

  const ok = await verifyPassword(input.currentPassword, row.passwordHash)
  if (!ok) throw ApiError.badRequest('目前的密碼不正確')

  const passwordHash = await hashPassword(input.newPassword)

  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, user.id))

  // Keep this session; revoke the rest.
  const { cookies } = await import('next/headers')
  const store = await cookies()
  const token = store.get('srds_session')?.value
  const { verifyToken } = await import('@/lib/auth/session')
  const payload = token ? await verifyToken(token) : null

  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      payload
        ? and(eq(sessions.userId, user.id), ne(sessions.id, payload.sid))
        : eq(sessions.userId, user.id)
    )

  await recordSecurityEvent({
    kind: 'PASSWORD_CHANGED',
    userId: user.id,
    email: user.email,
    detail: 'self_service',
  })

  await logActivity({
    user,
    action: 'update',
    entityType: 'user',
    entityId: user.id,
    summary: `${user.name} 變更密碼，其他裝置已登出`,
  })

  return jsonOk({ ok: true, otherSessionsRevoked: true })
})
