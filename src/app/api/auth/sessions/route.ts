import { desc, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { sessions } from '@/db/schema'
import { handle, jsonOk, requireUser } from '@/lib/api'
import { SESSION_COOKIE, verifyToken } from '@/lib/auth/session'

/** The signed-in user's own login devices (spec 49「登入裝置」). */
export const GET = handle(async () => {
  const user = await requireUser()

  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  const payload = token ? await verifyToken(token) : null

  const rows = await db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      ipAddress: sessions.ipAddress,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
    })
    .from(sessions)
    .where(eq(sessions.userId, user.id))
    .orderBy(desc(sessions.lastSeenAt))
    .limit(50)

  const now = Date.now()

  return jsonOk({
    sessions: rows.map((row) => ({
      ...row,
      isCurrent: row.id === payload?.sid,
      isActive: !row.revokedAt && row.expiresAt.getTime() > now,
    })),
  })
})
