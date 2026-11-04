import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { setStorageCost } from '@/lib/settings'
import { storageCostSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * R2 的儲存費率 (Z87).
 *
 * Cloudflare changes its published price from time to time, and every storage
 * figure in the cost pages is derived from this one number. Hardcoded, it goes
 * stale silently and every total computed from it is wrong without anything
 * looking wrong.
 */
export const PUT = handle(async (request: Request) => {
  const user = await requirePermission('system.settings')
  const input = await parseJson(request, storageCostSchema)

  await setStorageCost(input, user.id)
  return jsonOk({ ok: true })
})
