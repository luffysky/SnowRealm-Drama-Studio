import { handle, jsonOk, parseJson, requirePermission } from '@/lib/api'
import { setIceServers } from '@/lib/settings'
import { iceServersSchema } from '@/lib/validators'

export const runtime = 'nodejs'

/**
 * 通話的 STUN / TURN 伺服器 (Z87, Z103).
 *
 * The long-term Cloudflare TURN key still belongs in the environment — the
 * browser is only ever handed short-lived minted credentials. What goes here
 * is a plain server list, for a relay that is configured by URL and password
 * rather than by API.
 */
export const PUT = handle(async (request: Request) => {
  const user = await requirePermission('system.settings')
  const { servers } = await parseJson(request, iceServersSchema)

  await setIceServers(servers, user.id)
  return jsonOk({ ok: true })
})
