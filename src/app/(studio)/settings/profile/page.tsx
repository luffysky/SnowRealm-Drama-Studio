import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { sessions } from '@/db/schema'
import { ProfileSettings } from '@/components/studio/ProfileSettings'
import { can } from '@/lib/auth/rbac'
import { listMembers } from '@/lib/auth/profile'
import { getSessionUser, SESSION_COOKIE, verifyToken } from '@/lib/auth/session'

export const metadata: Metadata = { title: '個人設定' }
/** Sessions and names change under you; a cached render would show stale ones. */
export const dynamic = 'force-dynamic'

/** 個人設定 (Z85) 與 團隊 (Z86). */
export default async function ProfileSettingsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // Which row is this browser, so it is not offered a "log out" that ends the
  // session doing the clicking.
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  const payload = token ? await verifyToken(token) : null

  const [members, rows] = await Promise.all([
    listMembers(),
    db
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
      .limit(50),
  ])

  return (
    <ProfileSettings
      meId={user.id}
      members={members}
      canManageOthers={can(user, 'member.manage')}
      sessions={rows.map((row) => ({
        id: row.id,
        userAgent: row.userAgent,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        revokedAt: row.revokedAt?.toISOString() ?? null,
        current: row.id === payload?.sid,
      }))}
    />
  )
}
