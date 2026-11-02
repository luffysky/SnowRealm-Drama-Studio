import { handle, jsonOk } from '@/lib/api'
import { destroyCurrentSession } from '@/lib/auth/session'

/** Revokes the current session row and clears the cookie. */
export const POST = handle(async () => {
  await destroyCurrentSession()
  return jsonOk({ ok: true })
})
