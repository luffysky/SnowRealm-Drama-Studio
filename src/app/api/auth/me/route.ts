import { handle, jsonOk } from '@/lib/api'
import { PERMISSIONS, roleCan } from '@/lib/auth/rbac'
import { getSessionUser } from '@/lib/auth/session'

/** Current session, plus the resolved permission set the UI gates on. */
export const GET = handle(async () => {
  const user = await getSessionUser()

  if (!user) {
    return jsonOk({ user: null, permissions: [] })
  }

  return jsonOk({
    user,
    permissions: PERMISSIONS.filter((p) => roleCan(user.role, p)),
  })
})
